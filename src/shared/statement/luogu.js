/**
 * 洛谷题面。
 *
 * 四家里唯一**一个字符都不用解析**的：洛谷的接口直接返回 Markdown + LaTeX，
 * 样例是结构化数组。所以这里只是把几段拼起来，保真度最高。
 *
 * 取数用请求头 `x-lentille-request: content-only`——**不是** `?_contentOnly=1`，
 * 那个参数已经失效，用它会拿回一整页 HTML，然后在 JSON.parse 那里炸成
 * 一句 `Unexpected token '<'`。这坑今天刚踩过。
 */

import { StatementError, endsWithNewline, sampleSections, withFrontMatter } from './common.js';

export function parseLuogu(body, pid, url) {
  const p = body?.data?.problem ?? body?.currentData?.problem ?? body?.problem;
  const content = p?.content ?? p?.contenu;
  if (!p || !content) throw new StatementError(502, '洛谷返回的结构里没有题面内容');

  const title = content.name ?? pid;
  const samples = (p.samples ?? [])
    .filter((s) => Array.isArray(s) && s.length >= 2)
    .map(([input, output]) => ({ input: endsWithNewline(input), output: endsWithNewline(output) }));

  const parts = [`# ${title}`, ''];
  const section = (heading, text) => {
    const trimmed = (text ?? '').trim();
    if (trimmed) parts.push(`## ${heading}`, '', trimmed, '');
  };
  section('题目背景', content.background);
  section('题目描述', content.description);
  section('输入格式', content.formatI);
  section('输出格式', content.formatO);
  parts.push(...sampleSections(samples));
  section('提示', content.hint);

  const limits = {
    timeLimitMs: maxOf(p.limits?.time),
    // 洛谷的内存限制单位是 KB
    memoryLimitMb: p.limits?.memory?.length ? Math.round((maxOf(p.limits.memory) ?? 0) / 1024) : null,
  };

  return {
    platform: 'luogu',
    problemKey: pid,
    title,
    url,
    markdown: withFrontMatter(parts.join('\n'), 'luogu', pid, title, url, limits),
    samples,
    ...limits,
  };
}

function maxOf(values) {
  if (!values || values.length === 0) return null;
  return Math.max(...values);
}
