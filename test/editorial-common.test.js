import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorialClient, editorialHtmlToMarkdown, editorialUrl } from '../src/shared/editorial/common.js';

test('题解 HTML 保留代码中的 C++ 模板、实体、空行和围栏', () => {
  const markdown = editorialHtmlToMarkdown(
    '<h2>做法</h2><pre><code class="language-cpp">#include &lt;bits/stdc++.h&gt;\n' +
    'vector&lt;int&gt; a;\n\ncout &lt;&lt; "&amp;lt;```";</code></pre><p><code>a &lt; b</code></p>',
    'https://atcoder.jp/contests/abc420/editorial/1',
  );
  assert.ok(markdown.startsWith('## 做法'));
  assert.ok(markdown.includes('````cpp\n#include <bits/stdc++.h>\nvector<int> a;\n\ncout << "&lt;```";\n````'));
  assert.ok(markdown.includes('` a < b `'));
});

test('题解公式与相对链接、图片在离线 Markdown 中仍可读', () => {
  const markdown = editorialHtmlToMarkdown(
    '<p><var>x &lt; y</var> $$$n^2$$$</p>' +
    '<script type="math/tex; mode=display">a &lt; b</script>' +
    '<script>alert(1)</script><a href="../2"><code>参考</code></a>' +
    '<img src="/images/a.png" alt="示意图"><a href="javascript:alert(1)">危险链接</a>',
    'https://atcoder.jp/contests/abc420/editorial/1',
  );
  assert.ok(markdown.includes('$x < y$'));
  assert.ok(markdown.includes('$n^2$'));
  assert.ok(markdown.includes('$$a < b$$'));
  assert.ok(markdown.includes('[` 参考 `](<https://atcoder.jp/contests/abc420/2>)'));
  assert.ok(markdown.includes('![示意图](<https://atcoder.jp/images/a.png>)'));
  assert.ok(!markdown.includes('alert(1)'));
});

test('题解表格保留单元格分隔和其中的公式', () => {
  const markdown = editorialHtmlToMarkdown(
    '<table><tr><th>状态</th><th>答案</th></tr><tr><td><var>dp_i</var></td><td>1</td></tr></table>',
    'https://codeforces.com/blog/entry/1',
  );
  assert.equal(markdown, '| 状态 | 答案 |\n| --- | --- |\n| $dp_i$ | 1 |');
});

test('普通美元公式中的不等号不会被当成 HTML 标签', () => {
  assert.equal(editorialHtmlToMarkdown('<p>$a < b$ and $c > d$</p>', 'https://codeforces.com/'), '$a < b$ and $c > d$');
});

test('表格中的代码与绝对值公式包含竖线时仍保持单元格数量', () => {
  const markdown = editorialHtmlToMarkdown(
    '<table><tr><th>表达式</th><th>值</th></tr><tr><td><code>a|b</code></td><td>$|x|$</td></tr></table>',
    'https://codeforces.com/',
  );
  assert.ok(markdown.includes('| ` a\\|b ` | $\\|x\\|$ |'));
});

test('题解请求只接受明确的平台域名和标准端口', () => {
  for (const url of [
    'http://127.0.0.1/secret', 'https://evilcodeforces.com/blog/entry/1',
    'https://codeforces.com.evil.test/', 'file:///tmp/note',
    'https://user:password@codeforces.com/', 'https://atcoder.jp:1234/',
  ]) assert.throws(() => editorialUrl(url));
  assert.equal(editorialUrl('http://blog.nowcoder.net/n/abc'), 'https://blog.nowcoder.net/n/abc');
});

test('题解 HTTP 共用登录态、超时、JSON 请求头和表单编码', async () => {
  const calls = [];
  const client = createEditorialClient(async (url, init) => {
    calls.push({ url, init });
    return Response.json({ ok: true });
  });
  await client.getJson('https://www.luogu.com.cn/article/abc', { 'x-lentille-request': 'content-only' });
  await client.postForm('https://codeforces.com/data/tutorial', { problemCode: '123A', token: 'a+b' });
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.headers['x-lentille-request'], 'content-only');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.body, 'problemCode=123A&token=a%2Bb');
});

test('题解表单合并请求头不修改调用方数据，并固定表单编码及禁止重定向', async () => {
  const headers = new Headers({ 'X-Csrf-Token': 'test-only', 'content-type': 'text/plain', accept: 'text/html' });
  const client = createEditorialClient(async (_url, init) => {
    assert.equal(init.headers.get('X-Csrf-Token'), 'test-only');
    assert.equal(init.headers.get('Content-Type'), 'application/x-www-form-urlencoded;charset=UTF-8');
    assert.equal(init.headers.get('Accept'), 'application/json');
    assert.equal(init.redirect, 'error');
    return Response.json({ ok: true });
  });
  await client.postForm('https://codeforces.com/data/tutorial', { problemCode: '123A' }, headers);
  assert.equal(headers.get('Content-Type'), 'text/plain');
  assert.equal(headers.get('Accept'), 'text/html');
});

test('题解接口正确说明登录、限流、不存在和非 JSON 响应', async () => {
  for (const [status, message] of [[401, /登录/], [403, /登录/], [429, /频繁/], [404, /尚未发布/], [502, /502/]]) {
    const client = createEditorialClient(async () => new Response('', { status }));
    await assert.rejects(client.getHtml('https://atcoder.jp/'), message);
  }
  const client = createEditorialClient(async () => new Response('<html>登录</html>'));
  await assert.rejects(client.getJson('https://www.luogu.com.cn/'), /没有返回题解数据/);
});

test('下载超过上限时取消流，不继续读取后续内容', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  }));
  const client = createEditorialClient(async () => response);
  await assert.rejects(client.getHtml('https://codeforces.com/'), /超过 5 MB/);
  assert.equal(cancelled, true);
  assert.equal(response.body.locked, false);
});

test('UTF-8 中文在网络分块边界不会损坏', async () => {
  const bytes = new TextEncoder().encode('题解 ✓');
  const client = createEditorialClient(async () => new Response(new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  })));
  assert.equal(await client.getHtml('https://atcoder.jp/'), '题解 ✓');
});
