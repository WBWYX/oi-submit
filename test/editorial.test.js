import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchEditorial, listEditorials } from '../src/shared/editorial/index.js';

const source = {
  platform: 'luogu', problemKey: 'P1001', title: '列表标题',
  url: 'https://www.luogu.com.cn/article/test123', author: '原作者',
};

test('题解完整链路：只列候选，选中后取正文并记录真实来源和标题', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push(url);
    assert.equal(init.credentials, 'include');
    assert.equal(init.headers['x-lentille-request'], 'content-only');
    if (url.includes('/problem/solution/')) {
      return Response.json({ data: { problem: { pid: 'P1001' }, solutions: { result: [
        { lid: 'test123', title: source.title, author: { name: source.author } },
      ] } } });
    }
    assert.equal(url, source.url);
    return Response.json({ data: { article: {
      lid: 'test123', title: '完整标题', author: { name: '更新作者' }, contentFull: true,
      solutionFor: { pid: 'P1001' }, content: '## 思路\n\n$a+b$\n\n[题目](/problem/P1001)\n\n```cpp\n#include <iostream>\n```',
    } } });
  };
  const entries = await listEditorials('http://luogu.com.cn/problem/P1001', fetchFn);
  assert.deepEqual(entries, [source]);
  assert.equal(calls.length, 1, '列候选时不预先下载文章');
  const got = await fetchEditorial(entries[0], fetchFn);
  assert.equal(calls.length, 2);
  assert.equal(got.title, '完整标题');
  assert.equal(got.author, '更新作者');
  assert.ok(got.markdown.startsWith('---\nkind: editorial\n'));
  assert.ok(got.markdown.includes(`source: "${source.url}"`));
  assert.ok(got.markdown.includes('problem: "P1001"'));
  assert.ok(got.markdown.includes('#include <iostream>'));
  assert.ok(got.markdown.includes('[题目](https://www.luogu.com.cn/problem/P1001)'));
});

test('题解来源校验在网络请求之前拒绝不支持的平台和伪造链接', async () => {
  const never = async () => assert.fail('无效请求不得访问网络');
  for (const bad of [
    { ...source, platform: 'timus' }, { ...source, platform: '__proto__' },
    { ...source, url: 'https://codeforces.com/blog/entry/1' },
    { ...source, url: 'https://www.luogu.com.cn/problem/P1001' },
    { ...source, url: 'https://127.0.0.1/article/test123' },
    { ...source, title: '' },
  ]) await assert.rejects(fetchEditorial(bad, never));
  await assert.rejects(listEditorials('https://acm.timus.ru/problem.aspx?num=1000', never));
  await assert.rejects(listEditorials('https://evilcodeforces.com/contest/1/problem/A', never));
});

test('洛谷 AT_ 镜像题保留任务名大小写，P 和 CF 题号仍规范化', async () => {
  for (const [input, expected] of [
    ['AT_abc020_a', 'AT_abc020_a'], ['AT_dp_e', 'AT_dp_e'],
    ['p1001', 'P1001'], ['cf1a', 'CF1A'],
  ]) {
    const fetchFn = async (url) => {
      if (url.includes('/problem/solution/')) {
        assert.equal(url, `https://www.luogu.com.cn/problem/solution/${expected}`);
        return Response.json({ data: {
          problem: { pid: expected }, solutions: { result: [
            { lid: 'test123', title: source.title, solutionFor: { pid: expected } },
          ] },
        } });
      }
      assert.equal(url, source.url);
      return Response.json({ data: { article: {
        lid: 'test123', contentFull: true, content: '完整题解', solutionFor: { pid: expected },
      } } });
    };
    const [selected] = await listEditorials(`https://www.luogu.com.cn/problem/${input}`, fetchFn);
    assert.equal(selected.problemKey, expected);
    const got = await fetchEditorial(selected, fetchFn);
    assert.equal(got.problemKey, expected);
    assert.ok(got.markdown.includes(`problem: "${expected}"`));
  }
});

test('CF 完整链路保留 API 补充的作者与语言元数据', async () => {
  const fetchFn = async (url) => {
    if (url.includes('/contest/2110/problem/A')) {
      return new Response('<div class="sidebox"><div class="caption">Contest materials</div><a href="/blog/entry/143186">Tutorial</a></div>');
    }
    assert.equal(url, 'https://codeforces.com/api/blogEntry.view?blogEntryId=143186');
    return Response.json({ status: 'OK', result: {
      id: 143186, title: 'Editorial', authorHandle: 'writer', locale: 'en', content: '<p>$$$a+b$$$</p>',
    } });
  };
  const [selected] = await listEditorials('https://codeforces.com/contest/2110/problem/A', fetchFn);
  const got = await fetchEditorial(selected, fetchFn);
  assert.equal(got.problemKey, '2110A');
  assert.equal(got.author, 'writer');
  assert.equal(got.language, 'en');
  assert.match(got.markdown, /language: "en"/);
  assert.match(got.markdown, /author: "writer"/);
  assert.ok(got.markdown.includes('$a+b$'));
});

test('超大题解按 JSON 回传字节数拒绝，不静默截断内容', async () => {
  const fetchFn = async () => Response.json({ data: { article: {
    lid: 'test123', contentFull: true, content: '题'.repeat(300000),
  } } });
  await assert.rejects(fetchEditorial(source, fetchFn), /800 KB/);
});

test('获取题解失败原样反馈，不构造看起来成功的 Markdown', async () => {
  await assert.rejects(fetchEditorial(source, async () => new Response('', { status: 401 })), /登录/);
  await assert.rejects(fetchEditorial(source, async () => Response.json({ data: { article: {
    lid: 'test123', contentFull: false, content: '仅摘要',
  } } })), /摘要/);
});
