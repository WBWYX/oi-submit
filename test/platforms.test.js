import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LANGUAGE, pickOption, platformOf, submitTarget } from '../src/shared/platforms.js';

/**
 * 纯逻辑的验收：链接识别、提交页构造、语言匹配。
 *
 * 填表那部分要真的登录上去才能验，但**这三件事错了同样会让提交静默失败**，
 * 而且表现得像是平台的问题：浏览器打开一个不对的页面然后就没下文了。
 * 所以它们必须在离线阶段就钉死。
 */

test('按 hostname 精确匹配平台', () => {
  assert.equal(platformOf('https://www.luogu.com.cn/problem/P1001'), 'luogu');
  assert.equal(platformOf('https://codeforces.com/contest/1/problem/A'), 'codeforces');
  assert.equal(platformOf('https://atcoder.jp/contests/abc300/tasks/abc300_a'), 'atcoder');
  assert.equal(platformOf('https://acm.timus.ru/problem.aspx?space=1&num=1000'), 'timus');
});

test('不带 www 的洛谷不算数', () => {
  // 洛谷那边不带 www 是另一台服务器，提交页结构对不上；
  // 用 endsWith 判断的话这条会被当成洛谷，然后在页面上等元素等到超时
  assert.equal(platformOf('https://luogu.com.cn/problem/P1001'), null);
});

test('域名后缀相同但不是同一个站的不算数', () => {
  assert.equal(platformOf('https://notcodeforces.com/contest/1/problem/A'), null);
});

test('Codeforces 比赛题 → 比赛提交页', () => {
  const t = submitTarget('https://codeforces.com/contest/1919/problem/C');
  assert.equal(t.submitUrl, 'https://codeforces.com/contest/1919/submit');
  assert.equal(t.problemIndex, 'C');
  assert.equal(t.problemKey, '1919C');
});

test('Codeforces Gym 与题库页各走各的表单', () => {
  assert.equal(
    submitTarget('https://codeforces.com/gym/104821/problem/A').submitUrl,
    'https://codeforces.com/gym/104821/submit',
  );
  const set = submitTarget('https://codeforces.com/problemset/problem/4/A');
  assert.equal(set.submitUrl, 'https://codeforces.com/problemset/submit');
  // 题库页那张表单认的是「题目代码」，不是下拉里的题号
  assert.equal(set.problemCode, '4A');
  assert.equal(set.problemIndex, undefined);
});

test('AtCoder 带上 taskScreenName', () => {
  const t = submitTarget('https://atcoder.jp/contests/abc475/tasks/abc475_c');
  assert.equal(t.submitUrl, 'https://atcoder.jp/contests/abc475/submit?taskScreenName=abc475_c');
  assert.equal(t.problemKey, 'abc475_c');
});

test('洛谷用 #submit 锚点直接打开提交面板', () => {
  /*
   * 洛谷没有独立提交页，但带上 #submit 它自己的路由就会把提交面板展开。
   * 这比打开题目页再去点「提交」标签可靠得多——后者要靠一串很深的 CSS 选择器，
   * 洛谷一改版就失灵。
   */
  const t = submitTarget('https://www.luogu.com.cn/problem/P3538');
  assert.equal(t.submitUrl, 'https://www.luogu.com.cn/problem/P3538#submit');
  assert.equal(t.problemKey, 'P3538');
});

test('题目链接本来就带锚点或查询串时也能算对', () => {
  assert.equal(
    submitTarget('https://www.luogu.com.cn/problem/P9169#submit').submitUrl,
    'https://www.luogu.com.cn/problem/P9169#submit',
  );
  assert.equal(
    submitTarget('https://www.luogu.com.cn/problem/P9169?contestId=123').submitUrl,
    'https://www.luogu.com.cn/problem/P9169#submit',
  );
});

test('Timus 题目页 → 独立的 submit.aspx', () => {
  const t = submitTarget('https://acm.timus.ru/problem.aspx?space=1&num=1297');
  assert.equal(t.submitUrl, 'https://acm.timus.ru/submit.aspx?space=1&num=1297');
  assert.equal(t.problemNum, '1297');
});

test('认不出来的链接返回 null，不硬凑一个', () => {
  // 返回原链接会让浏览器打开一个不是提交页的页面，然后填表干等到超时
  assert.equal(submitTarget('https://codeforces.com/profile/tourist'), null);
  assert.equal(submitTarget('https://www.luogu.com.cn/training/1'), null);
  assert.equal(submitTarget('https://acm.timus.ru/status.aspx'), null);
  assert.equal(submitTarget('https://example.com/x'), null);
});

/* ────────────────────── 语言匹配 ────────────────────── */

const CF_OPTIONS = [
  { value: '43', text: 'GNU GCC C11 5.1.0' },
  { value: '54', text: 'GNU G++17 7.3.0' },
  { value: '89', text: 'GNU G++23 14.2 (64 bit, msys2)' },
  { value: '31', text: 'Python 3.8.10' },
];

test('按文本包含匹配，忽略空格与大小写', () => {
  assert.equal(pickOption(CF_OPTIONS, 'GNU G++17').value, '54');
  assert.equal(pickOption(CF_OPTIONS, 'g++23').value, '89');
  assert.equal(pickOption(CF_OPTIONS, 'python 3').value, '31');
});

test('配成纯数字时按选项编号兜底', () => {
  // 万一某个平台的选项文本古怪到没法匹配，还能直接写编号
  assert.equal(pickOption(CF_OPTIONS, '89').value, '89');
});

test('匹配不上就返回 null，绝不挑个最像的', () => {
  /*
   * 这条是本文件里最重要的断言。语言选错的后果是 CE，而人会对着一份
   * 本来没问题的代码查半天——「猜一个最接近的」在这里是有害的聪明。
   */
  assert.equal(pickOption(CF_OPTIONS, 'Rust'), null);
  assert.equal(pickOption(CF_OPTIONS, ''), null);
});

test('AtCoder 那种每场比赛不同的编号不影响文本匹配', () => {
  // 同一门语言在两场比赛里编号不同，正是不能写死 id 的原因
  const contestA = [{ value: '6017', text: 'C++ 20 (gcc 12.2)' }];
  const contestB = [{ value: '5028', text: 'C++ 20 (gcc 12.2)' }];
  assert.equal(pickOption(contestA, 'C++ 20').value, '6017');
  assert.equal(pickOption(contestB, 'C++ 20').value, '5028');
});

/* ─────────────────── QOJ / 牛客 / LibreOJ ─────────────────── */

test('QOJ：提交表单在题目页的标签页里，锚点带上但不靠它展开', () => {
  const t = submitTarget('https://qoj.ac/problem/1000');
  assert.equal(t.platform, 'qoj');
  assert.equal(t.submitUrl, 'https://qoj.ac/problem/1000#tab-submit-answer');
  assert.equal(t.problemKey, '1000');
});

test('QOJ：比赛题留在比赛页提交，不改去题库页', () => {
  /*
   * 换到题库页交，那一发就不算进比赛了——这种错误交完当场看不出来，
   * 要等排行榜上少了一题才会发现。
   */
  const t = submitTarget('https://qoj.ac/contest/1234/problem/5678');
  assert.equal(t.submitUrl, 'https://qoj.ac/contest/1234/problem/5678#tab-submit-answer');
  assert.equal(t.problemKey, '5678');
});

test('牛客：题目页本身就是提交页', () => {
  const t = submitTarget('https://ac.nowcoder.com/acm/problem/13885');
  assert.equal(t.platform, 'nowcoder');
  assert.equal(t.submitUrl, 'https://ac.nowcoder.com/acm/problem/13885');
  assert.equal(t.problemKey, '13885');
});

test('牛客：比赛题用「赛事-序号」定位', () => {
  const t = submitTarget('https://ac.nowcoder.com/acm/contest/98765/d');
  assert.equal(t.submitUrl, 'https://ac.nowcoder.com/acm/contest/98765/d');
  assert.equal(t.problemKey, '98765-D');
});

test('LibreOJ：/p/<题号> → /p/<题号>/submit', () => {
  const t = submitTarget('https://loj.ac/p/10000');
  assert.equal(t.platform, 'loj');
  assert.equal(t.submitUrl, 'https://loj.ac/p/10000/submit');
  assert.equal(t.problemKey, '10000');
});

test('三家的非题目页一律返回 null，绝不猜', () => {
  // 猜出来的提交页会让浏览器打开一个不对的页面，然后填表等元素等到超时，
  // 而人看到的只是浏览器莫名跳了一下
  assert.equal(submitTarget('https://qoj.ac/problems'), null);
  assert.equal(submitTarget('https://qoj.ac/contest/1234'), null);
  assert.equal(submitTarget('https://ac.nowcoder.com/acm/contest/98765'), null);
  assert.equal(submitTarget('https://loj.ac/problems'), null);
});

test('新加的三家都有默认语言，否则提交时会用页面上次的选项', () => {
  for (const p of ['qoj', 'nowcoder', 'loj']) {
    assert.ok(DEFAULT_LANGUAGE[p], `${p} 没有默认语言`);
  }
  // QOJ 的选项文本是 "C++ 17"、value 是 "C++17"，归一化后两种写法都该命中
  const options = [
    { value: 'C++14', text: 'C++ 14' },
    { value: 'C++17', text: 'C++ 17' },
  ];
  assert.equal(pickOption(options, DEFAULT_LANGUAGE.qoj)?.value, 'C++17');
  assert.equal(pickOption(options, 'C++17')?.value, 'C++17');
});
