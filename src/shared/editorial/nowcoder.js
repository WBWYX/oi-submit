import { balancedFrom, decodeEntities, sliceClass, stripTags } from '../statement/html.js';
import { editorialHtmlToMarkdown } from './common.js';

const ORIGIN = 'https://ac.nowcoder.com';
const BLOG_ORIGIN = 'https://blog.nowcoder.net';

function pageInfo(html) {
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const match = /\bwindow\.pageInfo\s*=\s*\{([\s\S]*?)\}\s*;/.exec(script[1]);
    if (match) return match[1];
  }
  return '';
}

function requireReadablePage(html) {
  if (/<title\b[^>]*>[^<]*(?:登录|安全验证|访问受限)[^<]*<\/title>/i.test(html)) {
    throw new Error('牛客要求登录或完成验证，请先在浏览器中打开该页面后重试。');
  }
}

const textOf = (html) => decodeEntities(stripTags(html ?? '')).trim();

export async function listNowcoderEditorials(problemUrl, client) {
  const url = new URL(problemUrl);
  const bank = /^\/acm\/problem\/(\d+)\/?$/.exec(url.pathname);
  const contest = /^\/acm\/contest\/(\d+)\/([A-Za-z0-9]+)\/?$/.exec(url.pathname);
  if (url.hostname !== 'ac.nowcoder.com' || !['http:', 'https:'].includes(url.protocol) || (!bank && !contest)) {
    throw new Error('请提供牛客题库或比赛中的具体题目链接。');
  }

  const problemKey = bank ? bank[1] : `${contest[1]}-${contest[2].toUpperCase()}`;
  let pid = bank?.[1];
  if (contest) {
    const html = await client.getHtml(`${ORIGIN}${url.pathname}`);
    requireReadablePage(html);
    // questionId 是另一套内部编号；/problem/blogs/ 必须用 pageInfo.problemId。
    const info = pageInfo(html);
    pid = /\bproblemId\s*:\s*['"]?(\d+)['"]?\s*(?:,|$)/.exec(info)?.[1];
    if (!pid) throw new Error('牛客比赛页未提供题库 problemId，可能尚未公开，或页面结构已变化。');
  }

  const html = await client.getHtml(`${ORIGIN}/acm/problem/blogs/${pid}`);
  requireReadablePage(html);
  const list = sliceClass(html, 'js-blog-list');
  if (list === null) throw new Error('牛客题解列表结构变化，未找到当前题目的解析列表。');
  const title = textOf(sliceClass(html, 'js-question-title')) || `NC${pid}`;
  const sources = [];
  const seen = new Set();
  for (const match of list.matchAll(/<div\b[^>]*\bclass=(['"])([^'"]*)\1[^>]*>/gi)) {
    if (!match[2].split(/\s+/).includes('js-blog-item')) continue;
    const uuid = /\bdata-uuid=['"]([a-fA-F0-9]{32})['"]/.exec(match[0])?.[1];
    if (!uuid || seen.has(uuid)) continue;
    const item = balancedFrom(list, match.index);
    if (!item) continue;
    seen.add(uuid);
    const author = textOf(sliceClass(item, 'name'));
    sources.push({
      platform: 'nowcoder',
      problemKey,
      title: `${title}（${author || `题解 ${sources.length + 1}`}）`,
      url: `${BLOG_ORIGIN}/n/${uuid}`,
      ...(author ? { author } : {}),
    });
    if (sources.length === 20) break;
  }
  if (sources.length === 0) {
    if (/暂无题解|\bblank-box\b/.test(list)) throw new Error(`牛客题目 ${problemKey} 暂无可用题解。`);
    throw new Error('牛客题解列表结构变化，未找到有效的文章链接。');
  }
  return sources;
}

export async function fetchNowcoderEditorial(source, client) {
  const url = new URL(source.url);
  if (source.platform !== 'nowcoder' || url.origin !== BLOG_ORIGIN || !/^\/n\/[a-fA-F0-9]{32}\/?$/.test(url.pathname)) {
    throw new Error('牛客题解来源无效，请重新从当前题目的题解列表选择。');
  }
  const html = await client.getHtml(`${BLOG_ORIGIN}${url.pathname}`);
  requireReadablePage(html);
  const info = pageInfo(html);
  if (/\bhasViewAllRight\s*:\s*false\b|\bisTryRead\s*:\s*true\b/.test(info)) {
    throw new Error('当前账号没有这篇牛客题解的全文阅读权限，不能把试读内容当作完整题解。');
  }
  // 正文来自官方博客文章，而非题解列表里的截断摘要。
  const content = sliceClass(html, 'nc-markdown-body');
  if (content === null) throw new Error('牛客题解正文结构变化，未找到文章内容。');
  const markdown = editorialHtmlToMarkdown(content, source.url);
  if (!markdown.trim()) throw new Error('牛客题解正文为空，没有保存空文件。');
  const title = textOf(sliceClass(html, 'title-item'));
  return { ...source, ...(title ? { title } : {}), markdown };
}
