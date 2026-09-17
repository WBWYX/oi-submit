/**
 * Service worker：连 router、开提交页、把结果送回去。
 *
 * ## MV3 的那个坑
 *
 * service worker 空闲 30 秒就会被浏览器回收，连接随之断掉。**Chrome 116 起
 * WebSocket 上的收发会重置这个计时器**，而 router 每 15 秒发一次 socket.io 的 PING，
 * 正好把 worker 一直续着。所以这套连接能长期存活不是运气好，而是建立在
 * 「保持 WebSocket 且老实回 PONG」之上——见 shared/sio.js。
 *
 * 即便如此也不能假设 worker 不会死：它随时可能因浏览器重启、扩展更新、
 * 内存压力被回收。所以**跨页面的状态一律放 chrome.storage.session**，
 * 不放模块级变量。一个已经发出去、正等着填表的提交，如果 worker 中途重启，
 * 状态还在，新起来的 worker 接着干。
 */

import { SocketIoClient, State } from './shared/sio.js';
import { DEFAULT_SETTINGS, PLATFORM_NAME, submitTarget } from './shared/platforms.js';
import { fetchStatement } from './shared/statement/index.js';

/** tabId → 待处理的提交任务，存在 session 存储里（见文件头） */
const PENDING_KEY = 'pending';

let socket = null;
let settings = { ...DEFAULT_SETTINGS };
let lastError = '';

async function loadSettings() {
  const stored = await chrome.storage.local.get('settings');
  settings = {
    ...DEFAULT_SETTINGS,
    ...(stored.settings ?? {}),
    language: { ...DEFAULT_SETTINGS.language, ...(stored.settings?.language ?? {}) },
  };
  return settings;
}

async function readPending() {
  const got = await chrome.storage.session.get(PENDING_KEY);
  return got[PENDING_KEY] ?? {};
}

async function writePending(map) {
  await chrome.storage.session.set({ [PENDING_KEY]: map });
}

/* ────────────────────────── 连接 ────────────────────────── */

async function connect() {
  const cfg = await loadSettings();
  socket?.disconnect();
  lastError = '';

  socket = new SocketIoClient(`ws://127.0.0.1:${cfg.port}`, { type: 'browser' });
  socket.onState((state) => {
    void updateBadge(state);
    void chrome.runtime.sendMessage({ type: 'stateChanged' }).catch(() => {
      /* popup 没开着就没人收，正常 */
    });
  });

  socket.on('status', (payload) => {
    void chrome.storage.session.set({ isActive: Boolean(payload?.isActive) });
    void chrome.runtime.sendMessage({ type: 'stateChanged' }).catch(() => {});
  });

  socket.on('submitRequest', (data) => {
    void handleSubmitRequest(data);
  });

  socket.on('statementRequest', (data) => {
    void handleStatementRequest(data);
  });

  socket.connect();
}

async function updateBadge(state) {
  const { isActive } = await chrome.storage.session.get('isActive');
  const connected = state === State.CONNECTED;
  await chrome.action.setBadgeText({ text: connected ? (isActive ? '●' : '○') : '' });
  await chrome.action.setBadgeBackgroundColor({ color: connected ? '#3fb950' : '#8b949e' });
}

/* ────────────────────────── 提交 ────────────────────────── */

/**
 * 收到一条提交请求。
 *
 * 顺序是「先校验链接、再开标签页」。反过来的话，一个认不出来的链接会先把页面打开、
 * 然后填表在那儿等元素等到超时，而人看到的只是浏览器莫名跳了一下——这正是
 * 「为什么每次都要自己再点一下」那类问题最难查的形态。
 */
async function handleSubmitRequest(data) {
  const url = String(data?.url ?? '');
  const sourceCode = String(data?.sourceCode ?? '');
  const target = submitTarget(url);

  if (!target) {
    report(data, { ok: false, message: `认不出这个题目链接：${url}` });
    notify('提交失败', `认不出这个题目链接：\n${url}`);
    return;
  }
  if (!sourceCode.trim()) {
    report(data, { ok: false, message: '源代码是空的，没有提交' });
    notify('提交失败', '源代码是空的');
    return;
  }

  const cfg = await loadSettings();
  // 请求里带的语言优先于扩展里的默认设置：面板上临时改一次不该被扩展覆盖回去
  const language = data?.language || cfg.language[target.platform] || '';
  const enableO2 = data?.enableO2 === undefined ? cfg.enableO2 : Boolean(data.enableO2);

  const task = {
    ...target,
    sourceCode,
    language,
    enableO2,
    /*
     * LOJ 的 C++ 标准默认是 c++11，比别家低一大截，带 auto / 结构化绑定的代码
     * 到那边直接 CE。所以单独带上这一项，让内容脚本去把标准下拉摆正。
     */
    lojStandard: target.platform === 'loj' ? cfg.lojStandard : '',
    judgeId: target.platform === 'timus' ? cfg.timusJudgeId : '',
    reportResult: cfg.reportResult,
    manualSubmit: cfg.manualSubmit,
    /** 回传结果时带上，让 oi-bench 能把结果对上是哪一次提交 */
    requestId: data?.requestId ?? `${Date.now()}`,
    submittedUrl: url,
    phase: 'fill',
  };

  if (target.platform === 'timus' && !task.judgeId) {
    report(data, { ok: false, message: 'Timus 需要 Judge ID，请在扩展选项里填写' });
    notify('提交失败', 'Timus 需要 Judge ID：右键扩展图标 → 选项，填进去再试');
    return;
  }

  const tab = await chrome.tabs.create({ url: target.submitUrl });
  if (tab.id === undefined) {
    report(data, { ok: false, message: '打不开提交页' });
    return;
  }
  const pending = await readPending();
  pending[tab.id] = task;
  await writePending(pending);
}

/* ────────────────────────── 抓题面 ────────────────────────── */

/**
 * 按链接抓题面，转成 Markdown 回传。
 *
 * 全程在 service worker 里完成，**不开标签页**：需要的只是一次带登录态的
 * 请求，而扩展本来就在浏览器里。这也正是这套东西从服务端搬过来的理由——
 * 那边为了冒充浏览器，背着 Cookie 配置、洛谷的 C3VK 重试、以及 Cloudflare
 * 按 TLS 指纹拦截时的 curl 回退，搬过来之后三样一起消失。
 */
async function handleStatementRequest(data) {
  const requestId = data?.requestId ?? null;
  const url = String(data?.url ?? '');
  try {
    const statement = await fetchStatement(url);
    socket?.emit('statementResult', { requestId, url, ok: true, statement });
  } catch (error) {
    /*
     * 失败原因必须原样带回去。「抓取失败」四个字对排查毫无帮助——
     * 是没登录、题号不存在，还是页面改版了，处理方式完全不同。
     */
    const message = String(error?.message ?? error);
    socket?.emit('statementResult', { requestId, url, ok: false, error: message });
    notify('抓取题面失败', message);
  }
}

/** 把结果发回 oi-bench。发不出去（没连上）就只剩通知，至少人知道发生了什么。 */
function report(data, result) {
  const payload = {
    requestId: data?.requestId ?? null,
    url: data?.url ?? null,
    ...result,
  };
  if (!socket?.emit('submitResult', payload)) {
    lastError = result.message ?? '';
  }
}

function notify(title, message) {
  // 没申请 notifications 权限，用徽章 + popup 里的最近一条消息代替弹窗通知
  lastError = `${title}：${message}`;
  void chrome.storage.session.set({ lastMessage: lastError, lastMessageAt: Date.now() });
}

/* ────────────────────────── 与内容脚本的往来 ────────────────────────── */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tabId = sender.tab?.id;

    if (msg?.type === 'pageReady') {
      // 内容脚本每次页面加载都会问一句「这个标签页有我的活儿吗」
      const pending = await readPending();
      sendResponse(tabId === undefined ? null : (pending[tabId] ?? null));
      return;
    }

    if (msg?.type === 'phase' && tabId !== undefined) {
      // 填表完成 → 转入盯结果阶段；页面此时通常已经跳到评测记录页
      const pending = await readPending();
      if (pending[tabId]) {
        pending[tabId] = { ...pending[tabId], phase: msg.phase };
        await writePending(pending);
      }
      sendResponse(true);
      return;
    }

    if (msg?.type === 'filled' && tabId !== undefined) {
      // 表单填好了，但还没交出去——单独一个状态，别跟「已提交」混为一谈
      const pending = await readPending();
      const task = pending[tabId];
      if (task) {
        report(
          { requestId: task.requestId, url: task.submittedUrl },
          {
            ok: true,
            state: 'filled',
            message: String(msg.message ?? '已填好，等你点提交'),
            ...(msg.language ? { language: msg.language } : {}),
          },
        );
      }
      sendResponse(true);
      return;
    }

    if (msg?.type === 'submitDone' && tabId !== undefined) {
      const pending = await readPending();
      const task = pending[tabId];
      if (task) {
        report(
          { requestId: task.requestId, url: task.submittedUrl },
          {
            ok: Boolean(msg.ok),
            state: msg.ok ? 'submitted' : 'failed',
            message: String(msg.message ?? ''),
            ...(msg.language ? { language: msg.language } : {}),
          },
        );
        if (!msg.ok || !task.reportResult) {
          delete pending[tabId];
          await writePending(pending);
        }
      }
      sendResponse(true);
      return;
    }

    if (msg?.type === 'verdict' && tabId !== undefined) {
      const pending = await readPending();
      const task = pending[tabId];
      if (task) {
        socket?.emit('submitVerdict', {
          requestId: task.requestId,
          url: task.submittedUrl,
          platform: task.platform,
          problemKey: task.problemKey,
          verdict: String(msg.verdict ?? ''),
          detail: String(msg.detail ?? ''),
          // 逐个测试点的状态；平台给不出来时是空数组，不伪造
          tests: Array.isArray(msg.tests) ? msg.tests.slice(0, 200) : [],
          final: Boolean(msg.final),
        });
        if (msg.final) {
          delete pending[tabId];
          await writePending(pending);
        }
      }
      sendResponse(true);
      return;
    }

    if (msg?.type === 'getState') {
      const session = await chrome.storage.session.get(['isActive', 'lastMessage']);
      sendResponse({
        state: socket?.state ?? State.CLOSED,
        isActive: Boolean(session.isActive),
        port: settings.port,
        lastMessage: session.lastMessage ?? lastError,
      });
      return;
    }

    if (msg?.type === 'reconnect') {
      await connect();
      sendResponse(true);
      return;
    }

    if (msg?.type === 'setActive') {
      // 抢占 active：router 只把提交请求发给活动浏览器
      socket?.emit('setActive');
      sendResponse(true);
      return;
    }

    sendResponse(undefined);
  })();
  return true; // 异步 sendResponse
});

/** 标签页关掉就把它的待办清掉，别让 session 存储里攒一堆孤儿 */
chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const pending = await readPending();
    if (pending[tabId]) {
      delete pending[tabId];
      await writePending(pending);
    }
  })();
});

chrome.storage.onChanged.addListener((changes, area) => {
  // 选项页改了端口就立刻重连，不用等下次浏览器重启
  if (area === 'local' && changes.settings) {
    const before = changes.settings.oldValue?.port;
    const after = changes.settings.newValue?.port;
    if (before !== after) void connect();
    else void loadSettings();
  }
});

chrome.runtime.onStartup.addListener(() => void connect());
chrome.runtime.onInstalled.addListener(() => void connect());
// worker 被回收后重新拉起时也要接上，上面两个事件覆盖不到这种情况
void connect();
