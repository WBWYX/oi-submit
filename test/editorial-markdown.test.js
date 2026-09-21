import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absolutizeMarkdownLinks } from '../src/shared/editorial/common.js';

const base = 'https://www.luogu.com.cn/article/example';

test('原始 Markdown 仅补全相对链接和图片，标题与正文保持原样', () => {
  const markdown = '# 思路\n\n[题目](/problem/P1001 "原题")\n![图](../images/a.png)\n[附件](<./a b(c).txt> \'下载\')\n';
  assert.equal(absolutizeMarkdownLinks(markdown, base), '# 思路\n\n[题目](https://www.luogu.com.cn/problem/P1001 "原题")\n![图](https://www.luogu.com.cn/images/a.png)\n[附件](<https://www.luogu.com.cn/article/a%20b(c).txt> \'下载\')\n');
});

test('协议相对链接和查询串按原文来源解析，绝对链接和文内锚点不改', () => {
  const markdown = '[图](//cdn.luogu.com.cn/a.png) [下一页](?page=2) [本节](#证明) [外链](https://example.com/a) [邮件](mailto:a@example.com)';
  assert.equal(absolutizeMarkdownLinks(markdown, base), '[图](https://cdn.luogu.com.cn/a.png) [下一页](https://www.luogu.com.cn/article/example?page=2) [本节](#证明) [外链](https://example.com/a) [邮件](mailto:a@example.com)');
});

test('引用链接定义补全目标，引用本身和换行符保留', () => {
  const markdown = '[题目][p]\r\n![图][image]\r\n\r\n[p]: /problem/P1001 "题目"\r\n  [image]: <../images/a b.png>\r\n';
  assert.equal(absolutizeMarkdownLinks(markdown, base), '[题目][p]\r\n![图][image]\r\n\r\n[p]: https://www.luogu.com.cn/problem/P1001 "题目"\r\n  [image]: <https://www.luogu.com.cn/images/a%20b.png>\r\n');
});

test('反引号和波浪线代码围栏内部逐字保留，围栏后的链接仍能处理', () => {
  for (const marker of ['```', '~~~~']) {
    const block = `${marker}md\n[代码中的链接](/unchanged)\n[ref]: /also-unchanged\n${marker}\n`;
    assert.equal(absolutizeMarkdownLinks(`${block}[题目](/problem/P1001)\n`, base), `${block}[题目](https://www.luogu.com.cn/problem/P1001)\n`);
  }
});

test('未闭合围栏、缩进代码和引用中的代码不被改写', () => {
  for (const markdown of [
    '```md\n[x](/unchanged)\n',
    '    [x](/unchanged)\n',
    '> ```md\n> [x](/unchanged)\n> ```\n',
    '<pre><code>[x](/unchanged)</code></pre>\n',
    '<code>[x](/unchanged)</code>\n',
  ]) assert.equal(absolutizeMarkdownLinks(markdown, base), markdown);
});

test('行内代码支持不同反引号长度和跨行内容，代码中的链接原样保留', () => {
  const code = '`[x](/unchanged)` 与 ``a`[x](/unchanged)`` 和 `[x]\n(/unchanged)`';
  assert.equal(absolutizeMarkdownLinks(`${code}\n[题目](/problem/P1001)`, base), `${code}\n[题目](https://www.luogu.com.cn/problem/P1001)`);
});

test('美元和反斜线数学定界符内的文本不被识别成链接', () => {
  const formula = '$[x](y)$\n$$\n[x](y)\n$$\n\\([x](y)\\)\n\\[ [x](y) \\]\n';
  assert.equal(absolutizeMarkdownLinks(`${formula}[题目](/problem/P1001)`, base), `${formula}[题目](https://www.luogu.com.cn/problem/P1001)`);
});

test('转义和复杂目标保守保留，不猜测修复 Markdown', () => {
  const markdown = '\\[文字](/unchanged)\n[x](../a(b).png)\n[x](../a\\(b\\).png)\n<a href="/problem/P1001">原始 HTML</a>\n';
  assert.equal(absolutizeMarkdownLinks(markdown, base), markdown);
});
