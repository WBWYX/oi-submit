import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { identifyUrl } from '../src/shared/statement/index.js';
import { parseCodeforces } from '../src/shared/statement/codeforces.js';
import { parseAtCoder } from '../src/shared/statement/atcoder.js';
import { parseTimus } from '../src/shared/statement/timus.js';
import { parseLuogu } from '../src/shared/statement/luogu.js';
import { sliceClass } from '../src/shared/statement/html.js';

/**
 * 解析层用真实页面快照测，不打网络。
 *
 * 这类代码最常见的失效方式不是「写错了」，而是「平台改版了，于是抓出来是空的」。
 * 那种失效只有解析层测得出来，而且必须对着真实 HTML——自己编的样本永远只覆盖
 * 自己想得到的结构。
 *
 * 这些用例连同夹具是从 icpc-workbench 服务端**原样搬过来的**（解析代码也是）。
 * 搬家最大的风险就是「逻辑在搬运途中悄悄变了」，而这组断言是唯一能发现它的东西，
 * 所以一条都没删。
 */
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

const CF_URL = 'https://codeforces.com/contest/3/problem/B';
const AT_URL = 'https://atcoder.jp/contests/abc475/tasks/abc475_c';
const TIMUS_URL = 'https://acm.timus.ru/problem.aspx?space=1&num=1297';

test('identifyUrl 认出四个平台的题目链接', () => {
  assert.deepEqual(identifyUrl('https://www.luogu.com.cn/problem/P3538'), {
    platform: 'luogu',
    problemKey: 'P3538',
  });
  // 比赛上下文带 query，不该影响识别
  assert.deepEqual(identifyUrl('https://www.luogu.com.cn/problem/P2148?contestId=123'), {
    platform: 'luogu',
    problemKey: 'P2148',
  });
  assert.deepEqual(identifyUrl('https://codeforces.com/contest/2219/problem/B1'), {
    platform: 'codeforces',
    problemKey: '2219B1',
  });
  assert.deepEqual(identifyUrl('https://codeforces.com/problemset/problem/4/A'), {
    platform: 'codeforces',
    problemKey: '4A',
  });
  assert.deepEqual(identifyUrl('https://codeforces.com/gym/104721/problem/C'), {
    platform: 'codeforces',
    problemKey: '104721C',
  });
  assert.deepEqual(identifyUrl(AT_URL), { platform: 'atcoder', problemKey: 'abc475_c' });
  assert.deepEqual(identifyUrl(TIMUS_URL), { platform: 'timus', problemKey: '1297' });
});

test('identifyUrl 认不出来就返回 null，绝不猜', () => {
  // 列表页不是题目页——猜一个题号出来会让人抓到错的题面，覆盖掉自己的笔记
  assert.equal(identifyUrl('https://codeforces.com/contest/2219'), null);
  assert.equal(identifyUrl('https://acm.hdu.edu.cn/showproblem.php?pid=1000'), null);
  assert.equal(identifyUrl('随便写的'), null);
  assert.equal(identifyUrl('https://www.luogu.com.cn/training/123'), null);
  assert.equal(identifyUrl('https://acm.timus.ru/status.aspx'), null, 'Timus 必须带 num');
});

/* ────────────────────────── Codeforces ────────────────────────── */

test('Codeforces：标题、限制、样例都抓得到', () => {
  const s = parseCodeforces(fixture('cf-3B.html'), '3B', CF_URL);
  assert.equal(s.title, 'B. Lorry');
  assert.equal(s.timeLimitMs, 2000);
  assert.equal(s.memoryLimitMb, 64);
  assert.equal(s.samples.length, 1);
  assert.equal(s.samples[0]?.input, '3 2\n1 2\n2 7\n1 3\n');
  assert.equal(s.samples[0]?.output, '7\n2\n');
});

test('Codeforces：题面主体不重复包含输入输出格式', () => {
  const s = parseCodeforces(fixture('cf-3B.html'), '3B', CF_URL);
  const body = s.markdown.slice(s.markdown.indexOf('## 题目描述'), s.markdown.indexOf('## 输入格式'));
  /*
   * legend 必须按配对计数取到自己的结束标签。若改成「切到 sample-tests 之前」，
   * 输入输出格式那两节会被一起吃进正文，于是它们在文件里出现两遍。
   */
  assert.ok(
    !body.includes('The first line contains a pair of integer numbers'),
    '输入格式的内容不该出现在题目描述里',
  );
  assert.equal(s.markdown.split('## 输入格式').length - 1, 1, '输入格式只该出现一次');
});

test('Codeforces：上下标不能被吃掉', () => {
  const s = parseCodeforces(fixture('cf-3B.html'), '3B', CF_URL);
  // 10^5 变成 105 是会让人读错数据范围的那种错，必须锁死
  assert.ok(s.markdown.includes('10^{5}'), '上标丢了，10^5 会被读成 105');
  assert.ok(s.markdown.includes('t_{i}'), '下标丢了，t_i 会被读成 ti');
  assert.ok(!/1 ≤ n ≤ 105\b/.test(s.markdown), '出现了 105，说明上标被吃了');
});

test('Codeforces：不产生坏 Markdown', () => {
  const s = parseCodeforces(fixture('cf-3B.html'), '3B', CF_URL);
  // <i> 转成 *x* 会产出 `*t**i*`，连着的星号被 Markdown 当成粗体，既读不懂也渲染错
  assert.ok(!s.markdown.includes('**i*'), '出现了 <i> 转换产生的坏 Markdown');
  assert.ok(!s.markdown.includes('<div'), '残留了未闭合的 HTML 片段');
  assert.ok(!/<[a-z]+[ >]/i.test(s.markdown.replace(/```[\s\S]*?```/g, '')), '正文里残留了 HTML 标签');
});

test('Codeforces：页面结构认不出时明确报错，不返回空题面', () => {
  // 静默返回一份空的题面，比报错糟得多——人会以为抓成功了
  assert.throws(
    () => parseCodeforces('<html><body>nothing</body></html>', 'X', 'u'),
    /没找到题面区块/,
  );
});

/* ────────────────────────── AtCoder ────────────────────────── */

test('AtCoder：标题不带 Editorial，限制按 MiB 也认得', () => {
  const s = parseAtCoder(fixture('atcoder-abc475_c.html'), 'abc475_c', AT_URL);
  // h2 后面跟着「Editorial」链接，不切掉的话标题会带上它
  assert.equal(s.title, 'C - Walk the Line');
  assert.equal(s.timeLimitMs, 2000);
  assert.equal(s.memoryLimitMb, 1024, 'AtCoder 写的是 MiB，只认 MB 会永远抓不到');
});

test('AtCoder：三组样例配对正确', () => {
  const s = parseAtCoder(fixture('atcoder-abc475_c.html'), 'abc475_c', AT_URL);
  assert.equal(s.samples.length, 3);
  assert.equal(s.samples[0]?.input, '8 8 17\n2 3 4 4 3 5 1\n');
  assert.equal(s.samples[0]?.output, '6\n');
});

test('AtCoder：<var> 里的公式要补回 $...$', () => {
  const s = parseAtCoder(fixture('atcoder-abc475_c.html'), 'abc475_c', AT_URL);
  assert.ok(s.markdown.includes('$N$'), '单个变量没补上 $');
  assert.ok(/\$1 \\leq i \\leq N-1\$/.test(s.markdown), '不等式没补上 $');
  assert.ok(!s.markdown.includes('$$'), '不该出现 $$（那是行间公式，会把排版搞乱）');
});

/* ────────────────────────── Timus（新增） ────────────────────────── */

test('Timus：标题去掉题号，限制从 problem_limits 取', () => {
  const s = parseTimus(fixture('timus-1297.html'), '1297', TIMUS_URL);
  assert.equal(s.title, 'Palindrome', '页面上是「1297. Palindrome」，题号要去掉');
  assert.equal(s.timeLimitMs, 1000);
  assert.equal(s.memoryLimitMb, 64);
  assert.equal(s.platform, 'timus');
});

test('Timus：样例的尾随空格必须清掉', () => {
  /*
   * 页面上是 `<PRE>Kazak </PRE>`——带一个尾随空格。不清掉的话它会被当成
   * 答案的一部分，本地判题会莫名其妙 WA，而人盯着输出完全看不出差别。
   */
  const s = parseTimus(fixture('timus-1297.html'), '1297', TIMUS_URL);
  assert.equal(s.samples.length, 1);
  assert.equal(s.samples[0]?.input, 'Kazak\n');
  assert.equal(s.samples[0]?.output, 'aza\n');
});

test('Timus：按 H3 切出输入输出格式，节名与其他平台一致', () => {
  // 各家叫法不统一的话，下游就得为每个平台各写一遍提取逻辑
  const s = parseTimus(fixture('timus-1297.html'), '1297', TIMUS_URL);
  assert.ok(s.markdown.includes('## 题目描述'));
  assert.ok(s.markdown.includes('## 输入格式'));
  assert.ok(s.markdown.includes('## 输出格式'));
  assert.ok(s.markdown.includes('## 来源'), '作者与出处单独成节');
});

test('Timus：正文里不重复出现样例', () => {
  const s = parseTimus(fixture('timus-1297.html'), '1297', TIMUS_URL);
  const beforeSamples = s.markdown.slice(0, s.markdown.indexOf('## 样例 #1'));
  assert.ok(!beforeSamples.includes('Kazak'), '样例表没从正文里剥掉，会出现两遍');
});

test('Timus：认不出标题就报错，不返回空题面', () => {
  assert.throws(() => parseTimus('<html><body>nothing</body></html>', '1', 'u'), /没找到题目标题/);
});

/* ────────────────────────── 洛谷 ────────────────────────── */

test('洛谷：接口返回直接拼装，不做解析', () => {
  // 洛谷给的本来就是 Markdown，这里只验「拼对了位置」和「限制的单位换算」
  const body = {
    currentData: {
      problem: {
        content: {
          name: '过河卒',
          description: '题目描述正文',
          formatI: '输入若干行',
          formatO: '输出一个整数',
          hint: '数据范围提示',
        },
        samples: [['1 2\n', '3\n']],
        limits: { time: [1000, 1000], memory: [131072, 131072] },
      },
    },
  };
  const s = parseLuogu(body, 'P9169', 'https://www.luogu.com.cn/problem/P9169');
  assert.equal(s.title, '过河卒');
  assert.equal(s.timeLimitMs, 1000);
  assert.equal(s.memoryLimitMb, 128, '洛谷的内存单位是 KB，要换成 MB');
  assert.equal(s.samples.length, 1);
  assert.ok(s.markdown.includes('## 题目描述'));
  assert.ok(s.markdown.includes('## 提示'));
});

test('洛谷：结构里没有题面内容时报错', () => {
  assert.throws(() => parseLuogu({}, 'P1', 'u'), /没有题面内容/);
});

/* ────────────────────────── 通用约定 ────────────────────────── */

test('四家都带 front matter，且含时限与空间', () => {
  const all = [
    parseCodeforces(fixture('cf-3B.html'), '3B', CF_URL),
    parseAtCoder(fixture('atcoder-abc475_c.html'), 'abc475_c', AT_URL),
    parseTimus(fixture('timus-1297.html'), '1297', TIMUS_URL),
  ];
  for (const s of all) {
    assert.ok(s.markdown.startsWith('---\n'), `${s.platform} 没有 front matter`);
    assert.ok(s.markdown.includes(`platform: ${s.platform}`));
    assert.ok(s.markdown.includes(`problem: ${s.problemKey}`));
    assert.ok(s.markdown.includes(`url: ${s.url}`));
    /*
     * 限制必须在 front matter 里。正文里那句「时间限制 …」只有 CF/AtCoder/Timus 有，
     * 洛谷没有——下游（oi-bench 导入题面时自动设判题限制）要的是各平台统一的
     * 那个位置，所以这条是接口约定，不是锦上添花。
     */
    assert.ok(s.markdown.includes(`timeLimitMs: ${s.timeLimitMs}`), `${s.platform} 缺时限`);
    assert.ok(s.markdown.includes(`memoryLimitMb: ${s.memoryLimitMb}`), `${s.platform} 缺空间`);
  }
});

test('样例内容与 Markdown 里的代码块一致', () => {
  /*
   * 两条路必须给出同样的数据：解析直接返回的 samples，和从生成的 md 里重新提取。
   * 不一致的话，「抓下来存文件」和「从文件导入样例」会得到不同的测试点。
   */
  const all = [
    parseAtCoder(fixture('atcoder-abc475_c.html'), 'abc475_c', AT_URL),
    parseCodeforces(fixture('cf-3B.html'), '3B', CF_URL),
    parseTimus(fixture('timus-1297.html'), '1297', TIMUS_URL),
  ];
  for (const s of all) {
    for (const [i, sample] of s.samples.entries()) {
      const block = `### 样例输入 #${i + 1}\n\n\`\`\`\n${sample.input.trimEnd()}\n\`\`\``;
      assert.ok(s.markdown.includes(block), `${s.platform} 样例 ${i + 1} 的输入块与返回值对不上`);
    }
  }
});

test('取块时标签名允许带数字（h1–h6）', () => {
  /*
   * 原实现的 balancedFrom 用 `[a-z]+` 取标签名，对 <H2> 只取到 "H"，
   * 然后去找 </h>，永远找不到。服务端只对 div/span 调过它，所以这个 bug
   * 潜伏了很久，直到接 Timus（标题在 <H2> 里）才被触发。
   */
  const html = '<body><h2 class="problem_title">1297. Palindrome</h2></body>';
  assert.equal(sliceClass(html, 'problem_title'), '<h2 class="problem_title">1297. Palindrome</h2>');
});
