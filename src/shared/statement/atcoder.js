/**
 * AtCoder 题面。
 *
 * 从服务端逐行搬过来，逻辑一字未改。
 */

import { endsWithNewline, sampleSections, withFrontMatter } from './common.js';
import { decodeEntities, htmlToMarkdown, sliceClass, sliceId, stripTags } from './html.js';

export function parseAtCoder(html, key, url) {
  const area = sliceId(html, 'task-statement') ?? html;

  /*
   * AtCoder 的页面里中英文两份题面都在，各自包在 span.lang-ja / span.lang-en 里。
   * 优先英文：本仓库的其他题面也都是英文/中文混排，而日文对多数人不可读。
   * 没有英文块（旧比赛只有日文）就退回整块。
   */
  const language = new URL(url).searchParams.get('lang') === 'ja' ? 'ja' : 'en';
  const scoped = sliceClass(area, `lang-${language}`) ?? sliceClass(area, 'lang-en') ?? sliceClass(area, 'lang-ja') ?? area;

  /*
   * 标题在 <span class="h2"> 里，但那个元素后面还跟着「Editorial」链接。
   * 只取第一行——链接换行之后成了第二行，正好被切掉。
   */
  const rawTitle =
    decodeEntities(stripTags(sliceClass(html, 'h2') ?? '')) ||
    decodeEntities(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  const title =
    rawTitle
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)[0]
      ?.replace(/\s*-\s*AtCoder.*$/i, '')
      .trim() || key;

  /*
   * 时间/内存限制在一个没有类名的 <p> 里（`Time Limit: 2 sec / Memory Limit: 1024 MB`），
   * 所以只能在整页文本里找这行字，不能靠选择器。
   */
  const pageText = decodeEntities(stripTags(html));
  const timeMatch = /Time Limit:\s*([\d.]+)\s*sec/i.exec(pageText);
  // AtCoder 写的是 MiB 不是 MB，两种都认——只认一种会让内存限制永远是空的
  const memMatch = /Memory Limit:\s*(\d+)\s*M(?:i)?B/i.exec(pageText);
  const timeLimitMs = timeMatch?.[1] ? Math.round(Number(timeMatch[1]) * 1000) : null;
  const memoryLimitMb = memMatch?.[1] ? Number(memMatch[1]) : null;

  const samples = extractAtCoderSamples(scoped);

  const parts = [`# ${title}`, ''];
  if (timeLimitMs || memoryLimitMb) {
    parts.push(
      `> ${[timeLimitMs ? `时间限制 ${timeLimitMs}ms` : '', memoryLimitMb ? `内存限制 ${memoryLimitMb}MB` : ''].filter(Boolean).join('　')}`,
      '',
    );
  }
  // 样例那几节已经单独抽出来了，正文里去掉以免重复
  const withoutSamples = scoped.replace(
    /<div class="part">\s*<section>\s*<h3>\s*(?:Sample|入力例|出力例)[\s\S]*?<\/section>\s*<\/div>/gi,
    '',
  );
  const main = htmlToMarkdown(withoutSamples).trim();
  if (main) parts.push(main, '');

  parts.push(...sampleSections(samples));

  return {
    platform: 'atcoder',
    problemKey: key,
    title,
    url,
    markdown: withFrontMatter(parts.join('\n'), 'atcoder', key, title, url, {
      timeLimitMs,
      memoryLimitMb,
    }),
    samples,
    timeLimitMs,
    memoryLimitMb,
  };
}

/** AtCoder 的样例：`<h3>Sample Input 1</h3>` 后面紧跟一个 pre，输入输出交替。 */
function extractAtCoderSamples(html) {
  const found = [];
  const pattern = /<h3>\s*([^<]*?)\s*<\/h3>[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  for (const m of html.matchAll(pattern)) {
    const heading = decodeEntities(m[1] ?? '');
    const text = decodeEntities(stripTags(m[2] ?? ''))
      .replace(/\r\n?/g, '\n')
      .trimEnd();
    if (/sample input|入力例/i.test(heading)) found.push({ kind: 'in', text });
    else if (/sample output|出力例/i.test(heading)) found.push({ kind: 'out', text });
  }

  const samples = [];
  for (let i = 0; i + 1 < found.length; ) {
    // 严格按「输入紧跟输出」配对；配不上就往前挪一格，绝不跨组硬凑
    if (found[i]?.kind === 'in' && found[i + 1]?.kind === 'out') {
      samples.push({
        input: endsWithNewline(found[i].text),
        output: endsWithNewline(found[i + 1].text),
      });
      i += 2;
    } else {
      i += 1;
    }
  }
  return samples;
}
