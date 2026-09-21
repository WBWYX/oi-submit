import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listAtCoderEditorials, fetchAtCoderEditorial } from '../src/shared/editorial/atcoder.js';

const problemUrl = 'https://atcoder.jp/contests/abc420/tasks/abc420_a';
const source = { platform: 'atcoder', problemKey: 'abc420_a', title: 'A — Editorial', url: 'https://atcoder.jp/contests/abc420/editorial/13748', language: 'en' };
// 结构来自官方 abc420_a/editorial 与 editorial/13748 的真实 HTML，正文使用合成内容。
const item = (id, title = 'Editorial', author = 'writer', other = false) => `<li${other ? ' class="hidden lang-other"' : ''}><span class="label label-default">Official</span><a href="/contests/abc420/editorial/${id}">${title}</a> by <a href="/users/${author}" class="username"><span>${author}</span></a></li>`;
const indexPage = (items, overall = '', task = 'abc420_a') => `<div id="main-container"><span class="h2"><a href="/contests/abc420/tasks/${task}">A - Example</a> Editorial</span><hr><div class="editorial-section"><ul>${items}</ul><p class="no-editorial-msg hidden">There is no editorial yet.</p></div><h3>Overall Editorial</h3><div class="editorial-section">${overall}</div></div>`;
const article = (body, task = 'abc420_a') => `<div id="main-container"><nav>Navigation</nav><h2 class="mt-1"><a href="/contests/abc420/tasks/${task}">A - Example</a> Editorial <span class="small">by <a href="/users/en_translator"><span>en_translator</span></a></span></h2><hr class="mt-1"><div>${body}</div><div class="clearfix">posted: yesterday</div></div><footer>Footer text</footer>`;

test('AtCoder 仅列当前题目站内题解，英文优先并保留日文和作者', async () => {
  const html = indexPage(item(13725, '解説', 'sounansya', true) + item(13748, 'Editorial', 'en_translator') +
    '<li><a href="/jump?url=https%3A%2F%2Fexample.com">Video</a></li>', item(999, 'Overall'));
  const result = await listAtCoderEditorials(problemUrl, { getHtml: async (url) => {
    assert.equal(url, `${problemUrl}/editorial?lang=en`); return html;
  } });
  assert.equal(result.length, 2);
  assert.equal(result[0].url, source.url);
  assert.equal(result[0].language, 'en');
  assert.equal(result[0].author, 'en_translator');
  assert.equal(result[1].language, 'ja');
  assert.equal(result[1].author, 'sounansya');
  assert.ok(result.every((entry) => entry.platform === 'atcoder' && entry.problemKey === 'abc420_a'));
  assert.match(result[0].title, /官方/);
});

test('AtCoder 排序后最多20条、去重，并排除其他比赛和站外正文', async () => {
  const html = indexPage(Array.from({ length: 25 }, (_, i) => item(i + 1, '解説', 'writer', true)).join('') +
    item(13748) + item(13748) + '<li><a href="/contests/abc421/editorial/123">wrong contest</a></li>' +
    '<li><a href="https://evil.example/contests/abc420/editorial/456">external</a></li>');
  const result = await listAtCoderEditorials(problemUrl, { getHtml: async () => html });
  assert.equal(result.length, 20);
  assert.equal(result[0].url, source.url);
  assert.equal(new Set(result.map((row) => row.url)).size, 20);
  assert.ok(result.every((row) => !/abc421|evil/.test(row.url)));
});

test('AtCoder 未发布、错题索引和登录页明确失败', async () => {
  for (const [html, error] of [[indexPage(''), /尚未发布/], [indexPage(item(1), '', 'abc420_b'), /该题的题解索引/], ['<form>Sign In</form>', /登录与题目权限/]]) {
    await assert.rejects(() => listAtCoderEditorials(problemUrl, { getHtml: async () => html }), error);
  }
});

test('AtCoder 无效来源不触发网络请求', async () => {
  for (const url of ['https://evil.example/contests/abc420/tasks/abc420_a', 'https://atcoder.jp/contests/abc420', 'https://atcoder.jp:8443/contests/abc420/tasks/abc420_a']) {
    await assert.rejects(() => listAtCoderEditorials(url, { getHtml: () => assert.fail('unexpected request') }), /题目链接/);
  }
  await assert.rejects(() => fetchAtCoderEditorial({ ...source, url: 'https://evil.example/contests/abc420/editorial/13748' }, { getHtml: () => assert.fail('unexpected request') }), /题解链接无效/);
});

test('AtCoder 只取正文，保留代码公式图片和相对链接', async () => {
  const html = article('<h3>Idea</h3><p>Use <var>x + y</var> and \\(n\\).</p><a href="../submissions/1">code</a><img src="/images/diagram.png"><pre class="prettyprint"><code class="language-C++">#include &lt;bits/stdc++.h&gt;\nvector&lt;int&gt; a;\n</code></pre>');
  const result = await fetchAtCoderEditorial(source, { getHtml: async (url) => {
    assert.equal(url, `${source.url}?lang=en`); return html;
  } });
  assert.equal(result.author, 'en_translator');
  assert.equal(result.language, 'en');
  assert.ok(result.markdown.includes('#include <bits/stdc++.h>'));
  assert.ok(result.markdown.includes('vector<int> a;'));
  assert.ok(result.markdown.includes('$x + y$'));
  assert.ok(result.markdown.includes('\\(n\\)'));
  assert.ok(result.markdown.includes('https://atcoder.jp/images/diagram.png'));
  assert.ok(result.markdown.includes('https://atcoder.jp/contests/abc420/submissions/1'));
  assert.doesNotMatch(result.markdown, /Navigation|posted:|Footer text/);
});

test('AtCoder 日文正文原样返回，不伪造翻译', async () => {
  const result = await fetchAtCoderEditorial({ ...source, language: 'ja' }, { getHtml: async () => article('<p>整数を求めます。</p>') });
  assert.equal(result.language, 'ja');
  assert.equal(result.markdown, '整数を求めます。');
});

test('AtCoder 错题、正文缺失和空正文不落成成功文章', async () => {
  for (const [html, error] of [
    [article('<p>wrong task</p>', 'abc420_b'), /不匹配/],
    [article('').replace('<div></div>', ''), /正文区块缺失/],
    [article(''), /正文为空/],
    ['<form>Sign In</form>', /无权访问/],
  ]) {
    await assert.rejects(() => fetchAtCoderEditorial(source, { getHtml: async () => html }), error);
  }
});
