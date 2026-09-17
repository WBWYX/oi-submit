/**
 * Codeforces 题面。
 *
 * 没有题面 API，只能抓 HTML 再转。转换必然有损，所以宁可保守：认不出的结构
 * 原样保留文字，绝不猜。
 *
 * 从服务端逐行搬过来，逻辑一字未改——这份解析有真实页面夹具兜着，
 * 搬家时顺手重构是最容易把它弄坏的方式。
 */

import { StatementError, endsWithNewline, sampleSections, withFrontMatter } from './common.js';
import {
  balancedFrom,
  decodeEntities,
  dropFirstHeading,
  htmlToMarkdown,
  preText,
  sliceClass,
  sliceTag,
  stripTags,
} from './html.js';

export function parseCodeforces(html, key, url) {
  const block = sliceTag(html, 'div', 'problem-statement');
  if (!block) {
    throw new StatementError(
      502,
      'Codeforces 页面里没找到题面区块。可能是比赛未开始、需要登录，或页面结构又变了。',
    );
  }

  const title = decodeEntities(stripTags(sliceClass(block, 'title') ?? key)).trim() || key;
  const timeLimitMs = parseCfLimit(sliceClass(block, 'time-limit'), /([\d.]+)\s*second/i, 1000);
  const memoryLimitMb = parseCfLimit(sliceClass(block, 'memory-limit'), /(\d+)\s*megabyte/i, 1);

  const samples = extractCfSamples(block);

  /*
   * 正文按 Codeforces 自己的分节拼：题面主体是 header 之后、sample-tests 之前
   * 那一段。它没有类名，只能靠位置切——这也是 HTML 抓取天生脆弱的地方，
   * 所以下面每一步失败都降级成「少一节」，而不是整份抓取失败。
   */
  const parts = [`# ${title}`, ''];
  const limitLine = [
    timeLimitMs ? `时间限制 ${timeLimitMs}ms` : '',
    memoryLimitMb ? `内存限制 ${memoryLimitMb}MB` : '',
  ]
    .filter(Boolean)
    .join('　');
  if (limitLine) parts.push(`> ${limitLine}`, '');

  /*
   * 题面主体（legend）是 header 之后紧跟的那个 div，而且它**没有类名**——
   * 只能靠位置定位。
   *
   * 两件事都不能省：一是必须整块跳过 header（里面嵌着时限、内存、输入输出方式
   * 各一层 div，从第一个 `</div>` 开始会把这堆元信息当成正文）；二是必须按配对
   * 计数取到 legend 自己的结束标签，而不是「切到 sample-tests 之前」——后者会
   * 把输入输出格式那两节也吃进来，于是它们在文件里出现两遍。
   */
  const header = sliceClass(block, 'header');
  const afterHeader = header ? block.slice(block.indexOf(header) + header.length) : block;
  const legendStart = afterHeader.search(/<div\b/i);
  const legend = legendStart >= 0 ? balancedFrom(afterHeader, legendStart) : null;
  const main = htmlToMarkdown(legend ?? afterHeader);
  if (main.trim()) parts.push('## 题目描述', '', main.trim(), '');

  const input = sliceClass(block, 'input-specification');
  if (input) parts.push('## 输入格式', '', htmlToMarkdown(dropFirstHeading(input)).trim(), '');
  const output = sliceClass(block, 'output-specification');
  if (output) parts.push('## 输出格式', '', htmlToMarkdown(dropFirstHeading(output)).trim(), '');

  parts.push(...sampleSections(samples));

  const note = sliceClass(block, 'note');
  if (note) parts.push('## 提示', '', htmlToMarkdown(dropFirstHeading(note)).trim(), '');

  return {
    platform: 'codeforces',
    problemKey: key,
    title,
    url,
    markdown: withFrontMatter(parts.join('\n'), 'codeforces', key, title, url, {
      timeLimitMs,
      memoryLimitMb,
    }),
    samples,
    timeLimitMs,
    memoryLimitMb,
  };
}

function parseCfLimit(html, pattern, scale) {
  if (!html) return null;
  const m = pattern.exec(decodeEntities(stripTags(html)));
  return m?.[1] ? Math.round(Number(m[1]) * scale) : null;
}

/**
 * Codeforces 的样例。
 *
 * 结构是 `.sample-test` 里若干组 `.input pre` / `.output pre` 交替。新版页面的
 * pre 里每行包在 `<div class="test-example-line">` 中，老版是纯文本加 `<br>`，
 * 两种都要认——只认一种的话，一半的题会抓出空样例。
 */
function extractCfSamples(block) {
  const area = sliceClass(block, 'sample-tests') ?? block;
  const inputs = [...area.matchAll(/<div class="input">([\s\S]*?)<\/div>\s*(?=<div class="output">)/g)]
    .map((m) => preText(m[1] ?? ''))
    .filter((t) => t !== '');
  const outputs = [...area.matchAll(/<div class="output">([\s\S]*?)<\/div>\s*(?=<div class="input">|$)/g)]
    .map((m) => preText(m[1] ?? ''))
    .filter((t) => t !== '');

  const samples = [];
  for (let i = 0; i < Math.min(inputs.length, outputs.length); i++) {
    samples.push({ input: endsWithNewline(inputs[i]), output: endsWithNewline(outputs[i]) });
  }
  return samples;
}
