import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPageFetcher, pageUrl } from '../src/shared/page-fetch.js';

const problem = 'https://www.luogu.com.cn/problem/P1001';
const uuid = 'a'.repeat(32);

function clocked(fetchImpl) {
  let time = 0;
  return createPageFetcher({ fetchImpl, now: () => time, sleep: async (ms) => { time += ms; } });
}

test('pageFetch 白名单覆盖 OI Bench 的比赛目录、题目、题解、讨论和记录读取入口', () => {
  for (const url of [
    'https://www.luogu.com.cn/contest/list?_contentOnly=1&page=2',
    'https://atcoder.jp/contests/',
    'https://ac.nowcoder.com/acm/contest/vip-index',
    `${problem}?_contentOnly=1&contestId=339238`,
    'https://www.luogu.com.cn/problem/AT_abc420_a?_contentOnly=1',
    'https://www.luogu.com.cn/problem/solution/P1001?_contentOnly=1&page=2',
    'https://www.luogu.com.cn/contest/339238?_contentOnly=1',
    'https://www.luogu.com.cn/discuss/1334861?_contentOnly=1&page=3',
    'https://www.luogu.com.cn/record/288512623?_contentOnly=1',
    'https://www.luogu.com.cn/article/abc123',
    'https://codeforces.com/api/contest.list?gym=false',
    'https://codeforces.com/api/blogEntry.view?blogEntryId=143186',
    'https://codeforces.com/contest/2110?locale=en',
    'https://codeforces.com/contest/2110/problem/A?locale=en',
    'https://www.codeforces.com/gym/105000/problem/A1',
    'https://codeforces.com/problemset/problem/2110/A',
    'https://codeforces.com/blog/entry/143186?locale=ru',
    'https://atcoder.jp/contests/abc420?lang=en',
    'https://atcoder.jp/contests/abc420/tasks?lang=en',
    'https://atcoder.jp/contests/abc420/tasks/abc420_a?lang=ja',
    'https://atcoder.jp/contests/abc420/tasks/abc420_a/editorial?lang=en',
    'https://atcoder.jp/contests/abc420/editorial?lang=en',
    'https://atcoder.jp/contests/abc420/editorial/13748?lang=en',
    'https://ac.nowcoder.com/acm/contest/123',
    'https://ac.nowcoder.com/acm/contest/123/AA',
    'https://ac.nowcoder.com/acm/contest/problem-list?id=123',
    'https://ac.nowcoder.com/acm/problem/123',
    'https://ac.nowcoder.com/acm/problem/blogs/123',
    'https://ac.nowcoder.com/acm/discuss/blogs/answer/list?contestId=123&page=2',
    'https://ac.nowcoder.com/acm/discuss/123',
    'https://www.nowcoder.com/discuss/123',
    `https://www.nowcoder.com/blog/content?uuid=${uuid}`,
    `https://blog.nowcoder.net/n/${uuid}`,
  ]) assert.equal(pageUrl(url).href, url);
});

test('pageFetch 在请求前拒绝外部域名、修改入口、认证信息和未支持的查询参数', async () => {
  const fetchPage = clocked(() => assert.fail('不应发出网络请求'));
  for (const url of [
    'http://www.luogu.com.cn/problem/P1001', 'file:///secret', 'https://127.0.0.1/',
    'https://codeforces.com.evil.test/contest/2110', 'https://evil.test/problem/P1001',
    'https://user:password@codeforces.com/contest/2110', 'https://codeforces.com:1234/contest/2110',
    'https://codeforces.com/logout', 'https://codeforces.com/contest/2110/submit',
    'https://codeforces.com/api/contest.hacks', 'https://atcoder.jp/contests/abc420/submit',
    'https://www.luogu.com.cn/api/problem/submit', 'https://ac.nowcoder.com/acm/contest/123/logout',
    `${problem}?action=delete`, `${problem}?contestId=-1`, `${problem}?_contentOnly=1&_contentOnly=1`,
  ]) await assert.rejects(fetchPage({ url }), /仅允许|查询参数/);
  for (const request of [{ url: problem, method: 'GET' }, { url: problem, body: '' }]) {
    await assert.rejects(fetchPage(request), /不能指定方法或请求体/);
  }
});

test('pageFetch 仅保留读取头，浏览器附带登录态且不回传 Cookie 或认证头', async () => {
  const fetchPage = clocked(async (url, init) => {
    assert.equal(url, problem);
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'include');
    assert.equal(init.redirect, 'manual');
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(Object.fromEntries(init.headers), {
      accept: 'application/json', 'accept-language': 'zh-CN', 'x-lentille-request': 'content-only',
    });
    return new Response('题面', { status: 403, headers: {
      'Content-Type': 'text/html', 'Retry-After': '30', 'cf-mitigated': 'challenge',
      'Set-Cookie': 'never-return', Authorization: 'never-return',
    } });
  });
  const page = await fetchPage({ url: problem, headers: {
    Accept: 'application/json', 'accept-language': 'zh-CN', 'x-lentille-request': 'content-only',
    Cookie: 'private\nmalformed', Authorization: 'private', 'User-Agent': 'spoofed', Referer: 'https://evil.test',
  } });
  assert.deepEqual(page, {
    url: problem, status: 403, body: '题面',
    headers: { 'content-type': 'text/html', 'retry-after': '30', 'cf-mitigated': 'challenge' },
  });
});

test('pageFetch 未执行错误页脚本，保留 HTTP 状态和原文交给平台解析器', async () => {
  const body = '<script>throw new Error("must not execute")</script><title>Just a moment</title>';
  const fetchPage = clocked(async () => new Response(body, { status: 429 }));
  const page = await fetchPage({ url: problem });
  assert.equal(page.status, 429);
  assert.equal(page.body, body);
});

test('pageFetch 校验最终 URL 和 Location，不跟随到外站或修改路径', async () => {
  for (const target of ['https://evil.test/', 'https://codeforces.com/contest/2110', 'https://www.luogu.com.cn/auth/logout']) {
    const response = new Response('unreadable');
    Object.defineProperty(response, 'url', { value: target });
    await assert.rejects(clocked(async () => response)({ url: problem }), /仅允许|其他站点/);
  }
  for (const location of ['/auth/logout', 'https://evil.test/', 'https://atcoder.jp/contests/abc420']) {
    const response = new Response('', { status: 302, headers: { Location: location } });
    await assert.rejects(clocked(async () => response)({ url: problem }), /仅允许|其他站点/);
  }
  const fetchPage = clocked(async () => new Response('', { status: 302, headers: { Location: '/problem/P1002' } }));
  const page = await fetchPage({ url: problem });
  assert.equal(page.status, 302);
  assert.equal(page.headers.location, '/problem/P1002');
});

test('pageFetch 不把浏览器不可读重定向伪装为成功页面', async () => {
  const response = new Response('');
  Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
  await assert.rejects(clocked(async () => response)({ url: problem }), /浏览器打开最终原文页面/);
});

test('pageFetch 同一站点严格排队，CF API 两次开始至少相隔 2.1 秒', async () => {
  let time = 0;
  const starts = [];
  let active = 0;
  const fetchPage = createPageFetcher({
    now: () => time,
    sleep: async (ms) => { time += ms; },
    fetchImpl: async (url) => {
      assert.equal(active++, 0);
      starts.push([new URL(url).pathname, time]);
      await Promise.resolve();
      active -= 1;
      return new Response('ok');
    },
  });
  await Promise.all([
    fetchPage({ url: 'https://codeforces.com/api/contest.list?gym=false' }),
    fetchPage({ url: 'https://codeforces.com/contest/2110' }),
    fetchPage({ url: 'https://www.codeforces.com/api/blogEntry.view?blogEntryId=143186' }),
    fetchPage({ url: 'https://codeforces.com/api/contest.list?gym=false' }),
  ]);
  assert.deepEqual(starts.map(([, start]) => start), [0, 1000, 2100, 4200]);
});

test('pageFetch 牛客子域共用每秒队列，失败后仍能继续读取', async () => {
  let time = 0;
  const starts = [];
  const fetchPage = createPageFetcher({
    now: () => time, sleep: async (ms) => { time += ms; },
    fetchImpl: async () => {
      starts.push(time);
      if (starts.length === 1) throw new Error('offline');
      return new Response('ok');
    },
  });
  const first = fetchPage({ url: 'https://ac.nowcoder.com/acm/contest/123' });
  const second = fetchPage({ url: `https://www.nowcoder.com/blog/content?uuid=${uuid}` });
  await assert.rejects(first, /offline/);
  assert.equal((await second).body, 'ok');
  assert.deepEqual(starts, [0, 1000]);
});

test('pageFetch 不同站点队列互不阻塞', async () => {
  let finish;
  const fetchPage = clocked((url) => url === problem
    ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(new Response('independent')));
  const pending = fetchPage({ url: problem });
  assert.equal((await fetchPage({ url: 'https://atcoder.jp/contests/abc420' })).body, 'independent');
  finish(new Response('done'));
  assert.equal((await pending).body, 'done');
});

test('pageFetch 下载超出 5 MiB 即取消流并释放锁', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(clocked(async () => response)({ url: problem }), /超过 5 MiB/);
  assert.equal(cancelled, true);
  assert.equal(response.body.locked, false);
});

test('pageFetch 接受 5 MiB 普通文本，但拒绝 JSON 转义后超过 6 MiB 的正文', async () => {
  const body = 'a'.repeat(5 * 1024 * 1024);
  const page = await clocked(async () => new Response(body))({ url: problem });
  assert.equal(page.body.length, body.length);
  await assert.rejects(clocked(async () => new Response('\0'.repeat(1024 * 1024)))({ url: problem }), /序列化后超过 6 MiB/);
});

test('pageFetch 正确解码 UTF-8 跨块中文', async () => {
  const bytes = new TextEncoder().encode('题面与题解 ✓');
  const response = new Response(new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  }));
  assert.equal((await clocked(async () => response)({ url: problem })).body, '题面与题解 ✓');
});
