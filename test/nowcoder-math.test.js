import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNowcoder } from '../src/shared/statement/nowcoder.js';
import { htmlToMarkdown } from '../src/shared/statement/html.js';

test('牛客公式图片在题意和 pre 输入约束中保留原始 TeX', () => {
  const formula = tex => `<img src="https://www.nowcoder.com/equation?tex=${encodeURIComponent(tex)}">`;
  const result = parseNowcoder(`<div class="question-title">数码轮</div>
    <div class="subject-question">长度 ${formula('n')}，${formula('0 \\le x \\le 9')}，${formula('a<b')}。</div>
    <h2>输入描述:</h2><pre>${formula('1\\le n\\le 2\\times10^5')}，${formula('m\\le 10^9')}</pre>
    <h2>输出描述:</h2><pre>输出 ${formula('x')} 的数量。</pre>`, '140489-C', 'https://ac.nowcoder.com/acm/contest/140489/C');
  for (const tex of ['n', '0 \\le x \\le 9', 'a<b', '1\\le n\\le 2\\times10^5', 'm\\le 10^9', 'x']) {
    assert.ok(result.markdown.includes(`$${tex}$`), `缺少公式 ${tex}`);
  }
});

test('公式实体、加号、alt 兜底与普通插图均保留', () => {
  const md = htmlToMarkdown(`<img src='/equation?foo=1&amp;tex=a%2Bb%3Cc%26d'>
    <img alt='x_1' src='/equation?tex='>
    <img src='/equation?tex='><img src='/images/diagram.png'>`,
    { baseUrl: 'https://ac.nowcoder.com/', equationImages: true });
  assert.ok(md.includes('$a+b<c&d$'));
  assert.ok(md.includes('$x_1$'));
  assert.ok(md.includes('![](https://ac.nowcoder.com/equation?tex=)'));
  assert.ok(md.includes('![](https://ac.nowcoder.com/images/diagram.png)'));
});

test('公式不影响样例原文，也不会执行题面脚本', () => {
  const result = parseNowcoder(`<div class="question-title">test</div>
    <div class="subject-question"><script>alert(1)</script><img src='/equation?tex=n'></div>
    <div class="question-oi"><textarea data-clipboard-text-id="input1">2 7\n19</textarea>
    <textarea data-clipboard-text-id="output1">1</textarea></div>`, '1-A', 'https://ac.nowcoder.com/acm/contest/1/A');
  assert.deepEqual(result.samples, [{ input: '2 7\n19\n', output: '1\n' }]);
  assert.ok(result.markdown.includes('$n$'));
  assert.ok(!result.markdown.includes('alert'));
});
