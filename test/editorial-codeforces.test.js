import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { listCodeforcesEditorials, fetchCodeforcesEditorial } from '../src/shared/editorial/codeforces.js';
import { createEditorialClient } from '../src/shared/editorial/common.js';

const source = { platform: 'codeforces', problemKey: '2110A', title: 'Tutorial', url: 'https://codeforces.com/blog/entry/143186' };
const materials = (links) => `<div class="roundbox sidebox"><div class="caption titled">→ Contest materials</div><ul>${links}</ul></div>`;
const payload = (content, extra = {}) => ({ status: 'OK', result: { id: 143186, title: '<p>Round 1026 Editorial</p>', authorHandle: 'writer', locale: 'en', content, ...extra } });
const placeholder = (code) => `<div class="problemTutorial" problemCode="${code}">Tutorial is loading...</div>`;
const testCsrf = 'a'.repeat(32);
const tutorialPage = (tokenHtml = `<meta name="X-Csrf-Token" content="${testCsrf}">`) =>
  `${tokenHtml}<script>Codeforces.setupTutorials("/data/tutorial-from-page", $("html"));</script>`;

test('CF 列表从已存在的真实题面夹具提取教程，不选公告', async () => {
  const html = await readFile(new URL('./fixtures/cf-3B.html', import.meta.url), 'utf8');
  const calls = [];
  const result = await listCodeforcesEditorials('https://codeforces.com/problemset/problem/3/B', {
    getHtml: async (url) => { calls.push(url); return html; },
  });
  assert.deepEqual(calls, ['https://codeforces.com/problemset/problem/3/B?locale=en']);
  assert.deepEqual(result.map((row) => row.url), ['https://codeforces.com/blog/entry/192', 'https://codeforces.com/blog/entry/142']);
  assert.deepEqual(result.map((row) => row.language), ['en', 'ru']);
  assert.ok(result.every((row) => row.problemKey === '3B' && /整场教程/.test(row.title)));
});

test('CF 列表去重、限量且忽略其他侧栏和站外链接', async () => {
  const tutorial = (id) => `<li><a href="/blog/entry/${id}">Tutorial</a></li>`;
  const html = `<div class="sidebox"><div class="caption">Recent actions</div>${tutorial(900)}</div>` +
    materials('<a href="https://evil.example/blog/entry/901">Editorial</a>' + tutorial(1) + tutorial(1) + Array.from({ length: 30 }, (_, i) => tutorial(i + 2)).join(''));
  const result = await listCodeforcesEditorials('https://codeforces.com/contest/2110/problem/A', { getHtml: async () => html });
  assert.equal(result.length, 20);
  assert.equal(new Set(result.map((row) => row.url)).size, 20);
  assert.ok(result.every((row) => !/900|901|evil/.test(row.url)));
});

test('CF 无教程与登录页明确报错，不把其他博客当题解', async () => {
  for (const [html, error] of [
    [materials('<a href="/blog/entry/1">Announcement</a>'), /尚未提供/],
    ['<div class="problem-statement">题面</div>', /尚未提供/],
    ['<form>Log in</form>', /登录与权限/],
  ]) {
    await assert.rejects(() => listCodeforcesEditorials('https://codeforces.com/contest/2110/problem/A', { getHtml: async () => html }), error);
  }
});

test('CF 非题目或站外URL不触发网络请求', async () => {
  for (const url of ['https://evil.example/contest/2110/problem/A', 'https://codeforces.com/blog/entry/1', 'https://user:secret@codeforces.com/contest/2110/problem/A']) {
    await assert.rejects(() => listCodeforcesEditorials(url, { getHtml: () => assert.fail('unexpected request') }), /题目链接/);
  }
});

test('CF 官方API正文保留代码、公式、图片和链接，并标明整场教程', async () => {
  const result = await fetchCodeforcesEditorial(source, { getJson: async (url) => {
    assert.equal(url, 'https://codeforces.com/api/blogEntry.view?blogEntryId=143186');
    return payload('<h2>A</h2><p>$$$x+y$$$ <a href="/contest/2110/problem/A">problem</a></p><img src="/images/example.png"><pre><code>#include &lt;bits/stdc++.h&gt;\nvector&lt;int&gt; a;</code></pre>');
  } });
  assert.equal(result.author, 'writer');
  assert.equal(result.language, 'en');
  assert.match(result.title, /整场教程/);
  assert.match(result.markdown, /本文为该场比赛的整篇教程/);
  assert.ok(result.markdown.includes('#include <bits/stdc++.h>'));
  assert.ok(result.markdown.includes('vector<int> a;'));
  assert.ok(result.markdown.includes('$x+y$'));
  assert.ok(result.markdown.includes('https://codeforces.com/images/example.png'));
  assert.ok(result.markdown.includes('https://codeforces.com/contest/2110/problem/A'));
});

test('CF API失败、正文缺失及ID不匹配都不伪造正文', async () => {
  for (const response of [{ status: 'FAILED', comment: 'not found' }, payload('', {}), payload('<p>wrong</p>', { id: 1 })]) {
    await assert.rejects(() => fetchCodeforcesEditorial(source, { getJson: async () => response }), /未发布|缺失|不匹配/);
  }
});

test('CF 动态教程仅使用页面给定同源端点，按题号加载且重复章节只请求一次', async () => {
  const calls = [];
  const result = await fetchCodeforcesEditorial(source, {
    getJson: async () => payload(placeholder('2110A') + placeholder('2110B') + placeholder('2110A')),
    getHtml: async (url) => {
      assert.equal(url, source.url);
      // 合成路径用于证明实现没有硬编码内部端点；请求方法来自已核实官方 setupTutorials。
      return tutorialPage();
    },
    postForm: async (url, values, headers) => {
      const request = new URL(url);
      assert.equal(request.origin, 'https://codeforces.com');
      assert.match(request.searchParams.get('rv'), /^[a-z0-9]+$/);
      assert.equal(values.csrf_token, testCsrf);
      assert.equal(headers['X-Csrf-Token'], testCsrf);
      calls.push([request.pathname, values.problemCode]);
      return { success: 'true', public: values.problemCode === '2110A' ? 'true' : 'false', html: `<p>${values.problemCode} 解法 $$$x$$$</p>` };
    },
  });
  assert.deepEqual(calls, [
    ['/data/tutorial-from-page', '2110A'],
    ['/data/tutorial-from-page', '2110B'],
  ]);
  assert.ok(result.markdown.includes('2110A 解法 $x$'));
  assert.ok(result.markdown.includes('2110B 解法 $x$'));
  assert.doesNotMatch(result.markdown, /Tutorial is loading/);
});

test('CF 不猜动态端点、不接受站外端点或普通正文里的伪调用', async () => {
  for (const html of [
    '<html>missing</html>',
    '<script>Codeforces.setupTutorials("https://evil.example/collect")</script>',
    '<p>Codeforces.setupTutorials("/data/guessed")</p>',
  ]) {
    await assert.rejects(() => fetchCodeforcesEditorial(source, {
      getJson: async () => payload(placeholder('2110A')), getHtml: async () => `<meta name="X-Csrf-Token" content="${testCsrf}">${html}`,
      postForm: () => assert.fail('unverified endpoint requested'),
    }), /同源读取接口/);
  }
});

test('CF 动态章节最多三个并发，乱序完成仍保留章节顺序', async () => {
  const codes = ['2110A', '2110B', '2110C', '2110D', '2110E', '2110F'];
  let active = 0;
  let maximum = 0;
  const result = await fetchCodeforcesEditorial(source, {
    getJson: async () => payload(codes.map(placeholder).join('')),
    getHtml: async () => tutorialPage(),
    postForm: async (_url, { problemCode }) => {
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, problemCode === '2110A' ? 10 : 0));
      active -= 1;
      return { success: true, public: true, html: `<p>${problemCode} 解法</p>` };
    },
  });
  assert.equal(maximum, 3);
  assert.equal(active, 0);
  const positions = codes.map((code) => result.markdown.indexOf(`${code} 解法`));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.ok(positions.every((position) => position >= 0));
});

test('CF 动态权限失败或占位返回不被当作完整题解', async () => {
  for (const response of [
    { success: false, public: false, html: '<p>Permission denied</p>' },
    { success: 'true', html: '' },
    { success: 'true', html: placeholder('2110A') },
  ]) {
    await assert.rejects(() => fetchCodeforcesEditorial(source, {
      getJson: async () => payload(placeholder('2110A')),
      getHtml: async () => tutorialPage(),
      postForm: async () => response,
    }), /未发布|无权|未加载/);
  }
});

test('CF 动态页面访问失败保留原文入口和真实错误', async () => {
  await assert.rejects(() => fetchCodeforcesEditorial(source, {
    getJson: async () => payload(placeholder('2110A')),
    getHtml: async () => { throw new Error('HTTP 403'); },
  }), /143186.*HTTP 403/);
});

test('CF 动态教程完整 HTTP 链路复刻同页 CSRF 字段、请求头和防缓存参数', async () => {
  const calls = [];
  const client = createEditorialClient(async (url, init) => {
    const request = new URL(url);
    calls.push(request.pathname);
    if (request.pathname === '/api/blogEntry.view') return Response.json(payload(placeholder('2110A')));
    if (request.pathname === '/blog/entry/143186') {
      return new Response(tutorialPage(`<span class="csrf-token" data-csrf="${'b'.repeat(32)}"></span><meta content="${testCsrf}" name="X-Csrf-Token">`)
        .replace('/data/tutorial-from-page', '/data/tutorial-from-page?from=blog'));
    }
    assert.equal(request.origin, 'https://codeforces.com');
    assert.equal(request.pathname, '/data/tutorial-from-page');
    assert.equal(request.searchParams.get('from'), 'blog');
    assert.match(request.searchParams.get('rv'), /^[a-z0-9]+$/);
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'include');
    assert.equal(init.redirect, 'error');
    const values = new URLSearchParams(init.body);
    assert.equal(values.get('problemCode'), '2110A');
    assert.equal(values.get('csrf_token'), testCsrf);
    assert.equal(init.headers.get('X-Csrf-Token'), testCsrf);
    assert.equal(init.headers.get('Content-Type'), 'application/x-www-form-urlencoded;charset=UTF-8');
    return Response.json({ success: 'true', public: 'true', html: '<p>完整解法</p>' });
  });
  const result = await fetchCodeforcesEditorial(source, client);
  assert.deepEqual(calls, ['/api/blogEntry.view', '/blog/entry/143186', '/data/tutorial-from-page']);
  assert.match(result.markdown, /完整解法/);
  assert.ok(!JSON.stringify(result).includes(testCsrf));
});

test('CF 无效 meta 回退到同页 span，后续页面缺少 CSRF 时不复用旧标记', async () => {
  let page = tutorialPage(`<meta name="X-Csrf-Token" content="invalid"><span data-csrf='${testCsrf}' class='hidden csrf-token'></span>`);
  let posts = 0;
  const client = {
    getJson: async () => payload(placeholder('2110A')),
    getHtml: async () => page,
    postForm: async (_url, values, headers) => {
      posts += 1;
      assert.equal(values.csrf_token, testCsrf);
      assert.equal(headers['X-Csrf-Token'], testCsrf);
      return { success: true, html: '<p>解法</p>' };
    },
  };
  await fetchCodeforcesEditorial(source, client);
  for (const tokenHtml of ['', '<meta name="X-Csrf-Token" content="invalid">', `<meta data-name="X-Csrf-Token" content="${testCsrf}">`]) {
    page = tutorialPage(tokenHtml);
    await assert.rejects(() => fetchCodeforcesEditorial(source, client), /缺少有效的 CSRF 标记/);
  }
  assert.equal(posts, 1);
});
