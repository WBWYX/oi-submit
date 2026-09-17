/**
 * 牛客题面。
 *
 * 页面结构（实测 https://ac.nowcoder.com/acm/problem/13885，2026-09）：
 *
 *   <div class="question-title">Music Problem</div>
 *   <div class="subject-item-wrap">
 *     <span>题号：NC13885</span><br>
 *     <span>时间限制：C/C++/Rust/Pascal 2秒，其他语言4秒</span><br>
 *     <span>空间限制：C/C++/Rust/Pascal 128 M，其他语言256 M</span><br>
 *   <h2 class="subject-item-title">题目描述</h2>
 *   <div class="subject-describe"><div class="subject-question">…</div></div>
 *   <h2 style="…">输入描述:</h2> <pre>…</pre>
 *   <h2 style="…">输出描述:</h2> <pre>…</pre>
 *   <div class="question-oi">
 *     <div class="question-oi-hd">示例1</div>
 *     <div class="question-oi-mod">
 *       <h2>输入</h2>
 *       <textarea data-clipboard-text-id="input1" style="display:none;">3…</textarea>
 *       <div class="question-oi-cont"><pre>3…</pre></div>
 *
 * 三处要当心：
 *
 *   · **样例取 `<textarea>` 而不是 `<pre>`**。两处内容一样，但 `<pre>` 里换行被渲染成
 *     `<br>`、里面还嵌了高亮用的标签，扒出来要反转义一轮；而那个隐藏 textarea 是
 *     给「复制」按钮用的原文，一次到位。取错了的表现是样例里多出 `<br>` 或少了换行，
 *     本地判题会全是 WA 而看不出哪儿不对。
 *   · **限制是分语言写的**：「C/C++/Rust/Pascal 2秒，其他语言4秒」。取 C/C++ 那一档——
 *     本地判的就是 C++，取「其他语言」那个数会把时限放宽一倍，本地过了交上去 TLE。
 *   · **标题不能用 `<title>`**：牛客的比赛题 `<title>` 会带上比赛名。用页面里的
 *     `question-title`。
 */

import { StatementError, endsWithNewline, sampleSections, withFrontMatter } from './common.js';
import { decodeEntities, htmlToMarkdown, sliceClass, stripTags } from './html.js';

export function parseNowcoder(html, key, url) {
  const title = decodeEntities(stripTags(sliceClass(html, 'question-title') ?? '')).trim();
  if (!title) {
    throw new StatementError(
      502,
      `牛客页面里没找到题目标题（${key}）。可能是题号不存在、需要登录，或页面结构变了。`,
    );
  }

  const { timeLimitMs, memoryLimitMb } = parseLimits(html);
  const samples = extractNowcoderSamples(html);

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

  const description = extractDescription(html);
  if (description) parts.push('## 题目描述', '', description, '');

  for (const [heading, section] of [
    ['输入格式', '输入描述'],
    ['输出格式', '输出描述'],
  ]) {
    const text = sectionAfterHeading(html, section);
    if (text) parts.push(`## ${heading}`, '', text, '');
  }

  parts.push(...sampleSections(samples));

  /*
   * 「说明」跟在样例后面（它解释的就是样例），所以排在样例小节之后，
   * 与页面上的阅读顺序一致。
   */
  const notes = extractNotes(html);
  notes.forEach((note, i) => {
    if (note) parts.push(`## 说明${notes.length > 1 ? ` #${i + 1}` : ''}`, '', note, '');
  });

  const extra = sectionAfterHeading(html, '备注');
  if (extra) parts.push('## 备注', '', extra, '');

  return {
    platform: 'nowcoder',
    problemKey: key,
    title,
    url,
    markdown: withFrontMatter(parts.join('\n'), 'nowcoder', key, title, url, {
      timeLimitMs,
      memoryLimitMb,
    }),
    samples,
    timeLimitMs,
    memoryLimitMb,
  };
}

/**
 * 「时间限制：C/C++/Rust/Pascal 2秒，其他语言4秒」
 * 「空间限制：C/C++/Rust/Pascal 128 M，其他语言256 M」
 *
 * 取第一个数（C/C++ 那一档），理由见文件头。时限也可能写成「1000毫秒」。
 */
function parseLimits(html) {
  const wrap = sliceClass(html, 'subject-item-wrap') ?? html;
  const text = decodeEntities(stripTags(wrap)).replace(/\s+/g, ' ');

  let timeLimitMs = null;
  const ms = /时间限制[：:][^，,]*?([\d.]+)\s*毫秒/.exec(text);
  const sec = /时间限制[：:][^，,]*?([\d.]+)\s*秒/.exec(text);
  if (ms?.[1]) timeLimitMs = Math.round(Number(ms[1]));
  else if (sec?.[1]) timeLimitMs = Math.round(Number(sec[1]) * 1000);

  let memoryLimitMb = null;
  const mem = /空间限制[：:][^，,]*?([\d.]+)\s*(M|MB|K|KB|G|GB)\b/i.exec(text);
  if (mem?.[1]) {
    const value = Number(mem[1]);
    const unit = (mem[2] ?? 'M').toUpperCase();
    if (Number.isFinite(value)) {
      memoryLimitMb = unit.startsWith('K') ? Math.round(value / 1024) : unit.startsWith('G') ? Math.round(value * 1024) : Math.round(value);
    }
  }
  return { timeLimitMs, memoryLimitMb };
}

/**
 * 题目描述。
 *
 * **取 `subject-question`，不是 `subject-describe`。** 后者听着更像"描述"，实际上
 * 它把输入描述、输出描述、示例块统统包在里面（实测这道题：describe 4067 字，
 * question 699 字）。用错的话整篇题面会被塞进「## 题目描述」一节里，后面的
 * 输入/输出格式各自又出现一遍，同一段内容在文件里存两份。
 *
 * 比赛题的页面上不一定有 `subject-question`，所以退一步用 `subject-describe`
 * **截到第一个 `<h2>` 为止**——那个 h2 就是「输入描述:」，正是描述的结束处。
 */
function extractDescription(html) {
  const question = sliceClass(html, 'subject-question');
  if (question) return htmlToMarkdown(question).trim();

  const describe = sliceClass(html, 'subject-describe');
  if (!describe) return '';
  const cut = describe.search(/<h2[^>]*>/i);
  return htmlToMarkdown(cut < 0 ? describe : describe.slice(0, cut)).trim();
}

/**
 * 取某个 `<h2>小节名:</h2>` 之后、下一个 `<h2>` 或 `<div class="question-oi">` 之前的内容。
 *
 * 牛客的这几个小标题**没有类名**，只有内联 style，所以只能按标题文本定位。
 * 结束位置同时认 `<h2>` 和样例块的开头：末尾那一节（输出描述）后面紧跟的是样例块，
 * 不把它算作边界的话，整个样例区会被当成输出描述的正文抄进来。
 */
function sectionAfterHeading(html, name) {
  const pattern = new RegExp(`<h2[^>]*>\\s*${name}\\s*[：:]?\\s*</h2>`, 'i');
  const m = pattern.exec(html);
  if (!m) return '';
  const rest = html.slice(m.index + m[0].length);
  const end = rest.search(/<h2[^>]*>|<div[^>]*class=["'][^"']*\bquestion-oi\b/i);
  return htmlToMarkdown(end < 0 ? rest : rest.slice(0, end)).trim();
}

/**
 * 样例：每个 `question-oi-mod` 里有一个 `<h2>输入|输出|说明</h2>` 和对应内容。
 *
 * 输入输出取隐藏 textarea 的原文（见文件头）。一道题可能有多组样例
 * （示例1、示例2…），每组一个 `question-oi` 块。
 */
function extractNowcoderSamples(html) {
  const samples = [];
  for (const block of matchBlocks(html, 'question-oi')) {
    const input = clipboardText(block, 'input');
    const output = clipboardText(block, 'output');
    if (input === null) continue;
    samples.push({ input: endsWithNewline(input), output: endsWithNewline(output ?? '') });
  }
  return samples;
}

/**
 * 取 `<textarea data-clipboard-text-id="input1">` 的内容。
 *
 * 编号跟着示例走（input1 / input2…），所以按前缀匹配而不是写死 input1。
 * 内容是**转义过的**（textarea 里 `<` 必须写成 `&lt;`），要解码。
 */
function clipboardText(block, kind) {
  const m = new RegExp(`<textarea[^>]*data-clipboard-text-id=["']${kind}\\d*["'][^>]*>([\\s\\S]*?)</textarea>`, 'i').exec(block);
  if (!m) return null;
  return decodeEntities(m[1] ?? '').replace(/\r\n?/g, '\n').trimEnd();
}

/** 样例块里的「说明」小节，每组样例可能各有一段。 */
function extractNotes(html) {
  const notes = [];
  for (const block of matchBlocks(html, 'question-oi')) {
    const m = /<h2[^>]*>\s*说明\s*<\/h2>([\s\S]*?)(?=<div[^>]*class=["'][^"']*\bquestion-oi-mod\b|$)/i.exec(block);
    notes.push(m ? htmlToMarkdown(m[1] ?? '').trim() : '');
  }
  return notes.filter(Boolean);
}

/**
 * 取出所有 class **恰好含有** `name` 这个词元的块（按标签配对）。
 *
 * `sliceClass` 只给第一个，而样例是多组的。
 *
 * **词元要精确比，不能用 `\b`。** 牛客这套类名是 `question-oi`、`question-oi-hd`、
 * `question-oi-mod`、`question-oi-cont` 一家子，而 `\bquestion-oi\b` 对
 * `question-oi-hd` 同样成立（`i` 与 `-` 之间就是一个词边界）。用 `\b` 的话一组样例
 * 会被取成四五块互相嵌套的东西，样例数量直接翻几倍。所以这里把 class 属性整个取出来，
 * 按空白切成词元再比对。
 */
function matchBlocks(html, name) {
  const blocks = [];
  const opener = /<([a-z][a-z0-9]*)\b[^>]*\bclass=["']([^"']*)["']/gi;
  for (const m of html.matchAll(opener)) {
    const tag = (m[1] ?? '').toLowerCase();
    if (!tag) continue;
    if (!(m[2] ?? '').split(/\s+/).includes(name)) continue;
    const block = balancedSlice(html, m.index ?? 0, tag);
    if (block) blocks.push(block);
  }
  return blocks;
}

/** 与 html.js 的 balancedFrom 同一套配对计数，但标签名由调用方给定。 */
function balancedSlice(html, start, tag) {
  const pattern = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, 'gi');
  pattern.lastIndex = start;
  let depth = 0;
  for (let m = pattern.exec(html); m; m = pattern.exec(html)) {
    if (m[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return html.slice(start, m.index + m[0].length);
    } else if (!m[0].endsWith('/>')) {
      depth += 1;
    }
  }
  return null;
}
