import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listNowcoderEditorials, fetchNowcoderEditorial } from '../src/shared/editorial/nowcoder.js';

const uuid = 'a'.repeat(32);
const source = { platform: 'nowcoder', problemKey: '13885', title: '列表标题', url: `https://blog.nowcoder.net/n/${uuid}`, author: '作者' };
const card = (id = uuid) => `<div class="subject-analysis-item js-blog-item" data-uuid="${id}"><div class="analysis-head"><a class="name level-color-5">作者 &amp; 朋友</a></div><div class="js-blog-tiny">截断摘要</div><a href="https://blog.nowcoder.net/n/${id}?f=comment">回复</a></div>`;
const listPage = (cards = card()) => `<title>题目题解_牛客竞赛OJ</title><a href="/login">登录</a><span class="crumbs-end js-question-title">Music Problem</span><div class="module-body js-blog-list">${cards}</div>`;

test('牛客仅列当前题目的题解卡片，忽略博客主页与页面其他帖子', async () => {
  const urls = [];
  const sources = await listNowcoderEditorials('https://ac.nowcoder.com/acm/problem/13885', {
    async getHtml(url) {
      urls.push(url);
      return `${listPage()}${card('b'.repeat(32))}`;
    },
  });
  assert.deepEqual(urls, ['https://ac.nowcoder.com/acm/problem/blogs/13885']);
  assert.equal(sources.length, 1);
  assert.deepEqual(sources[0], { ...source, title: 'Music Problem（作者 & 朋友）', author: '作者 & 朋友' });
});

test('牛客比赛通过 pageInfo.problemId 映射题库，不误用 questionId 或题面文本', async () => {
  const urls = [];
  const sources = await listNowcoderEditorials('https://ac.nowcoder.com/acm/contest/5203/B', {
    async getHtml(url) {
      urls.push(url);
      if (urls.length === 1) return `<p>problemId: '1',</p><script>window.pageInfo = { settingInfo: {allowTeamSignUp: false}, contestId: '5203', questionId: '126116', problemId: '13885', doneQuestionId: '5203' };</script>`;
      return listPage();
    },
  });
  assert.deepEqual(urls, ['https://ac.nowcoder.com/acm/contest/5203/B', 'https://ac.nowcoder.com/acm/problem/blogs/13885']);
  assert.equal(sources[0].problemKey, '5203-B');
});

test('牛客缺失比赛题映射时不猜题号，也不抓整个比赛讨论区', async () => {
  let calls = 0;
  await assert.rejects(listNowcoderEditorials('https://ac.nowcoder.com/acm/contest/5203/B', {
    async getHtml() {
      calls++;
      return `<script>window.pageInfo = { questionId: '126116' };</script>`;
    },
  }), /未提供题库 problemId/);
  assert.equal(calls, 1);
});

test('牛客列表去重并限制最多二十篇', async () => {
  const cards = [card(), card(), ...Array.from({ length: 25 }, (_, i) => card(i.toString(16).padStart(32, '0')))];
  const sources = await listNowcoderEditorials('https://ac.nowcoder.com/acm/problem/13885', { getHtml: async () => listPage(cards.join('')) });
  assert.equal(sources.length, 20);
  assert.equal(new Set(sources.map((s) => s.url)).size, 20);
});

test('牛客空列表、页面结构变化和登录页面分别报错', async () => {
  for (const [html, message] of [
    [listPage('<div class="blank-box"><p>暂无题解</p></div>'), /暂无可用题解/],
    ['<title>题目</title><div>新页面</div>', /列表结构变化/],
    [listPage('<div>无法识别的文章列表</div>'), /列表结构变化/],
    ['<title>登录 - 牛客网</title>', /要求登录/],
  ]) {
    await assert.rejects(listNowcoderEditorials('https://ac.nowcoder.com/acm/problem/13885', { getHtml: async () => html }), message);
  }
});

test('牛客下载文章完整正文，保留代码、公式和链接', async () => {
  const html = `<h1 class="title-item strong">真正的文章标题</h1><div class="post-content js-nc-pop-image nc-markdown-body"><h2>思路</h2><p>$a+b$，<a href="https://ac.nowcoder.com/acm/problem/13885">题目链接</a></p><pre><code>#include &lt;iostream&gt;\ncout &lt;&lt; "&lt;tag&gt;";</code></pre></div><div>推荐内容</div><script>window.pageInfo = { isTryRead: false, hasViewAllRight: true };</script>`;
  const result = await fetchNowcoderEditorial(source, { getHtml: async (url) => { assert.equal(url, source.url); return html; } });
  assert.equal(result.title, '真正的文章标题');
  assert.match(result.markdown, /\$a\+b\$/);
  assert.ok(result.markdown.includes('[题目链接](<https://ac.nowcoder.com/acm/problem/13885>)'));
  assert.ok(result.markdown.includes('#include <iostream>'));
  assert.ok(result.markdown.includes('cout << "<tag>";'));
  assert.ok(!result.markdown.includes('推荐内容'));
});

test('牛客试读、无全文权限和空正文不会伪装成抓取成功', async () => {
  for (const [html, message] of [
    [`<div class="nc-markdown-body">摘要</div><script>window.pageInfo = { isTryRead: true, hasViewAllRight: false };</script>`, /没有.*全文阅读权限/],
    ['<div class="nc-markdown-body"> \n </div>', /正文为空/],
    ['<div class="comment-content">评论不是题解</div>', /正文结构变化/],
  ]) {
    await assert.rejects(fetchNowcoderEditorial(source, { getHtml: async () => html }), message);
  }
});

test('牛客仅接受官方题目和选中的博客文章链接', async () => {
  const client = { getHtml: async () => assert.fail('不应请求非题解来源') };
  await assert.rejects(listNowcoderEditorials('https://ac.nowcoder.com/acm/contest/5203', client), /具体题目链接/);
  await assert.rejects(fetchNowcoderEditorial({ ...source, url: `https://example.com/n/${uuid}` }, client), /来源无效/);
  await assert.rejects(fetchNowcoderEditorial({ ...source, url: 'https://blog.nowcoder.net/author' }, client), /来源无效/);
});
