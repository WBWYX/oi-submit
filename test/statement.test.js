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
import { parseQoj } from '../src/shared/statement/qoj.js';
import { parseNowcoder } from '../src/shared/statement/nowcoder.js';
import { parseLoj } from '../src/shared/statement/loj.js';
import { parseHdu } from '../src/shared/statement/hdu.js';
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
/**
 * HDU 的页面是 GB2312，夹具按**原始字节**存（用 utf8 读会整页乱码）。
 *
 * 刻意不把夹具转存成 UTF-8：那样省事，但 GB2312 解码恰恰是这一家最容易出错、
 * 全仓库又零先例的一块，转存等于把唯一需要覆盖的东西绕过去。
 */
const gbkFixture = (name) =>
  new TextDecoder('gbk').decode(readFileSync(join(here, 'fixtures', name)));

const CF_URL = 'https://codeforces.com/contest/3/problem/B';
const AT_URL = 'https://atcoder.jp/contests/abc475/tasks/abc475_c';
const TIMUS_URL = 'https://acm.timus.ru/problem.aspx?space=1&num=1297';
const QOJ_URL = 'https://qoj.ac/problem/1000';
const NC_URL = 'https://ac.nowcoder.com/acm/problem/13885';
const LOJ_URL = 'https://loj.ac/p/10000';
const HDU_URL = 'https://acm.hdu.edu.cn/showproblem.php?pid=2609';
const HDU_CN_URL = 'https://acm.hdu.edu.cn/showproblem.php?pid=2049';

const lojFixture = () => JSON.parse(fixture('loj-10000.json'));

test('identifyUrl 认出八个平台的题目链接', () => {
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
  assert.deepEqual(identifyUrl(QOJ_URL), { platform: 'qoj', problemKey: '1000' });
  // QOJ 比赛题里的题号就是题库题号，归一到同一道题
  assert.deepEqual(identifyUrl('https://qoj.ac/contest/1234/problem/5678'), {
    platform: 'qoj',
    problemKey: '5678',
  });
  assert.deepEqual(identifyUrl(NC_URL), { platform: 'nowcoder', problemKey: '13885' });
  // 牛客比赛题的题号只在页面上有，链接里没有，用「赛事-序号」定位
  assert.deepEqual(identifyUrl('https://ac.nowcoder.com/acm/contest/98765/d'), {
    platform: 'nowcoder',
    problemKey: '98765-D',
  });
  assert.deepEqual(identifyUrl(LOJ_URL), { platform: 'loj', problemKey: '10000' });
  // HDU 的题号在 query 里，不在路径里
  assert.deepEqual(identifyUrl(HDU_URL), { platform: 'hdu', problemKey: '2609' });
});

test('identifyUrl 认不出来就返回 null，绝不猜', () => {
  // 列表页不是题目页——猜一个题号出来会让人抓到错的题面，覆盖掉自己的笔记
  assert.equal(identifyUrl('https://codeforces.com/contest/2219'), null);
  assert.equal(identifyUrl('https://acm.hdu.edu.cn/listproblem.php?vol=1'), null, 'HDU 列表页不是题目页');
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

test('各平台都带 front matter，且含时限与空间', () => {
  const all = [
    parseCodeforces(fixture('cf-3B.html'), '3B', CF_URL),
    parseAtCoder(fixture('atcoder-abc475_c.html'), 'abc475_c', AT_URL),
    parseTimus(fixture('timus-1297.html'), '1297', TIMUS_URL),
    parseQoj(fixture('qoj-1000.html'), '1000', QOJ_URL),
    parseNowcoder(fixture('nowcoder-13885.html'), '13885', NC_URL),
    parseLoj(lojFixture(), '10000', LOJ_URL),
    parseHdu(gbkFixture('hdu-2609.html'), '2609', HDU_URL),
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
    parseQoj(fixture('qoj-1000.html'), '1000', QOJ_URL),
    parseNowcoder(fixture('nowcoder-13885.html'), '13885', NC_URL),
    parseLoj(lojFixture(), '10000', LOJ_URL),
    parseHdu(gbkFixture('hdu-2609.html'), '2609', HDU_URL),
  ];
  for (const s of all) {
    for (const [i, sample] of s.samples.entries()) {
      const block = `### 样例输入 #${i + 1}\n\n\`\`\`\n${sample.input.trimEnd()}\n\`\`\``;
      assert.ok(s.markdown.includes(block), `${s.platform} 样例 ${i + 1} 的输入块与返回值对不上`);
    }
  }
});

/* ──────────────────────── QOJ ──────────────────────── */

test('QOJ：标题取 page-header，不能取页头的站名', () => {
  /*
   * 页面上第一个 <h1> 是站名 "QOJ.ac"（页头里），题目标题在后面那个
   * class="page-header" 的 h1 里。取「第一个 h1」会得到 QOJ.ac——
   * 和 Timus 提交时点中页头搜索按钮是同一类错误：页头的东西总排在前面。
   */
  const s = parseQoj(fixture('qoj-1000.html'), '1000', QOJ_URL);
  assert.equal(s.title, '边三连通分量');
  assert.equal(s.timeLimitMs, 5000);
  assert.equal(s.memoryLimitMb, 512);
});

test('QOJ：按 Input N / Output N 的编号配对样例', () => {
  const s = parseQoj(fixture('qoj-1000.html'), '1000', QOJ_URL);
  assert.equal(s.samples.length, 2);
  assert.equal(s.samples[0].input, '4 5\n0 2\n0 1\n3 0\n2 1\n2 3\n');
  assert.equal(s.samples[0].output, '3\n2 0 2\n1 1\n1 3\n');
  // 第二组要配对到自己的输出，不能错位拿到下一组的输入
  assert.ok(s.samples[1].input.startsWith('13 21\n'));
  assert.ok(s.samples[1].output.startsWith('6\n'));
});

test('QOJ：第一个 h2 之前的引言不占用「题目描述」这个节名', () => {
  /*
   * QOJ 题面开头常有一行 `Source: Library Checker`，真正的描述在
   * <h2>Statement</h2> 里。两处都扣「## 题目描述」的话，一份题面里会有两个同名
   * 小节，下游按节名取内容时拿到的是那行来源说明。
   */
  const s = parseQoj(fixture('qoj-1000.html'), '1000', QOJ_URL);
  const count = s.markdown.split('## 题目描述').length - 1;
  assert.equal(count, 1, `「## 题目描述」出现了 ${count} 次`);
  assert.ok(s.markdown.includes('Source: Library Checker'));
});

test('QOJ：正文里不重复出现样例', () => {
  const s = parseQoj(fixture('qoj-1000.html'), '1000', QOJ_URL);
  const first = s.samples[0].input.trim();
  const occurrences = s.markdown.split(first).length - 1;
  assert.equal(occurrences, 1, `样例内容在 Markdown 里出现了 ${occurrences} 次`);
});

test('QOJ：限制只在 badge 里找，不被内联脚本抢答', () => {
  /*
   * stripTags 去掉的是标签，<script> 的函数体会原样留在文本里。QOJ 页面上内联
   * 脚本很多，在整页文本上跑正则的话，脚本里任何一处 `Time Limit:` 都能抢先命中。
   */
  const html =
    '<script>var tip = "Time Limit: 999 s, Memory Limit: 1 MB";</script>' +
    '<h1 class="page-header">#7. 假题</h1>' +
    '<span class="badge badge-secondary">Time Limit:\t2 s\t</span>' +
    '<span class="badge badge-secondary">Memory Limit:\t256 MB\t</span>' +
    '<article class="uoj-article"><p>正文</p></article>';
  const s = parseQoj(html, '7', 'https://qoj.ac/problem/7');
  assert.equal(s.timeLimitMs, 2000);
  assert.equal(s.memoryLimitMb, 256);
});

test('QOJ：没有正文时报「可能要登录」，不返回空题面', () => {
  const html = '<h1 class="page-header">#9. 私有题</h1>';
  assert.throws(() => parseQoj(html, '9', 'https://qoj.ac/problem/9'), /登录/);
});

/* ──────────────────────── 牛客 ──────────────────────── */

test('牛客：限制取 C/C++ 那一档，不是「其他语言」', () => {
  /*
   * 页面写的是「时间限制：C/C++/Rust/Pascal 2秒，其他语言4秒」。取到 4 秒的话，
   * 本地按放宽一倍的时限判，过了交上去 TLE——而且没有任何地方会提示哪里不对。
   */
  const s = parseNowcoder(fixture('nowcoder-13885.html'), '13885', NC_URL);
  assert.equal(s.title, 'Music Problem');
  assert.equal(s.timeLimitMs, 2000);
  assert.equal(s.memoryLimitMb, 128);
});

test('牛客：样例取隐藏 textarea 的原文，换行不丢', () => {
  const s = parseNowcoder(fixture('nowcoder-13885.html'), '13885', NC_URL);
  assert.equal(s.samples.length, 1);
  assert.equal(s.samples[0].input, '3\n3\n2000 1000 3000\n3\n2000 3000 1600\n2\n5400 1800\n');
  assert.equal(s.samples[0].output, 'NO\nYES\nYES\n');
});

test('牛客：题目描述不能把输入输出和样例一起吞进来', () => {
  /*
   * subject-describe 听着像「描述」，实际上它把输入描述、输出描述、示例块全包着
   * （实测这道题：describe 4067 字，subject-question 699 字）。用错的话整篇题面
   * 会挤进「## 题目描述」，后面输入/输出格式各自又出现一遍，同一段存两份。
   */
  const s = parseNowcoder(fixture('nowcoder-13885.html'), '13885', NC_URL);
  const description = s.markdown.slice(
    s.markdown.indexOf('## 题目描述'),
    s.markdown.indexOf('## 输入格式'),
  );
  assert.ok(description.includes('HH is an obsessive'));
  assert.ok(!description.includes('输入描述'), '题目描述里混进了输入描述');
  assert.ok(!description.includes('5400 1800'), '题目描述里混进了样例');
  assert.ok(s.markdown.includes('## 输入格式'));
  assert.ok(s.markdown.includes('## 输出格式'));
});

test('牛客：class 按词元精确匹配，question-oi 不吃掉 question-oi-hd', () => {
  /*
   * `\bquestion-oi\b` 对 `question-oi-hd` 同样成立（i 与 - 之间就是词边界）。
   * 用 \b 的话一组样例会被当成四五块互相嵌套的东西，样例数量凭空翻几倍。
   */
  const s = parseNowcoder(fixture('nowcoder-13885.html'), '13885', NC_URL);
  assert.equal(s.samples.length, 1);
});

test('牛客：认不出标题就报错，不返回空题面', () => {
  assert.throws(() => parseNowcoder('<html><body>404</body></html>', '1', NC_URL), /没找到题目标题/);
});

/* ──────────────────────── LibreOJ ──────────────────────── */

test('LOJ：结构化 Markdown 直接用，章节名按出题人写的来', () => {
  const s = parseLoj(lojFixture(), '10000', LOJ_URL);
  assert.equal(s.title, '「一本通 1.1 例 1」活动安排');
  assert.equal(s.timeLimitMs, 1000);
  assert.equal(s.memoryLimitMb, 512);
  assert.ok(s.markdown.includes('## 题目描述'));
  assert.ok(s.markdown.includes('## 输入格式'));
  assert.ok(s.markdown.includes('## 输出格式'));
  // 出题人写的是「数据范围与提示」，不在归一化表里——原样保留，不硬掰成「提示」
  assert.ok(s.markdown.includes('## 数据范围与提示'));
});

test('LOJ：样例按 sampleId 取，插在正文引用它的位置', () => {
  const s = parseLoj(lojFixture(), '10000', LOJ_URL);
  assert.equal(s.samples.length, 1);
  assert.equal(s.samples[0].input, '4\n1 3\n4 6\n2 5\n1 7\n');
  assert.equal(s.samples[0].output, '2\n');
  // 样例排在「数据范围与提示」之前，与网站上的阅读顺序一致
  assert.ok(s.markdown.indexOf('## 样例 #1') < s.markdown.indexOf('## 数据范围与提示'));
});

test('LOJ：多组样例按各自的 sampleId 编号，不是每节都从 #1 重来', () => {
  /*
   * LOJ 的样例是被正文按下标引用的，一节一个。编号每次都从 1 开始的话，一份三组
   * 样例的题面里会出现三个「样例 #1」，而 oi-bench 按标题去重，导入后只剩一组。
   */
  const body = {
    localizedContentsOfLocale: {
      title: '三组样例',
      contentSections: [
        { type: 'Sample', sectionTitle: '样例一', sampleId: 0 },
        { type: 'Sample', sectionTitle: '样例二', sampleId: 1 },
        { type: 'Sample', sectionTitle: '样例三', sampleId: 2 },
      ],
    },
    samples: [
      { inputData: 'a', outputData: 'A' },
      { inputData: 'b', outputData: 'B' },
      { inputData: 'c', outputData: 'C' },
    ],
    judgeInfo: { timeLimit: 1000, memoryLimit: 256 },
  };
  const s = parseLoj(body, '1', LOJ_URL);
  assert.ok(s.markdown.includes('### 样例输入 #1'));
  assert.ok(s.markdown.includes('### 样例输入 #2'));
  assert.ok(s.markdown.includes('### 样例输入 #3'));
  assert.equal(s.markdown.split('## 样例 #1').length - 1, 1);
});

test('LOJ：没被引用的样例补在末尾，不能丢', () => {
  const body = {
    localizedContentsOfLocale: { title: '只引用了一组', contentSections: [{ type: 'Sample', sampleId: 0 }] },
    samples: [
      { inputData: 'a', outputData: 'A' },
      { inputData: 'b', outputData: 'B' },
    ],
  };
  const s = parseLoj(body, '1', LOJ_URL);
  assert.equal(s.samples.length, 2);
  assert.ok(s.markdown.includes('### 样例输入 #2'));
});

test('LOJ：不公开的题按 error 报错，而不是看 HTTP 状态', () => {
  /*
   * 接口对没权限的题返回 `{ error: 'PERMISSION_DENIED' }` 而 **HTTP 是 201**，
   * 状态码在这里毫无信息量。
   */
  assert.throws(() => parseLoj({ error: 'PERMISSION_DENIED' }, '1000', 'https://loj.ac/p/1000'), /不公开/);
  assert.throws(() => parseLoj({ error: 'NO_SUCH_PROBLEM' }, '999999', LOJ_URL), /NO_SUCH_PROBLEM/);
});

test('LOJ：交互题没有 judgeInfo 时限制为空，不编一个默认值', () => {
  const body = {
    localizedContentsOfLocale: { title: '交互题', contentSections: [{ type: 'Text', sectionTitle: '题目描述', text: '正文' }] },
    samples: [],
  };
  const s = parseLoj(body, '2', LOJ_URL);
  assert.equal(s.timeLimitMs, null);
  assert.equal(s.memoryLimitMb, null);
  assert.ok(!s.markdown.includes('timeLimitMs:'));
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

/* ──────────────────────── HDU ──────────────────────── */

test('HDU：标题、限制、样例都抓得到', () => {
  const s = parseHdu(gbkFixture('hdu-2609.html'), '2609', HDU_URL);
  assert.equal(s.platform, 'hdu');
  assert.equal(s.problemKey, '2609');
  assert.equal(s.title, 'How many');
  assert.equal(s.samples.length, 1);
  assert.ok(s.samples[0].input.startsWith('4\n0110\n'), '样例输入对不上');
  assert.equal(s.samples[0].output, '1\n2\n');
});

test('HDU：限制取 Java/Others 里的 Others，不是 Java', () => {
  /*
   * 页面写的是 `Time Limit: 2000/1000 MS (Java/Others)`——斜杠前是 Java 的。
   * 取错了不会报错，只会让本地判题宽一倍，表现是「本地过、线上 TLE」。
   */
  const s = parseHdu(gbkFixture('hdu-2609.html'), '2609', HDU_URL);
  assert.equal(s.timeLimitMs, 1000, '取成了 Java 的 2000ms');
  assert.equal(s.memoryLimitMb, 32, '32768 K 应换算成 32 MB');
});

test('HDU：中文题不乱码', () => {
  /*
   * HDU 是 GB2312。`Response.text()` 按 Fetch 规范永远 UTF-8 解码、不看
   * Content-Type 里的 charset，所以取页面时必须自己 TextDecoder('gbk')。
   * 这条断言压的就是那条路径——夹具按原始字节存，正是为了它。
   */
  const s = parseHdu(gbkFixture('hdu-2049.html'), '2049', HDU_CN_URL);
  assert.equal(s.title, '不容易系列之(4)——考新郎');
  assert.ok(s.markdown.includes('考新郎'), '正文里的中文丢了');
  assert.ok(!s.markdown.includes('�'), '出现了 U+FFFD，说明解码错了');
});

test('HDU：题面里的图片转成绝对地址，不留 ../', () => {
  // 2049 的关键公式就在图里，吞掉图片题面就不完整
  const s = parseHdu(gbkFixture('hdu-2049.html'), '2049', HDU_CN_URL);
  assert.ok(
    s.markdown.includes('![](https://acm.hdu.edu.cn/data/images/C40-1007-1.gif)'),
    '图片没转成绝对地址',
  );
  assert.ok(!s.markdown.includes('](../'), '相对路径没解析掉');
});

test('HDU：正文各节都在，不只有样例', () => {
  /*
   * 真实页面里 Problem Description / Input / Output 与它们的 panel_content
   * 之间夹着一个空格，而 balancedFrom 要求起始位置就是 `<`。没处理这个空格时，
   * **正文整节整节地消失、只剩样例**，而且不报错——这条就是为它写的。
   */
  const s = parseHdu(gbkFixture('hdu-2609.html'), '2609', HDU_URL);
  const headings = [...s.markdown.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(headings, ['题目描述', '输入格式', '输出格式', '样例 #1', '来源']);
  assert.ok(s.markdown.includes('necklaces'), '题目描述的正文没抓到');
});

test('HDU：Author / Source 不混进正文，收到末尾的来源里', () => {
  const s = parseHdu(gbkFixture('hdu-2609.html'), '2609', HDU_URL);
  const body = s.markdown.slice(s.markdown.indexOf('## 题目描述'), s.markdown.indexOf('## 来源'));
  assert.ok(!body.includes('yifenfei'), '出题人混进正文了');
  assert.ok(s.markdown.includes('Author: yifenfei'));
});

test('HDU：样例在正文里不重复出现', () => {
  const s = parseHdu(gbkFixture('hdu-2609.html'), '2609', HDU_URL);
  const times = s.markdown.split('0110\n1100').length - 1;
  assert.equal(times, 1, `样例出现了 ${times} 次`);
});

test('HDU：结构认不出时报错，不返回空题面', () => {
  // 抓回一份空题面会覆盖掉你自己写的笔记，所以宁可报错
  assert.throws(() => parseHdu('<html><body>not a problem page</body></html>', '1', HDU_URL), {
    name: 'StatementError',
  });
  // 有标题但一个小节都没有：同样不算数
  assert.throws(() => parseHdu("<h1 style='color:#1A5CC8'>X</h1>", '1', HDU_URL), {
    name: 'StatementError',
  });
});

test('HDU：class 不带引号也认得出', () => {
  /*
   * HDU 写的是 `class=panel_title`（无引号），而 html.js 的 sliceClass 要求
   * `class=["']`——复用它会一个小节都匹配不到。这条钉住「自己扫」这个决定。
   */
  const s = parseHdu(gbkFixture('hdu-2609.html'), '2609', HDU_URL);
  assert.ok(s.markdown.includes('## 输入格式'));
});
