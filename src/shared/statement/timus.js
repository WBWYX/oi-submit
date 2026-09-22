/**
 * Timus（URAL）题面。
 *
 * 这一家是新写的，服务端从来没做过。好消息是它的页面是四家里最老实的静态 HTML：
 *
 *   <H2 class="problem_title">1297. Palindrome</H2>
 *   <DIV class="problem_limits">Time limit: 1.0 second<BR>Memory limit: 64 MB<BR></DIV>
 *   <DIV id="problem_text">
 *     <DIV class="problem_par"><DIV class="problem_par_normal">正文段落…</DIV></DIV>
 *     <H3>Input</H3>  …  <H3>Output</H3>  …  <H3>Sample</H3>
 *     <TABLE class="sample"><TR><TH>input</TH><TH>output</TH></TR>
 *       <TR><TD><PRE>Kazak </PRE></TD><TD><PRE>aza </PRE></TD></TR></TABLE>
 *     <DIV class="problem_source">…</DIV>
 *   </DIV>
 *
 * 两处要当心：
 *   · 小标题是 `<H3>`，不是别家那种带类名的 div，所以按 H3 切段。
 *   · 样例的 `<PRE>` 里**带尾随空格**（`Kazak ` 而不是 `Kazak`），
 *     不清掉的话会被当成答案的一部分，本地判题会莫名其妙 WA。
 */

import { StatementError, endsWithNewline, sampleSections, withFrontMatter } from './common.js';
import { decodeEntities, htmlToMarkdown, sliceClass, sliceId, stripTags } from './html.js';

export function parseTimus(html, num, url) {
  const rawTitle = decodeEntities(stripTags(sliceClass(html, 'problem_title') ?? '')).trim();
  if (!rawTitle) {
    throw new StatementError(
      502,
      'Timus 页面里没找到题目标题。可能是题号不存在，或页面结构变了。',
    );
  }
  // 标题形如「1297. Palindrome」，去掉前面的题号
  const title = rawTitle.replace(/^\s*\d+\.\s*/, '') || rawTitle;

  const limitText = decodeEntities(stripTags(sliceClass(html, 'problem_limits') ?? ''));
  const timeMatch = /Time limit:\s*([\d.]+)\s*second/i.exec(limitText);
  const memMatch = /Memory limit:\s*(\d+)\s*M(?:i)?B/i.exec(limitText);
  const timeLimitMs = timeMatch?.[1] ? Math.round(Number(timeMatch[1]) * 1000) : null;
  const memoryLimitMb = memMatch?.[1] ? Number(memMatch[1]) : null;

  const body = sliceId(html, 'problem_text') ?? html;
  const samples = extractTimusSamples(body);

  const parts = [`# ${title}`, ''];
  if (timeLimitMs || memoryLimitMb) {
    parts.push(
      `> ${[timeLimitMs ? `时间限制 ${timeLimitMs}ms` : '', memoryLimitMb ? `内存限制 ${memoryLimitMb}MB` : ''].filter(Boolean).join('　')}`,
      '',
    );
  }

  /*
   * 按 <H3> 把正文切成若干节。第一节没有标题（题目描述本身），其余用页面上的
   * 英文小标题，映射成与另外三家一致的中文节名——下游按「## 输入格式」找内容，
   * 各家叫法不统一的话，同一套提取逻辑就得为每个平台各写一遍。
   */
  const cleaned = stripSampleTables(stripSource(body));
  let samplesPlaced = false;
  for (const section of splitByH3(cleaned)) {
    /*
     * 样例插在页面上原本的位置（`<H3>Sample</H3>` 那一节），而不是一律堆到最后。
     * Timus 的 Notes 排在样例之后，一律追加到末尾会把这个顺序颠倒过来——
     * 读题的人会先看到注解再看到样例，和网页上读到的不是一回事。
     */
    if (/^samples?$/i.test(section.heading.trim())) {
      parts.push(...sampleSections(samples));
      samplesPlaced = true;
      continue;
    }
    const heading = sectionName(section.heading);
    // Timus 的图示也可能是相对地址，转换时绑定题面 URL 作为基准。
    const text = htmlToMarkdown(section.body, { baseUrl: url }).trim();
    if (!text) continue;
    if (heading) parts.push(`## ${heading}`, '', text, '');
    else parts.push('## 题目描述', '', text, '');
  }
  // 页面上没有 Sample 小节（有些题的样例表直接跟在正文后）时才补到末尾
  if (!samplesPlaced) parts.push(...sampleSections(samples));

  const source = decodeEntities(stripTags(sliceClass(html, 'problem_source') ?? '')).trim();
  if (source) parts.push('## 来源', '', source.replace(/\s+/g, ' '), '');

  return {
    platform: 'timus',
    problemKey: num,
    title,
    url,
    markdown: withFrontMatter(parts.join('\n'), 'timus', num, title, url, {
      timeLimitMs,
      memoryLimitMb,
    }),
    samples,
    timeLimitMs,
    memoryLimitMb,
  };
}

/** 英文小标题 → 与另外三家一致的节名；认不出的原样保留。 */
function sectionName(heading) {
  const h = heading.trim().toLowerCase();
  if (!h) return '';
  if (h === 'input') return '输入格式';
  if (h === 'output') return '输出格式';
  if (h === 'notes' || h === 'note' || h === 'hint') return '提示';
  return heading.trim();
}

/** 按 <H3> 切段：返回 {heading, body}，第一段的 heading 为空串。 */
function splitByH3(html) {
  const out = [];
  const pattern = /<h3[^>]*>([\s\S]*?)<\/h3>/gi;
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

/**
 * 样例表。
 *
 * 表头是 `<TH>input</TH><TH>output</TH>`，数据行是成对的 `<TD><PRE>…</PRE></TD>`。
 * 一道题可能有多张 sample 表（多组样例），所以逐表逐行收。
 */
function extractTimusSamples(html) {
  const samples = [];
  for (const table of html.matchAll(/<table[^>]*class=["'][^"']*\bsample\b[^"']*["'][\s\S]*?<\/table>/gi)) {
    for (const row of table[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) =>
        // 尾随空格必须清掉，见文件头
        decodeEntities(stripTags(m[1] ?? ''))
          .replace(/\r\n?/g, '\n')
          .replace(/[ \t]+$/gm, '')
          .trim(),
      );
      if (cells.length >= 2 && cells[0] !== '') {
        samples.push({ input: endsWithNewline(cells[0]), output: endsWithNewline(cells[1]) });
      }
    }
  }
  return samples;
}

/** 正文里去掉样例表，免得样例出现两遍。 */
function stripSampleTables(html) {
  return html.replace(/<table[^>]*class=["'][^"']*\bsample\b[^"']*["'][\s\S]*?<\/table>/gi, '');
}

/** 去掉「Problem Author / Problem Source」那一块，它单独成节。 */
function stripSource(html) {
  return html.replace(/<div[^>]*class=["'][^"']*\bproblem_source\b[\s\S]*$/i, '');
}
