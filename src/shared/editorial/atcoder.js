import { balancedFrom, decodeEntities, sliceClass, sliceId, stripTags } from '../statement/html.js';
import { editorialHtmlToMarkdown } from './common.js';

const ORIGIN = 'https://atcoder.jp';

function text(html) {
  return decodeEntities(stripTags(html)).replace(/\s+/g, ' ').trim();
}

function validUrl(url) {
  return url.hostname === 'atcoder.jp' && /^https?:$/.test(url.protocol) && !url.username && !url.password && !url.port;
}

function links(html) {
  return [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)]
    .flatMap((match) => {
      try { return [{ url: new URL(decodeEntities(match[2]), ORIGIN), title: text(match[3]) }]; }
      catch { return []; }
    });
}

/** 题目专属索引的首个 editorial-section；后面的 Overall Editorial 不混入单题列表。 */
export async function listAtCoderEditorials(problemUrl, client) {
  const url = new URL(problemUrl);
  const match = /^\/contests\/([\w-]+)\/tasks\/(\w+)\/?$/.exec(url.pathname);
  if (!validUrl(url) || !match) throw new Error('请提供 AtCoder 题目链接');
  const taskPath = `/contests/${match[1]}/tasks/${match[2]}`;
  const html = await client.getHtml(`${ORIGIN}${taskPath}/editorial?lang=en`);
  const main = sliceId(html, 'main-container') ?? html;
  const heading = sliceClass(main, 'h2');
  const task = heading && links(heading).find((link) => link.url.origin === ORIGIN && link.url.pathname === taskPath);
  const area = heading && sliceClass(main.slice(main.indexOf(heading) + heading.length), 'editorial-section');
  if (!task || !area) {
    throw new Error('AtCoder 未返回该题的题解索引，请确认登录与题目权限，或页面结构已变化');
  }

  const results = new Map();
  for (const item of area.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)) {
    const anchors = links(item[0]);
    const entry = anchors.find((link) => link.url.origin === ORIGIN &&
      new RegExp(`^/contests/${match[1]}/editorial/\\d+/?$`).test(link.url.pathname));
    if (!entry) continue; // 外部视频/博客不当作本站可抓取的正文。
    const author = anchors.find((link) => link.url.origin === ORIGIN && /^\/users\/[^/]+$/.test(link.url.pathname))?.title;
    const otherLanguage = /\blang-other\b/.test(item[0].slice(0, item[0].indexOf('>')));
    const language = /[ぁ-んァ-ヶ]|解説|日本語/.test(entry.title) ? 'ja' : !otherLanguage ? 'en' : undefined;
    const official = /class=["'][^"']*\blabel\b[^"']*["'][^>]*>\s*(?:Official|公式)/i.test(item[0]);
    const canonical = `${ORIGIN}${entry.url.pathname.replace(/\/$/, '')}`;
    results.set(canonical, {
      platform: 'atcoder', problemKey: match[2],
      title: `${task.title} — ${official ? '官方 ' : ''}${entry.title}`,
      url: canonical, ...(author ? { author } : {}), ...(language ? { language } : {}),
    });
  }
  if (results.size === 0) throw new Error('AtCoder 该题尚未发布可抓取的站内文字题解（外部视频与整场解说不包含在内）');
  return [...results.values()].sort((a, b) => Number(b.language === 'en') - Number(a.language === 'en')).slice(0, 20);
}

/** 已核实的文章结构为题目 h2、分隔线、正文 div；不把导航或页脚当正文。 */
export async function fetchAtCoderEditorial(source, client) {
  const url = new URL(source.url);
  const match = /^\/contests\/([\w-]+)\/editorial\/(\d+)\/?$/.exec(url.pathname);
  if (!validUrl(url) || !match) throw new Error('AtCoder 题解链接无效');
  const canonical = `${ORIGIN}/contests/${match[1]}/editorial/${match[2]}`;
  const html = await client.getHtml(`${canonical}?lang=en`);
  const main = sliceId(html, 'main-container') ?? html;
  const headingStart = main.search(/<h2\b/i);
  const heading = headingStart < 0 ? null : balancedFrom(main, headingStart);
  const task = heading && links(heading).find((link) => link.url.origin === ORIGIN &&
    link.url.pathname === `/contests/${match[1]}/tasks/${source.problemKey}`);
  if (!heading || !task) throw new Error('AtCoder 题解未发布、无权访问或与所选题目不匹配');
  const afterHeading = main.slice(headingStart + heading.length);
  const separator = /^\s*<hr\b[^>]*>\s*(?=<div\b)/i.exec(afterHeading);
  const body = separator && balancedFrom(afterHeading, separator[0].length);
  if (!body || /^<div\b[^>]*class=["'][^"']*\bclearfix\b/i.test(body)) {
    throw new Error('AtCoder 题解正文区块缺失，页面结构可能已变化');
  }
  const markdown = editorialHtmlToMarkdown(body, canonical);
  if (!markdown.trim()) throw new Error('AtCoder 题解正文为空，可能尚未发布或需要登录');
  const author = links(heading).find((link) => link.url.origin === ORIGIN && /^\/users\/[^/]+$/.test(link.url.pathname))?.title;
  return { ...source, url: canonical, ...(author ? { author } : {}), markdown };
}
