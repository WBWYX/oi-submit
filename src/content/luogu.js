/**
 * 洛谷提交与结果回读。
 *
 * 四个平台里最难的一个，三个原因：
 *
 *  1. **是 SPA。** 提交面板在题目页里由 Vue 渲染，没有独立的提交页 URL，提交之后也
 *     不一定触发真正的页面加载（可能只是路由切到 /record/xxx），内容脚本不会重跑。
 *     所以洛谷这条路必须「填完之后自己留在原文档里接着盯结果」。
 *  2. **语言和 O2 不是原生控件。** 洛谷用的是自绘下拉和自绘开关，`<select>` 那套
 *     API 未必能用。这里的做法是**先找原生控件，找不到就按文本找自绘控件**，
 *     并且**把最终选中的东西回报出去**——人在面板上看到「语言：C++17 / O2：开」，
 *     对不上当场就能发现，而不是等评测完了才怀疑。
 *  3. **会弹验证码。** 按约定这里不自动识别，把验证码输入框聚焦好、等人自己敲。
 *
 * 选择器写得比较"啰嗦"是有意的：洛谷改版频繁，多一条等价路径就多扛一次改版。
 */

import { pickOption } from '../shared/platforms.js';
import {
  clickOrHighlight,
  findByText,
  optionsOf,
  pollVerdict,
  selectValue,
  sleep,
  waitFor,
  waitForElement,
} from './dom.js';

/**
 * 打开题目页里的提交面板。
 *
 * 正常情况下**什么都不用做**：提交页链接带的是 `/problem/P9169#submit`，
 * 洛谷自己的路由会把提交面板展开。这里只负责等编辑器渲染出来。
 *
 * 点标签页那条路留作兜底——万一锚点没生效（比如从别处跳进来、或者洛谷改了
 * 锚点名），还能救回来。但它不再是主路径了：那串写死的深层选择器一改版就失灵。
 */
async function openSubmitPanel() {
  // 已经在提交面板里（编辑器已渲染）就不用管了
  if (document.querySelector('.cm-content, textarea.cm-content')) return;

  try {
    await waitForElement(['.cm-content'], { timeoutMs: 6000 });
    return;
  } catch {
    // 锚点没把面板打开，退回到点标签页
  }

  const tab =
    findByText('a, li, button, span', /^\s*提交\s*$/) ??
    document.querySelector(
      '#app > div.main-container > div > header > div > div > div > div.bottom-row > div.left > div > ul > li:nth-child(2)',
    );
  if (tab) tab.click();
  await waitForElement(['.cm-content'], { timeoutMs: 20000 });
}

/**
 * 选语言。原生 select 优先，否则按文本点自绘下拉。
 * @returns 实际选中的文本；空串表示没找到语言控件
 */
async function chooseLanguage(wanted) {
  if (!wanted) return '';

  const native = document.querySelector('select');
  if (native && optionsOf(native).some((o) => /C\+\+|Python|Java/i.test(o.text))) {
    const option = pickOption(optionsOf(native), wanted);
    if (!option) return `${native.selectedOptions[0]?.textContent?.trim() ?? ''}（没找到「${wanted}」）`;
    selectValue(native, option.value);
    return option.text.trim();
  }

  /*
   * 自绘下拉：点开它，再在展开的列表里按文本找。
   * 触发元素的特征是「文本里含 C++ 或 语言」，比写死 class 抗改版。
   */
  const trigger = findByText('div, button, span', /(C\+\+|语言)/);
  if (!trigger) return '';
  trigger.click();
  await sleep(200);

  const item = findByText('li, div[role="option"], .dropdown-item, .option', new RegExp(wanted.replace(/[+]/g, '\\+'), 'i'));
  if (!item) {
    document.body.click(); // 收起下拉，别把展开的菜单留在那儿挡住提交按钮
    return `（没找到「${wanted}」，用的是页面当前选项）`;
  }
  item.click();
  await sleep(150);
  return (item.textContent ?? '').trim();
}

/**
 * 设置 O2 开关。
 * @returns 'on' | 'off' | '' （空串 = 没找到开关）
 */
async function setO2(want) {
  const label = findByText('label, span, div', /^\s*O2\s*(优化)?\s*$/);
  const box =
    document.querySelector('input[type="checkbox"][name*="o2" i]') ??
    label?.querySelector('input[type="checkbox"]') ??
    label?.parentElement?.querySelector('input[type="checkbox"]');

  if (box) {
    if (box.checked !== want) box.click();
    return box.checked ? 'on' : 'off';
  }

  // 自绘开关：靠 aria-checked / class 上的 checked 标记判断当前状态
  const sw = label?.parentElement?.querySelector('[role="switch"], .switch, .lfe-form-switch');
  if (!sw) return '';
  const on = sw.getAttribute('aria-checked') === 'true' || /checked|active|on\b/.test(sw.className);
  if (on !== want) {
    sw.click();
    await sleep(150);
  }
  return want ? 'on' : 'off';
}

export async function fill(task) {
  await openSubmitPanel();

  const language = await chooseLanguage(task.language);
  const o2 = await setO2(Boolean(task.enableO2));

  /*
   * 往 CodeMirror 6 里写代码。
   *
   * CM6 自己监听 DOM 变动，所以改 .cm-content 的 innerText 是能生效的；
   * 但**必须先清空**，否则在已有内容后面追加，交上去是两份代码拼在一起。
   */
  const editor = await waitForElement(['.cm-content']);
  editor.focus();
  editor.innerText = '';
  await sleep(50);
  editor.innerText = task.sourceCode;
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(150);

  const submitBtn =
    findByText('button', /^\s*提交(代码)?\s*$/) ??
    (await waitForElement([
      '#app > div.main-container > div > main > div > div > div.main > div > div.body > button',
    ]));
  const submitted = clickOrHighlight(submitBtn, task.manualSubmit);

  /*
   * 验证码。按约定不自动识别：把输入框聚焦好，人自己敲。
   * 这里**不能等**——等下去会把「提交已发出」这个事实拖到验证码输完之后才回报，
   * 而 oi-bench 那边会一直显示「提交中」。所以只是异步地做个聚焦。
   */
  void (async () => {
    try {
      // 等的时间要够长：手动模式下人可能过一会儿才点提交，验证码那时才弹
      const input = await waitForElement(['.swal2-modal input', '.swal2-input'], {
        timeoutMs: task.manualSubmit ? 300000 : 8000,
      });
      input.focus();
    } catch {
      /* 没弹验证码，正常 */
    }
  })();

  /*
   * 这里**不要再写「语言」两个字**：面板上那一行已经是「语言：…」，
   * 前缀重复会显示成「语言：语言 C++23」。
   */
  const parts = [];
  if (language) parts.push(language);
  if (o2) parts.push(`O2 ${o2 === 'on' ? '开' : '关'}`);
  if (!language) parts.push('没找到语言选择控件，用的是页面默认');
  return { language: parts.join(' · '), submitted };
}

/** 洛谷的评测中状态：等待中 / 评测中 / Judging / Waiting / 编译中 */
const IN_FLIGHT = /等待|评测中|编译中|judging|waiting|pending|running/i;

/**
 * 洛谷的数字状态码 → 人话。
 *
 * 这套码是洛谷接口里用的，不是页面上的文字。取值从记录页的返回里实测得到，
 * 与站内常见对照表一致。拿不准的码一律原样显示成 `状态N`，**不猜**——
 * 把一个未知状态显示成 AC 是最坏的那种错。
 */
const LUOGU_STATUS = {
  0: '等待中',
  1: '评测中',
  2: '编译错误',
  3: '输出超限',
  4: '内存超限',
  5: '超时',
  6: '答案错误',
  7: '运行错误',
  11: '未知错误',
  12: 'AC',
  14: '未通过', // Unaccepted：不是某种具体错误，而是「没过」的统称
  21: 'Hack 成功',
  22: 'Hack 失败',
};

const statusText = (code) => LUOGU_STATUS[code] ?? `状态${code}`;

/**
 * 从记录页拿逐个测试点的结果。
 *
 * **靠的是请求头 `x-lentille-request: content-only`**，同一个地址，让洛谷返回 JSON
 * 而不是页面。注意不是 `?_contentOnly=1`——那个参数**已经失效**了，用它会拿回一整页
 * HTML，然后在 JSON.parse 那里炸成一句 `Unexpected token '<'`。这条事实在本仓库的
 * `icpc-workbench/server/src/adapters/luogu.ts` 里写了很久，我第一版没去翻，凭印象
 * 写了参数版，白绕一圈。
 *
 * 不扒 DOM 的理由还是那两条：记录页是 Vue 渲染的、class 名会变；评测过程中页面是
 * 增量更新的，扒到一半的 DOM 很容易读出「一半测试点不存在」。接口返回的是完整快照。
 *
 * 请求带 same-origin 凭据，所以看得到自己的记录。
 */
async function fetchRecord() {
  const res = await fetch(`${location.origin}${location.pathname}`, {
    credentials: 'same-origin',
    headers: { 'x-lentille-request': 'content-only', Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`记录接口 HTTP ${res.status}`);

  /*
   * 先看 content-type 再解析。
   * 直接 res.json() 的话，拿回 HTML 时报的是「Unexpected token '<'」——
   * 那句话只说明「不是 JSON」，完全指不出「请求方式不对」这个真正的原因。
   */
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    throw new Error(`返回的不是 JSON 而是 ${type.split(';')[0] || '未知类型'}（登录态失效？）`);
  }
  return res.json();
}

/**
 * 在返回的 JSON 里找出所有测试点。
 *
 * 分两步，顺序很重要：
 *
 *  1. **先找名字叫 `testCases` 的数组**，按出现顺序把里面的元素摊平。这是洛谷
 *     自己的字段名，最准。分子任务的题目是 `subtasks[].testCases[]`，不分子任务的
 *     少一层，两种都能兜住——找的是字段名，不是固定路径。
 *  2. 一个都没找到，才退回「按特征找」。
 *
 * 为什么不能只用第 2 步：**子任务对象自己也带 status / time / memory**（那是子任务的
 * 汇总），外层容器也可能带。实测一次 35 格的结果里，28 个是真测试点、6 个是子任务
 * 汇总、1 个是更外层的容器——显示成「35 个测试点，其中无效 6 个」，而真相是
 * 28 个点全是答案错误。多算出来的那些还各自顶着别的状态，看着就像题目真有那些结果。
 */
export function collectTestCases(json) {
  const fromNamed = [];
  const namedWalk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) namedWalk(item);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (/^test_?cases$/i.test(key) && Array.isArray(value)) {
        for (const item of value) if (item && typeof item === 'object') fromNamed.push(item);
        continue; // 已经收过这一层，不再往里翻
      }
      namedWalk(value);
    }
  };
  namedWalk(json);

  const raw = fromNamed.length > 0 ? fromNamed : collectByShape(json);
  return raw.map((node, i) => ({
    index: i + 1,
    verdict: statusText(node.status),
    ...(typeof node.time === 'number' ? { timeMs: node.time } : {}),
    ...(typeof node.memory === 'number' ? { memoryKb: node.memory } : {}),
    ...(typeof node.score === 'number' ? { score: node.score } : {}),
  }));
}

/**
 * 退路：按特征找测试点。
 *
 * 只在连 `testCases` 这个字段名都找不到时才用，所以判据要收得很紧：
 * 有数字 status、有 time 或 memory、**不是容器**（自己带 testCases/subtasks 的是
 * 子任务或记录）、也**不长得像记录本身**（记录同样带整体耗时与内存）。
 */
function collectByShape(json) {
  const out = [];
  const CONTAINER_KEYS = ['testCases', 'test_cases', 'subtasks', 'judgeResult'];
  const RECORD_ONLY = ['problem', 'user', 'detail', 'submitTime', 'sourceCode', 'language'];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const isCase =
      typeof node.status === 'number' &&
      (typeof node.time === 'number' || typeof node.memory === 'number') &&
      !CONTAINER_KEYS.some((key) => node[key] !== undefined) &&
      !RECORD_ONLY.some((key) => node[key] !== undefined);
    if (isCase) out.push(node);
    for (const value of Object.values(node)) walk(value);
  };
  walk(json);
  return out;
}

/**
 * 整体结论。
 *
 * 在返回体里**找**一个「像记录」的对象，而不是写死 `currentData.record`：
 * 这个字段名我没法在离线状态核实（匿名访问记录页直接 302），写死一条路径
 * 等于赌一次。特征是「有数字 status，且带 score 或 detail」。
 */
function overallOf(json) {
  let found = null;
  const walk = (node) => {
    if (found || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const looksLikeRecord =
      typeof node.status === 'number' &&
      (typeof node.score === 'number' || node.detail !== undefined || node.problem !== undefined);
    if (looksLikeRecord) {
      found = { verdict: statusText(node.status), score: node.score };
      return;
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(json);
  return found;
}

/**
 * 从逐点结果归纳一个总结论：有一个不是 AC，整体就不是 AC。
 *
 * 多种错误混在一起时报第一个非 AC 的——面板上紧跟着就是各结论的计数，
 * 具体分布看那里，这里只需要给一个「不是 AC」的定性。
 */
function summarize(tests) {
  const bad = tests.find((t) => t.verdict !== 'AC' && !IN_FLIGHT.test(t.verdict));
  if (bad) return bad.verdict;
  return tests.some((t) => IN_FLIGHT.test(t.verdict)) ? '评测中' : 'AC';
}

export function watch(onUpdate) {
  return pollVerdict(
    () => {
      // DOM 兜底：接口失败时至少还能报个总状态
      const el =
        document.querySelector('.status, .record-status, [class*="status"] span') ??
        findByText('span, div', /(Accepted|Unaccepted|Wrong Answer|Time Limit|Compile Error|评测中|等待)/);
      const text = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
      return text ? { text, detail: apiFailure ? `逐点结果读不到：${apiFailure}` : '' } : null;
    },
    (text) => !IN_FLIGHT.test(text),
    onUpdate,
    { readAsync: readFromApi },
  );
}

/**
 * 接口读取失败的原因，会被带到面板上。
 *
 * 之前这里是「读不到就安静退回扒 DOM」，结果是面板上总状态有、逐点没有，
 * **而没有任何线索说明为什么**——查这个问题花掉了一个来回。
 * 功能降级可以，降级得无声无息不行。
 */
let apiFailure = '';

/**
 * 第二个数据源：页面里 SSR 注入的那份状态。
 *
 * 洛谷的页面自带 `window._feInjection = JSON.parse(decodeURIComponent("..."))`，
 * 整份记录就在里面。内容脚本读不到页面的 window（隔离世界），但**读得到
 * <script> 标签的文本**，所以从 DOM 里把那段取出来自己解一遍。
 *
 * 留这条路是因为上面那个接口是我猜的：匿名访问记录页直接 302，我没法在
 * 离线状态核实它。两个来源都试过还是空，那才是真的没有。
 */
function readInjected() {
  for (const script of document.scripts) {
    const text = script.textContent ?? '';
    if (!text.includes('_feInjection')) continue;
    const quoted = /decodeURIComponent\((?:"|')([\s\S]*?)(?:"|')\)/.exec(text);
    const raw = quoted ? decodeURIComponent(quoted[1]) : /_feInjection\s*=\s*([\s\S]*?);?\s*$/.exec(text)?.[1];
    if (!raw) continue;
    try {
      return JSON.parse(raw);
    } catch {
      // 这一段不是完整 JSON，继续看下一个 script
    }
  }
  return null;
}

/**
 * 把一份返回体解读成「总状态 + 逐点结果」。
 *
 * 单独抽出来是因为它要被两个地方用：线上那条读取路径，和测试。
 * 之前测试里放的是一份**复制过来的**同样逻辑，结果改了线上这份、测试那份没跟着改，
 * 测试就开始验一个已经不存在的行为——复制一段逻辑去测它，测的是复制品。
 */
export function interpret(json) {
  const tests = collectTestCases(json);
  const overall = overallOf(json);
  if (!overall && tests.length === 0) return null;

  /*
   * 总状态是「未通过」这种统称时（洛谷的 14 = Unaccepted），用逐点结果里的
   * 具体结论更有用：一眼看到「答案错误」，比看到「未通过」再自己去数格子强。
   */
  const summarized = tests.length > 0 ? summarize(tests) : '';
  const generic = overall?.verdict === '未通过' || overall?.verdict === '未知错误';
  const verdict = generic && summarized ? summarized : (overall?.verdict ?? summarized);

  const detailParts = [];
  if (typeof overall?.score === 'number') detailParts.push(`得分 ${overall.score}`);
  if (tests.length > 0) detailParts.push(`${tests.length} 个测试点`);
  return { text: verdict, detail: detailParts.join(' · '), tests };
}

/** 给 pollVerdict 用的异步读取：一次请求同时拿到总状态和逐点结果。 */
async function readFromApi() {
  let json = null;
  let failure = '';
  try {
    json = await fetchRecord();
  } catch (error) {
    failure = String(error?.message ?? error);
  }

  // 接口读不到就退到页面注入的那份状态，它们是两个独立来源
  if (!json) json = readInjected();
  if (!json) {
    apiFailure = failure || '接口和页面注入的状态都读不到';
    return null;
  }

  const got = interpret(json);
  if (!got) {
    apiFailure = '返回体里既没有总状态也没有测试点';
    return null;
  }
  apiFailure = '';
  return got;
}

export function isResultPage() {
  return location.pathname.startsWith('/record/');
}

/**
 * 洛谷是 SPA，提交之后可能不发生真正的页面加载。
 * 所以这里等的是「URL 变成了 /record/…」，而不是等元素消失。
 */
export async function waitUntilSubmitted({ manual = false } = {}) {
  await waitFor(() => location.pathname.startsWith('/record/'), {
    // 留足人工输验证码的时间；手动模式下还要算上人自己点提交那一段
    timeoutMs: manual ? 300000 : 60000,
    label: '跳转到评测记录页',
  });
}

/* ───── 仅供测试：把两个内部函数暴露出来，好在没有浏览器的情况下验 ───── */

export const overallOfForTest = overallOf;
export const readInjectedForTest = readInjected;
export const fetchRecordForTest = fetchRecord;

/** 用一份现成的 JSON 走一遍解析（跳过 fetch）。直接调线上那份逻辑，不复制。 */
export const readFromApiForTest = async (json) => interpret(json);
