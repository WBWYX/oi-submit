/**
 * HDU（杭电 OJ）题面。
 *
 * 页面是八家里最老的静态 HTML，结构很规整（实测 1000 / 2049 / 2609 完全一致）：
 *
 *   <h1 style='color:#1A5CC8'>How many</h1>
 *   Time Limit: 2000/1000 MS (Java/Others)    Memory Limit: 65536/32768 K (Java/Others)
 *   <div class=panel_title align=left>Problem Description</div>
 *   <div class=panel_content>正文…</div><div class=panel_bottom>&nbsp;</div><br>
 *   <div class=panel_title align=left>Sample Input</div>
 *   <div class=panel_content><pre><div style="font-family:Courier New,…">4
 *   0110
 *   </div></pre></div>
 *
 * 四处要当心：
 *
 *   · **class 不带引号**（`class=panel_title`）。`html.js` 的 `sliceClass` 写的是
 *     `class=["']`，对 HDU 一个都匹配不到——所以这里自己扫，不复用它。
 *   · **限制是 `Java/Others` 两个值，C++ 取斜杠后面那个**：`2000/1000 MS` 的实际
 *     时限是 1000ms。取前面那个是 Java 的限制，本地判题会宽一倍——这种错不报错，
 *     只会让你本地过、线上 TLE。
 *   · **样例外面套了两层**：`<pre>` 里还有一个 `<div style="font-family:…">`，
 *     那个 div 只是为了等宽字体，不剥掉会把标签当成样例内容。
 *   · 页面是 **GB2312**，解码在 index.js 的 getHtml 里做（`charset: 'gbk'`）。
 *     进到这个函数时已经是正常的 Unicode 字符串了。
 */

import { StatementError, endsWithNewline, sampleSections, withFrontMatter } from './common.js';
import { balancedFrom, decodeEntities, htmlToMarkdown, stripTags } from './html.js';

/** 正文里要原样保留、但要换成中文节名的小标题。 */
const SECTION_NAMES = new Map([
  ['problem description', '题目描述'],
  ['description', '题目描述'],
  ['input', '输入格式'],
  ['output', '输出格式'],
  ['hint', '提示'],
  ['note', '提示'],
]);

export function parseHdu(html, pid, url) {
  const title = decodeEntities(stripTags(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '')).trim();
  if (!title) {
    throw new StatementError(
      502,
      'HDU 页面里没找到题目标题。可能是题号不存在，或页面结构变了。',
    );
  }

  const { timeLimitMs, memoryLimitMb } = parseLimits(html);
  const blocks = panelBlocks(html);
  if (blocks.length === 0) {
    throw new StatementError(502, `HDU ${pid} 的页面里一个题面小节都没找到，页面结构可能变了。`);
  }

  const samples = extractSamples(blocks);

  const parts = [`# ${title}`, ''];
  if (timeLimitMs || memoryLimitMb) {
    parts.push(
      `> ${[
        timeLimitMs ? `时间限制 ${timeLimitMs}ms` : '',
        memoryLimitMb ? `内存限制 ${memoryLimitMb}MB` : '',
      ]
        .filter(Boolean)
        .join('　')}`,
      '',
    );
  }

  let samplesPlaced = false;
  const source = [];
  for (const block of blocks) {
    const key = block.name.toLowerCase();

    // 样例插在页面上原本的位置，而不是一律堆到末尾——HDU 的 Hint 排在样例之后
    if (key === 'sample input') {
      if (!samplesPlaced) {
        parts.push(...sampleSections(samples));
        samplesPlaced = true;
      }
      continue;
    }
    if (key === 'sample output') continue; // 已随 Sample Input 一并产出

    /*
     * Author / Source 是元信息，不进正文——混进去只会干扰下游按节名取内容，
     * 也会让 L3 把「出题人是谁」当成题目特征。统一收到末尾的「来源」里。
     */
    if (key === 'author' || key === 'source') {
      const text = decodeEntities(stripTags(block.body)).replace(/\s+/g, ' ').trim();
      if (text) source.push(`${block.name}: ${text}`);
      continue;
    }

    // 正文里带图片，要 baseUrl 才能把 ../data/images/... 解析成绝对地址
    const text = htmlToMarkdown(block.body, { baseUrl: url }).trim();
    if (!text) continue;
    parts.push(`## ${SECTION_NAMES.get(key) ?? block.name}`, '', text, '');
  }
  // 页面上没有 Sample Input 小节（少数题没有样例）时才补到末尾
  if (!samplesPlaced) parts.push(...sampleSections(samples));
  if (source.length > 0) parts.push('## 来源', '', source.join('　'), '');

  return {
    platform: 'hdu',
    problemKey: String(pid),
    title,
    url,
    markdown: withFrontMatter(parts.join('\n'), 'hdu', pid, title, url, {
      timeLimitMs,
      memoryLimitMb,
    }),
    samples,
    timeLimitMs,
    memoryLimitMb,
  };
}

/**
 * 时限与空间。
 *
 * 写法是 `Time Limit: 2000/1000 MS (Java/Others)` —— 斜杠前是 Java 的、后面是其余
 * 语言（也就是 C++）的。**捕获后面那个**，理由见文件头。
 */
function parseLimits(html) {
  const text = decodeEntities(html);
  const time = /Time\s*Limit:\s*\d+\s*\/\s*(\d+)\s*MS/i.exec(text);
  const mem = /Memory\s*Limit:\s*\d+\s*\/\s*(\d+)\s*K/i.exec(text);
  return {
    timeLimitMs: time?.[1] ? Number(time[1]) : null,
    // 页面给的是 KB，下游要 MB
    memoryLimitMb: mem?.[1] ? Math.round(Number(mem[1]) / 1024) : null,
  };
}

/**
 * 把页面扫成 `{name, body}` 的小节序列。
 *
 * `panel_title` 与紧跟的 `panel_content` 成对出现，但**两者之间有时夹一个空格**
 * （真实页面里 Author 那节就是 `</div> <div class=panel_content>`），所以中间要允许空白。
 *
 * body 用 `balancedFrom` 取：样例那节的 panel_content 里嵌着 `<pre><div>`，
 * 按「找下一个 </div>」会在内层 div 处截断，把样例砍掉一半。
 */
function panelBlocks(html) {
  const out = [];
  const titlePattern = /<div[^>]*\bclass=["']?panel_title\b[^>]*>([\s\S]*?)<\/div>/gi;
  for (const m of html.matchAll(titlePattern)) {
    const name = decodeEntities(stripTags(m[1] ?? '')).trim();
    if (!name) continue;
    const after = (m.index ?? 0) + m[0].length;
    const next = /^(\s*)<div[^>]*\bclass=["']?panel_content\b[^>]*>/i.exec(html.slice(after));
    if (!next) continue;
    /*
     * 必须跳过前导空白再交给 balancedFrom —— 它要求起始位置就是 `<`，落在空格上
     * 会直接返回 null。真实页面里 Problem Description / Input / Output / Author /
     * Source 五节都带这个空格，只有样例那两节没有：踩了这个坑的表现是**正文整个
     * 消失、只剩样例**，而且不报错。
     */
    const whole = balancedFrom(html, after + next.index + (next[1] ?? '').length);
    if (!whole) continue;
    // balancedFrom 连开闭标签一起返回，这里只要内容
    const body = whole.replace(/^<div[^>]*>/i, '').replace(/<\/div>$/i, '');
    out.push({ name, body });
  }
  return out;
}

/**
 * 样例。HDU 每题只有一对 Sample Input / Sample Output，但那一对里可能含多组数据。
 *
 * 取 `<pre>` 的纯文本。`<pre>` 里那层 `<div style="font-family:Courier New…">`
 * 只是为了等宽显示，`stripTags` 会连它一起剥掉。
 */
function extractSamples(blocks) {
  const pick = (name) => {
    const block = blocks.find((b) => b.name.toLowerCase() === name);
    if (!block) return null;
    const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(block.body);
    const text = decodeEntities(stripTags(pre?.[1] ?? block.body))
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .trim();
    return text === '' ? null : text;
  };
  const input = pick('sample input');
  const output = pick('sample output');
  // 只有输入没有输出（或反过来）就不产出——半对样例喂给本地判题只会误导
  if (input === null || output === null) return [];
  return [{ input: endsWithNewline(input), output: endsWithNewline(output) }];
}
