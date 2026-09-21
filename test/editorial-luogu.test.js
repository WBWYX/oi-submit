import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listLuoguEditorials, fetchLuoguEditorial } from '../src/shared/editorial/luogu.js';

const problemUrl = 'https://www.luogu.com.cn/problem/P1001';
const source = { platform: 'luogu', problemKey: 'P1001', title: '列表标题', url: 'https://www.luogu.com.cn/article/test1234' };
const article = { lid: 'test1234', title: '完整题解', author: { name: '作者' }, solutionFor: { pid: 'P1001' } };

test('洛谷按题号读官方题解列表，保留作者，只列文章不下载正文', async () => {
  const requests = [];
  const sources = await listLuoguEditorials(`${problemUrl}?contestId=1#submit`, {
    async getJson(url, headers) {
      requests.push(url);
      assert.equal(headers['x-lentille-request'], 'content-only');
      return { template: 'problem.solution', status: 200, data: { problem: { pid: 'P1001' }, solutions: { count: 1, result: [article] } } };
    },
  });
  assert.deepEqual(requests, ['https://www.luogu.com.cn/problem/solution/P1001']);
  assert.deepEqual(sources, [{ ...source, title: '完整题解', author: '作者' }]);
});

test('洛谷列表去重、过滤其他题目并限制最多二十篇', async () => {
  const rows = [article, article, { ...article, lid: 'other', solutionFor: { pid: 'P1002' } },
    ...Array.from({ length: 25 }, (_, i) => ({ ...article, lid: `id${i}` }))];
  const sources = await listLuoguEditorials(problemUrl, { getJson: async () => ({ data: { solutions: { result: rows } } }) });
  assert.equal(sources.length, 20);
  assert.equal(new Set(sources.map((s) => s.url)).size, 20);
  assert.ok(sources.every((s) => !s.url.endsWith('/other')));
});

test('洛谷获取所选文章的原始 Markdown，不破坏代码、公式和链接', async () => {
  const markdown = '## 思路\n\n$a+b$\n\n[题目](/problem/P1001)\n\n```cpp\n#include <iostream>\ncout << "<tag>";\n```\n';
  const got = await fetchLuoguEditorial(source, {
    async getJson(url, headers) {
      assert.equal(url, source.url);
      assert.equal(headers['x-lentille-request'], 'content-only');
      return { data: { article: { ...article, content: markdown, contentFull: true } } };
    },
  });
  assert.equal(got.markdown, markdown);
  assert.equal(got.title, '完整题解');
  assert.equal(got.author, '作者');
});

test('洛谷未登录、无题解和结构变化提供不同错误', async () => {
  for (const [body, message] of [
    [{ status: 401, data: { errorCode: 401, errorData: { needLogin: 1 } } }, /需要登录/],
    [{ status: 403, data: { errorCode: 403 } }, /没有权限/],
    [{ data: { solutions: { result: [] } } }, /暂无可用题解/],
    [{ data: { unknown: [] } }, /结构变化/],
    [{ data: { problem: { pid: 'P1002' }, solutions: { result: [article] } } }, /题号不一致/],
  ]) {
    await assert.rejects(listLuoguEditorials(problemUrl, { getJson: async () => body }), message);
  }
});

test('洛谷拒绝摘要、空正文和不属于所选题目的文章', async () => {
  for (const [changes, message] of [
    [{ content: '只能试读', contentFull: false }, /仅返回题解摘要/],
    [{ content: ' \n ', contentFull: true }, /正文为空/],
    [{ content: '其他题', solutionFor: { pid: 'P1002' } }, /属于其他题目/],
    [{ content: '错误文章', lid: 'different' }, /未找到所选题解/],
  ]) {
    await assert.rejects(fetchLuoguEditorial(source, { getJson: async () => ({ data: { article: { ...article, ...changes } } }) }), message);
  }
});

test('洛谷非法域名和非文章链接不发请求', async () => {
  const client = { getJson: async () => assert.fail('不应请求不受支持的链接') };
  await assert.rejects(listLuoguEditorials('https://notluogu.com.cn/problem/P1001', client), /题目页链接/);
  await assert.rejects(fetchLuoguEditorial({ ...source, url: 'https://www.luogu.com.cn/discuss/123' }, client), /来源无效/);
  await assert.rejects(fetchLuoguEditorial({ ...source, url: 'https://example.com/article/test1234' }, client), /来源无效/);
});
