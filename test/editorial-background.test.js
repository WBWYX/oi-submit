import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';

const problemUrl = 'https://www.luogu.com.cn/problem/P1001';
const source = {
  platform: 'luogu', problemKey: 'P1001', title: 'A+B 题解',
  url: 'https://www.luogu.com.cn/article/abc123', author: '题解作者',
};
const listFixture = {
  data: {
    problem: { pid: 'P1001' },
    solutions: { result: [{ lid: 'abc123', title: source.title, author: { name: source.author } }] },
  },
};
const articleFixture = {
  data: { article: {
    lid: 'abc123', title: source.title, author: { name: source.author },
    solutionFor: { pid: 'P1001' }, contentFull: true,
    content: '# 解法\n\n计算 $a+b$。\n\n```cpp\ncout << a + b;\n```\n',
  } },
};

function eventChannel() {
  const listeners = [];
  return { listeners, addListener: (listener) => listeners.push(listener) };
}

function storageArea() {
  const data = {};
  return {
    async get(keys) {
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, data[key]]));
    },
    async set(value) { Object.assign(data, value); },
  };
}

async function until(condition, message = '等待后台事件处理完成') {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await nextTurn();
  }
  assert.fail(message);
}

let imports = 0;
async function background(t) {
  const originals = Object.fromEntries(['chrome', 'WebSocket', 'fetch'].map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)],
  ));
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const sockets = [];
  class FakeWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = FakeWebSocket.OPEN;
    sent = [];
    constructor(url) { this.url = url; sockets.push(this); }
    send(frame) {
      assert.equal(this.readyState, FakeWebSocket.OPEN);
      this.sent.push(frame);
    }
    close() {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({});
    }
    receive(frame) { this.onmessage?.({ data: frame }); }
    connect() {
      this.receive('0{"sid":"engine","pingInterval":15000,"pingTimeout":20000}');
      this.receive('40{"sid":"browser"}');
    }
    request(event, payload) { this.receive(`42${JSON.stringify([event, payload])}`); }
    events(event) {
      return this.sent.filter((frame) => frame.startsWith('42')).map((frame) => JSON.parse(frame.slice(2)))
        .filter(([name]) => name === event).map(([, payload]) => payload);
    }
  }

  const openedTabs = [];
  const chrome = {
    storage: { local: storageArea(), session: storageArea(), onChanged: eventChannel() },
    runtime: {
      onMessage: eventChannel(), onStartup: eventChannel(), onInstalled: eventChannel(),
      sendMessage: async () => undefined,
    },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    tabs: {
      onRemoved: eventChannel(),
      create: async (value) => { openedTabs.push(value); return { id: openedTabs.length }; },
    },
  };
  const calls = [];
  let responder = async (url) => {
    if (url === 'https://www.luogu.com.cn/problem/solution/P1001') return Response.json(listFixture);
    if (url === source.url) return Response.json(articleFixture);
    throw new Error(`测试未配置请求：${url}`);
  };
  globalThis.chrome = chrome;
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init);
  };
  t.after(async () => {
    // 测试替身没有真实连接；关闭前移除回调，不触发 service worker 的自动重连。
    for (const ws of sockets) {
      ws.onclose = ws.onmessage = ws.onerror = null;
      ws.close();
    }
    t.mock.timers.reset();
    await nextTurn();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  // 只替换外部浏览器环境，真正加载 background、SocketIoClient 和平台题解适配器。
  await import(`../src/background.js?editorial-background-test=${++imports}`);
  await until(() => sockets.length === 2, '后台没有创建两个独立 socket');
  sockets[0].connect();
  return {
    sockets, calls, openedTabs,
    setFetch: (fn) => { responder = fn; },
    async reconnect() {
      await new Promise((resolve) => chrome.runtime.onMessage.listeners[0]({ type: 'reconnect' }, {}, resolve));
      sockets.at(-2).connect();
      return sockets.at(-2);
    },
    async response(ws, event) {
      await until(() => ws.events(event).length > 0, `后台未返回 ${event}`);
      return ws.events(event).at(-1);
    },
  };
}

test('ICPC 连接独立读取，结果不串到 OI Bench，重连丢弃旧请求', async (t) => {
  const worker = await background(t);
  const bench = worker.sockets[0], icpc = worker.sockets[1];
  assert.match(icpc.url, /127\.0\.0\.1:27122/);
  icpc.connect();
  worker.setFetch(async () => Response.json({ status: 'OK', result: [] }));
  icpc.request('pageFetchRequest', { requestId: 'icpc-1', url: 'https://codeforces.com/api/contest.list?gym=false' });
  assert.equal((await worker.response(icpc, 'pageFetchResult')).ok, true);
  assert.equal(bench.events('pageFetchResult').length, 0);
  let release;
  worker.setFetch(() => new Promise(resolve => { release = resolve; }));
  icpc.request('pageFetchRequest', { requestId: 'old', url: 'https://atcoder.jp/contests/' });
  await until(() => release);
  await worker.reconnect();
  release(Response.json({ status: 'OK', result: [] }));
  await nextTurn();
  assert.equal(icpc.events('pageFetchResult').length, 1);
  const newIcpc = worker.sockets.at(-1);
  newIcpc.connect();
  worker.setFetch(async () => Response.json({ status: 'OK', result: [] }));
  newIcpc.request('pageFetchRequest', { requestId: 'new', url: 'https://ac.nowcoder.com/acm/contest/vip-index' });
  assert.equal((await worker.response(newIcpc, 'pageFetchResult')).requestId, 'new');
});

test('background 把真实题解列表和 Markdown 正文送回原 requestId', async (t) => {
  const worker = await background(t);
  const ws = worker.sockets[0];
  assert.match(ws.url, /type=browser/);
  ws.request('editorialListRequest', { requestId: 'list-1', url: problemUrl });
  assert.deepEqual(await worker.response(ws, 'editorialListResult'), {
    requestId: 'list-1', ok: true, editorials: [source],
  });

  ws.request('editorialRequest', { requestId: 'article-1', source });
  const response = await worker.response(ws, 'editorialResult');
  assert.equal(response.requestId, 'article-1');
  assert.equal(response.ok, true);
  assert.equal(response.editorial.url, source.url);
  assert.equal(response.editorial.problemKey, 'P1001');
  assert.match(response.editorial.markdown, /kind: editorial/);
  assert.match(response.editorial.markdown, /source: "https:\/\/www\.luogu\.com\.cn\/article\/abc123"/);
  assert.ok(response.editorial.markdown.includes(articleFixture.data.article.content.trim()));
  assert.equal(worker.calls.length, 2);
  assert.ok(worker.calls.every(({ init }) => init.credentials === 'include'));
  assert.deepEqual(worker.openedTabs, [], '题解抓取不应开启提交标签页');
});

for (const [requestEvent, responseEvent, payload] of [
  ['editorialListRequest', 'editorialListResult', { url: problemUrl }],
  ['editorialRequest', 'editorialResult', { source }],
]) {
  test(`background ${requestEvent} 原样回报平台错误`, async (t) => {
    const worker = await background(t);
    worker.setFetch(async () => Response.json({ data: { errorCode: 401, errorData: { needLogin: true } } }));
    const ws = worker.sockets[0];
    ws.request(requestEvent, { requestId: 'failed', ...payload });
    assert.deepEqual(await worker.response(ws, responseEvent), {
      requestId: 'failed', ok: false, error: '查看洛谷题解需要登录，请先在浏览器里登录洛谷。',
    });
  });
}

for (const reconnect of ['manual', 'automatic']) {
  test(`background ${reconnect} 重连后不把旧请求的结果发给新 socket`, async (t) => {
    const worker = await background(t);
    let finish;
    worker.setFetch(() => new Promise((resolve) => { finish = resolve; }));
    const old = worker.sockets[0];
    old.request('editorialListRequest', { requestId: 'old-list', url: problemUrl });
    await until(() => finish !== undefined, '抓取请求未开始');
    let current;
    if (reconnect === 'manual') current = await worker.reconnect();
    else {
      old.close();
      t.mock.timers.tick(1000);
      assert.equal(worker.sockets.length, 3);
      current = worker.sockets[2];
      current.connect();
    }
    assert.notEqual(current, old);
    finish(Response.json(listFixture));
    await nextTurn();
    await nextTurn();
    assert.deepEqual(current.events('editorialListResult'), [], '新连接收到上一连接的迟到结果');
    assert.deepEqual(old.events('editorialListResult'), []);

    worker.setFetch(async () => Response.json(listFixture));
    current.request('editorialListRequest', { requestId: 'current-list', url: problemUrl });
    assert.deepEqual(await worker.response(current, 'editorialListResult'), {
      requestId: 'current-list', ok: true, editorials: [source],
    });
  });
}

test('background 自动重连后忽略旧正文请求的迟到错误', async (t) => {
  const worker = await background(t);
  let finish;
  worker.setFetch(() => new Promise((resolve) => { finish = resolve; }));
  const old = worker.sockets[0];
  old.request('editorialRequest', { requestId: 'old-article', source });
  await until(() => finish !== undefined, '正文请求未开始');
  old.close();
  t.mock.timers.tick(1000);
  assert.equal(worker.sockets.length, 3);
  const current = worker.sockets[2];
  current.connect();
  finish(Response.json({ data: { errorCode: 401, errorData: { needLogin: true } } }));
  await nextTurn();
  await nextTurn();
  assert.deepEqual(current.events('editorialResult'), []);
  assert.deepEqual(old.events('editorialResult'), []);

  worker.setFetch(async () => Response.json(articleFixture));
  current.request('editorialRequest', { requestId: 'current-article', source });
  const result = await worker.response(current, 'editorialResult');
  assert.equal(result.requestId, 'current-article');
  assert.equal(result.ok, true);
  assert.equal(result.editorial.url, source.url);
});

test('background pageFetch 回包保留 requestId、HTTP 状态和正文，同时过滤凭据', async (t) => {
  const worker = await background(t);
  worker.setFetch(async (_url, init) => {
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'include');
    assert.equal(init.headers.get('x-lentille-request'), 'content-only');
    assert.equal(init.headers.has('cookie'), false);
    assert.equal(init.headers.has('authorization'), false);
    return new Response('原始题目内容', { status: 403, headers: {
      'Content-Type': 'text/html', 'cf-mitigated': 'challenge', 'Set-Cookie': 'not-exported',
    } });
  });
  const ws = worker.sockets[0];
  ws.request('pageFetchRequest', { requestId: 'page-1', url: problemUrl, headers: {
    'x-lentille-request': 'content-only', Cookie: 'not-imported', Authorization: 'not-imported',
  } });
  assert.deepEqual(await worker.response(ws, 'pageFetchResult'), {
    requestId: 'page-1', ok: true, page: {
      url: problemUrl, status: 403, headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' },
      body: '原始题目内容',
    },
  });
  assert.deepEqual(worker.openedTabs, []);
});

test('background pageFetch 拒绝修改请求，缺失 requestId 不触发读取', async (t) => {
  const worker = await background(t);
  const ws = worker.sockets[0];
  for (const requestId of [undefined, '', 123]) ws.request('pageFetchRequest', { requestId, url: problemUrl });
  ws.request('pageFetchRequest', { requestId: 'invalid', url: problemUrl, method: 'POST', body: 'code' });
  const response = await worker.response(ws, 'pageFetchResult');
  assert.equal(response.requestId, 'invalid');
  assert.equal(response.ok, false);
  assert.match(response.error, /不能指定方法或请求体/);
  assert.deepEqual(worker.calls, []);
});

for (const reconnect of ['manual', 'automatic']) {
  for (const outcome of ['success', 'error']) {
    test(`background pageFetch ${reconnect} 重连后忽略旧请求迟到的 ${outcome}`, async (t) => {
      const worker = await background(t);
      let finish;
      worker.setFetch(() => new Promise((resolve, reject) => {
        finish = () => outcome === 'success' ? resolve(new Response('old')) : reject(new Error('old error'));
      }));
      const old = worker.sockets[0];
      old.request('pageFetchRequest', { requestId: 'old-page', url: problemUrl });
      await until(() => finish !== undefined, '页面读取未开始');
      let current;
      if (reconnect === 'manual') current = await worker.reconnect();
      else {
        old.close();
        t.mock.timers.tick(1000);
        current = worker.sockets[1];
        current.connect();
      }
      finish();
      await nextTurn();
      await nextTurn();
      assert.deepEqual(old.events('pageFetchResult'), []);
      assert.deepEqual(current.events('pageFetchResult'), []);
      worker.setFetch(async () => new Response('current'));
      current.request('pageFetchRequest', { requestId: 'current-page', url: problemUrl });
      await nextTurn();
      t.mock.timers.tick(1000);
      const result = await worker.response(current, 'pageFetchResult');
      assert.equal(result.requestId, 'current-page');
      assert.equal(result.ok, true);
      assert.equal(result.page.body, 'current');
    });
  }
}
