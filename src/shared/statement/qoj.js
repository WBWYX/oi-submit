/**
 * QOJ 题面（UOJ-System 系）。
 *
 * 页面结构（实测 https://qoj.ac/problem/1000，2026-09）：
 *
 *   <div class="uoj-content">
 *     <span class="badge badge-secondary mr-1">Time Limit:    5 s    </span>
 *     <span class="badge badge-secondary mr-1">Memory Limit:  512 MB </span>
 *     <h1 class="page-header text-center">#1000. 边三连通分量</h1>
 *     <article class="uoj-article">
 *       <h2>Statement</h2> <p>…</p>
 *       <h2>Example</h2>
 *       <h3>Input 1</h3>  <pre><code class="sh_plain">4 5…</code></pre>
 *       <h3>Output 1</h3> <pre><code class="sh_plain">3…</code></pre>
 *     </article>
 *
 * 三处踩过或差点踩的坑：
 *
 *   · **标题不能取「第一个 h1」**。页头的站名 `<h1>QOJ.ac</h1>` 排在题目标题前面，
 *     取第一个拿到的是 "QOJ.ac"。必须认 `class="page-header"`。
 *     （Timus 提交时点中页头搜索按钮是同一类错误：页头的东西总是排在前面。）
 *   · **样例小标题是 `Input 1` / `Output 1`，不是成对的表格**。得按编号把
 *     input/output 配起来，不能假设它们严格交替出现——有的题只给 Input 不给 Output
 *     （交互题），错位配对会把下一组的输入当成这一组的输出。
 *   · 正文里 `<pre><code>` 的内容是**转义过的 HTML 实体**（`&lt;` `&amp;`），
 *     样例里恰恰常有 `<` `>`，不解码会把 `a<b` 存成 `a&lt;b`，本地判题直接 WA。
 */

import { StatementError, endsWithNewline, sampleSections, withFrontMatter } from './common.js';
import { decodeEntities, htmlToMarkdown, sliceClass, sliceTag, stripTags } from './html.js';

export function parseQoj(html, id, url) {
  const rawTitle = decodeEntities(stripTags(sliceClass(html, 'page-header') ?? '')).trim();
  if (!rawTitle) {
    throw new StatementError(
      502,
      `QOJ 页面里没找到题目标题（#${id}）。可能是题号不存在、题目未公开，或页面结构变了。`,
    );
  }
  // 标题形如「#1000. 边三连通分量」，去掉前面的题号
  const title = rawTitle.replace(/^\s*#?\d+\.\s*/, '') || rawTitle;

  const { timeLimitMs, memoryLimitMb } = parseLimits(html);

  const article = sliceTag(html, 'article', 'uoj-article');
  if (!article) {
    /*
     * 文章体缺失最常见的原因是没登录：QOJ 有些题（比赛期间、私有题库）匿名看不到正文，
     * 但标题和限制仍然渲染出来。所以这里不能只说「结构变了」——那会让人去查错方向。
     */
    throw new StatementError(
      403,
      `QOJ #${id} 没有可读的题面正文。若这题需要登录或需要权限，请先在浏览器里登录 QOJ。`,
    );
  }

  const samples = extractQojSamples(article);

  const parts = [`# ${title}`, ''];
  if (timeLimitMs !== null || memoryLimitMb !== null) {
    parts.push(
      `> ${[
        timeLimitMs !== null ? `时间限制 ${timeLimitMs}ms` : '',
        memoryLimitMb !== null ? `内存限制 ${memoryLimitMb}MB` : '',
      ]
        .filter(Boolean)
        .join('　')}`,
      '',
    );
  }

  const sections = splitByH2(article);
  /*
   * 第一个 <h2> 之前的那段通常是引言（QOJ 上常见的是一行 `Source: Library Checker`），
   * 真正的题目描述在 `<h2>Statement</h2>` 里。给引言也扣一个「## 题目描述」的话，
   * 一份题面里会出现两个同名小节——下游按小节名找内容时，取到的是那行来源说明。
   * 所以只有在**整篇一个 h2 都没有**时，开头那段才是描述本身。
   */
  const hasHeadings = sections.some((s) => s.heading.trim());
  let samplesPlaced = false;
  for (const section of sections) {
    const heading = sectionName(section.heading);
    /*
     * Example 那一节的正文全是样例块（h3 + pre），转成 Markdown 只会得到一堆
     * 重复的代码块。所以整节替换成统一格式的样例小节，插在页面上原本的位置。
     */
    if (/^examples?$/i.test(section.heading.trim())) {
      parts.push(...sampleSections(samples));
      samplesPlaced = true;
      continue;
    }
    // QOJ 题面图片常使用站内相对路径，不能让 Markdown 落盘后失去图片。
    const text = htmlToMarkdown(stripSampleBlocks(section.body), { baseUrl: url }).trim();
    if (!text) continue;
    if (!heading) {
      if (hasHeadings) parts.push(text, '');
      else parts.push('## 题目描述', '', text, '');
      continue;
    }
    parts.push(`## ${heading}`, '', text, '');
  }
  if (!samplesPlaced && samples.length) parts.push(...sampleSections(samples));

  return {
    platform: 'qoj',
    problemKey: String(id),
    title,
    url,
    markdown: withFrontMatter(parts.join('\n'), 'qoj', String(id), title, url, {
      timeLimitMs,
      memoryLimitMb,
    }),
    samples,
    timeLimitMs,
    memoryLimitMb,
  };
}

/**
 * 限制在页头的 badge 里：`Time Limit: 5 s` / `Memory Limit: 512 MB`。
 *
 * 时限可能带小数（`0.5 s`），也可能写成 `1000 ms`，两种都认。
 *
 * **只在 badge 里找，不在整页里找。** `stripTags` 去掉的是标签，`<script>` 的
 * 函数体会原样留在文本里；QOJ 页面上带着一大堆内联脚本，在整页文本上跑这两条
 * 正则等于让脚本里任何一处 `Time Limit:` 的字样都有机会抢答。
 */
function parseLimits(html) {
  const badges = [...html.matchAll(/<span[^>]*\bclass=["'][^"']*\bbadge\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)]
    .map((m) => m[1] ?? '')
    .join(' ');
  const text = decodeEntities(stripTags(badges));
  const time = /Time\s*Limit:\s*([\d.]+)\s*(ms|s\b)/i.exec(text);
  const mem = /Memory\s*Limit:\s*([\d.]+)\s*(MB|KB|GB)/i.exec(text);

  let timeLimitMs = null;
  if (time?.[1]) {
    const value = Number(time[1]);
    if (Number.isFinite(value)) {
      timeLimitMs = /^ms$/i.test(time[2] ?? '') ? Math.round(value) : Math.round(value * 1000);
    }
  }

  let memoryLimitMb = null;
  if (mem?.[1]) {
    const value = Number(mem[1]);
    if (Number.isFinite(value)) {
      const unit = (mem[2] ?? '').toUpperCase();
      memoryLimitMb = unit === 'KB' ? Math.round(value / 1024) : unit === 'GB' ? Math.round(value * 1024) : Math.round(value);
    }
  }
  return { timeLimitMs, memoryLimitMb };
}

/** 按 <h2> 切段：返回 {heading, body}，第一段的 heading 为空串。 */
function splitByH2(html) {
  const out = [];
  const pattern = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  let lastEnd = 0;
  let lastHeading = '';
  for (const m of html.matchAll(pattern)) {
    out.push({ heading: lastHeading, body: html.slice(lastEnd, m.index) });
    lastHeading = decodeEntities(stripTags(m[1] ?? ''));
    lastEnd = (m.index ?? 0) + m[0].length;
  }
  out.push({ heading: lastHeading, body: html.slice(lastEnd) });
  return out;
}

/** 英文小标题 → 与另外几家一致的节名；认不出的原样保留。 */
function sectionName(heading) {
  const h = heading.trim().toLowerCase();
  if (!h) return '';
  if (h === 'statement' || h === 'description') return '题目描述';
  if (h === 'input' || h === 'input format') return '输入格式';
  if (h === 'output' || h === 'output format') return '输出格式';
  if (h === 'constraint' || h === 'constraints' || h === 'limits') return '数据范围';
  if (h === 'note' || h === 'notes' || h === 'hint') return '提示';
  return heading.trim();
}

/**
 * 样例：`<h3>Input 1</h3><pre><code>…</code></pre>` 与对应的 `Output 1`。
 *
 * 按标题里的编号配对（见文件头），没有编号的按出现顺序兜底。
 */
function extractQojSamples(html) {
  const inputs = new Map();
  const outputs = new Map();
  let fallback = 0;

  const pattern = /<h3[^>]*>([\s\S]*?)<\/h3>\s*<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  for (const m of html.matchAll(pattern)) {
    const heading = decodeEntities(stripTags(m[1] ?? '')).trim();
    const kind = /^input/i.test(heading) ? 'input' : /^output/i.test(heading) ? 'output' : null;
    if (!kind) continue;
    const numbered = /(\d+)/.exec(heading);
    const n = numbered?.[1] ? Number(numbered[1]) : ++fallback;
    const text = decodeEntities(stripTags(m[2] ?? '')).replace(/\r\n?/g, '\n');
    (kind === 'input' ? inputs : outputs).set(n, text);
  }

  const samples = [];
  for (const n of [...inputs.keys()].sort((a, b) => a - b)) {
    const input = inputs.get(n) ?? '';
    if (!input.trim()) continue;
    samples.push({
      input: endsWithNewline(input.replace(/^\n+/, '').trimEnd()),
      output: endsWithNewline((outputs.get(n) ?? '').replace(/^\n+/, '').trimEnd()),
    });
  }
  return samples;
}

/** 正文里去掉样例块，免得样例出现两遍。 */
function stripSampleBlocks(html) {
  return html.replace(/<h3[^>]*>[\s\S]*?<\/h3>\s*<pre[^>]*>[\s\S]*?<\/pre>/gi, '');
}
