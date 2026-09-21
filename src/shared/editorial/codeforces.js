import { balancedFrom, decodeEntities, sliceClass, stripTags } from '../statement/html.js';
import { editorialHtmlToMarkdown } from './common.js';

const ORIGIN = 'https://codeforces.com';
const HOST = /^(?:www\.|m[123]\.)?codeforces\.com$/;

function text(html) {
  return decodeEntities(stripTags(html)).replace(/\s+/g, ' ').trim();
}

function attribute(tag, name) {
  return new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)?.[2] ?? '';
}

function validUrl(url) {
  return HOST.test(url.hostname) && /^https?:$/.test(url.protocol) && !url.username && !url.password && !url.port;
}

function problemLocation(raw) {
  const url = new URL(raw);
  const match = /^\/(?:contest|gym)\/(\d+)\/problem\/([a-z]\d*)\/?$/i.exec(url.pathname)
    ?? /^\/problemset\/problem\/(\d+)\/([a-z]\d*)\/?$/i.exec(url.pathname);
  if (!validUrl(url) || !match) throw new Error('请提供 Codeforces 题目链接');
  return { url: `${ORIGIN}${url.pathname}?locale=en`, key: `${match[1]}${match[2].toUpperCase()}` };
}

/** 只使用题目页的 Contest materials，忽略侧栏热门博客和公告链接。 */
export async function listCodeforcesEditorials(problemUrl, client) {
  const problem = problemLocation(problemUrl);
  const html = await client.getHtml(problem.url);
  const results = new Map();
  let foundMaterials = false;
  for (const opening of html.matchAll(/<div\b[^>]*>/gi)) {
    if (!attribute(opening[0], 'class').split(/\s+/).includes('sidebox')) continue;
    const block = balancedFrom(html, opening.index);
    if (!block || !/Contest\s+materials/i.test(text(sliceClass(block, 'caption') ?? ''))) continue;
    foundMaterials = true;
    for (const anchor of block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const label = text(anchor[2]);
      if (!/tutorial|editorial/i.test(label)) continue;
      let url;
      try { url = new URL(decodeEntities(attribute(anchor[1], 'href')), ORIGIN); } catch { continue; }
      const entry = /^\/blog\/entry\/(\d+)\/?$/.exec(url.pathname);
      if (!validUrl(url) || !entry) continue;
      const canonical = `${ORIGIN}/blog/entry/${entry[1]}`;
      const language = /\((en|ru)\)/i.exec(label)?.[1]?.toLowerCase();
      results.set(canonical, {
        platform: 'codeforces', problemKey: problem.key,
        title: `${text(attribute(anchor[1], 'title')) || label}（整场教程）`,
        url: canonical, ...(language ? { language } : {}),
      });
      if (results.size >= 20) break;
    }
    if (results.size >= 20) break;
  }
  if (results.size === 0) {
    if (!foundMaterials && !sliceClass(html, 'problem-statement')) {
      throw new Error('Codeforces 题目页不可访问：请确认登录与权限，或页面结构已变化');
    }
    throw new Error('该题所属比赛尚未提供可读取的 Tutorial/Editorial 链接');
  }
  return [...results.values()];
}

function tutorialEndpoint(html, baseUrl) {
  // 只读取官方页面脚本里的字面量 URL，不执行脚本，也不猜内部接口路径。
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const match = /\bCodeforces\.setupTutorials\s*\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/.exec(script[1]);
    if (!match) continue;
    const literal = match[2].replace(/\\([/"'\\])/g, '$1');
    if (literal.includes('\\')) continue;
    let url;
    try { url = new URL(decodeEntities(literal), baseUrl); } catch { continue; }
    if (url.origin === new URL(baseUrl).origin && !url.username && !url.password && !url.hash) return url.href;
  }
  throw new Error('Codeforces 题解需要动态加载，但页面未提供可识别的同源读取接口；请打开原文查看');
}

function csrfToken(html) {
  // 与 Codeforces.getCsrfToken 一致：优先使用 meta，再回退到 span。
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (attribute(tag, 'name') !== 'X-Csrf-Token') continue;
    const token = decodeEntities(attribute(tag, 'content'));
    if (token.length === 32) return token;
  }
  for (const [tag] of html.matchAll(/<span\b[^>]*>/gi)) {
    if (!attribute(tag, 'class').split(/\s+/).includes('csrf-token')) continue;
    const token = decodeEntities(attribute(tag, 'data-csrf'));
    if (token.length === 32) return token;
  }
  throw new Error('Codeforces 动态题解页面缺少有效的 CSRF 标记，请在浏览器重新登录或刷新原文后重试');
}

async function expandTutorials(content, source, client) {
  const placeholders = [];
  for (const opening of content.matchAll(/<div\b[^>]*>/gi)) {
    if (!attribute(opening[0], 'class').split(/\s+/).includes('problemTutorial')) continue;
    const block = balancedFrom(content, opening.index);
    const problemCode = attribute(opening[0], 'problemCode');
    if (!block || !/^\d+[a-z]\d*$/i.test(problemCode)) {
      throw new Error('Codeforces 动态题解的题号或区块结构已变化，请打开原文查看');
    }
    placeholders.push({ block, problemCode });
  }
  if (placeholders.length === 0) return content;
  if (placeholders.length > 50) throw new Error('Codeforces 动态题解章节过多，请打开原文查看');

  let html;
  try { html = await client.getHtml(source.url); }
  catch (error) {
    throw new Error(`Codeforces 动态题解页面不可访问，请打开原文确认：${source.url}。${error?.message ?? error}`);
  }
  const endpoint = tutorialEndpoint(html, source.url);
  const csrf = csrfToken(html);
  const loaded = new Map();
  const problemCodes = [...new Set(placeholders.map(({ problemCode }) => problemCode))];
  let next = 0;
  let failed = false;
  async function loadNext() {
    while (!failed && next < problemCodes.length) {
      const problemCode = problemCodes[next++];
      try {
        const url = new URL(endpoint);
        url.searchParams.set('rv', Math.random().toString(36).slice(2, 11));
        // 页面全局 ajaxPrefilter/ajaxSetup 会同时发送表单字段和请求头。
        const result = await client.postForm(url.href, { problemCode, csrf_token: csrf }, { 'X-Csrf-Token': csrf });
        // public=false 但 success=true 表示当前登录用户有权看到未公开内容。
        if (![true, 'true'].includes(result?.success) || typeof result?.html !== 'string' || !result.html.trim()) {
          throw new Error(`Codeforces ${problemCode} 的题解尚未发布或当前账号无权访问，请打开原文确认`);
        }
        if (/Tutorial is loading/i.test(result.html)) {
          throw new Error(`Codeforces ${problemCode} 的动态题解仍未加载完成，请稍后重试或打开原文`);
        }
        loaded.set(problemCode, result.html);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, problemCodes.length) }, loadNext));
  // 网络返回可以乱序；正文仍按原始章节顺序替换。
  for (const { block, problemCode } of placeholders) {
    content = content.replace(block, () => loaded.get(problemCode));
  }
  return content;
}

/** blogEntry.view 是官方公开 API；正文仍只来自列表中已确认的材料链接。 */
export async function fetchCodeforcesEditorial(source, client) {
  const url = new URL(source.url);
  const match = /^\/blog\/entry\/(\d+)\/?$/.exec(url.pathname);
  if (!validUrl(url) || !match) throw new Error('Codeforces 题解链接无效');
  const canonical = `${ORIGIN}/blog/entry/${match[1]}`;
  const payload = await client.getJson(`${ORIGIN}/api/blogEntry.view?blogEntryId=${match[1]}`);
  if (payload?.status !== 'OK') {
    throw new Error(`Codeforces 题解未发布或不可访问：${typeof payload?.comment === 'string' ? payload.comment : '接口未返回成功状态'}`);
  }
  const entry = payload.result;
  if (String(entry?.id) !== match[1] || typeof entry?.content !== 'string' || !entry.content.trim()) {
    throw new Error('Codeforces 题解正文缺失或响应不匹配，接口结构可能已变化');
  }
  const content = await expandTutorials(entry.content, { ...source, url: canonical }, client);
  const markdown = editorialHtmlToMarkdown(content, canonical);
  if (!markdown.trim() || /Tutorial is loading/i.test(markdown)) {
    throw new Error('Codeforces 未返回完整题解正文，请打开原文查看');
  }
  const title = typeof entry.title === 'string' ? text(entry.title) : '';
  const author = typeof entry.authorHandle === 'string' ? entry.authorHandle : source.author;
  const language = typeof entry.locale === 'string' ? entry.locale : source.language;
  return {
    ...source, url: canonical,
    title: title ? `${title}（整场教程）` : source.title,
    ...(author ? { author } : {}), ...(language ? { language } : {}),
    markdown: `> 本文为该场比赛的整篇教程，可能包含其他题目的解答。\n\n${markdown}`,
  };
}
