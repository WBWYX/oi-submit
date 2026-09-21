import { identifyUrl } from '../statement/index.js';
import { absolutizeMarkdownLinks, createEditorialClient, editorialUrl } from './common.js';
import { luoguProblemKey, listLuoguEditorials, fetchLuoguEditorial } from './luogu.js';
import { listCodeforcesEditorials, fetchCodeforcesEditorial } from './codeforces.js';
import { listAtCoderEditorials, fetchAtCoderEditorial } from './atcoder.js';
import { listNowcoderEditorials, fetchNowcoderEditorial } from './nowcoder.js';

const ADAPTERS = {
  luogu: { list: listLuoguEditorials, fetch: fetchLuoguEditorial, host: 'www.luogu.com.cn', path: /^\/article\/[\w-]+\/?$/ },
  codeforces: { list: listCodeforcesEditorials, fetch: fetchCodeforcesEditorial, host: 'codeforces.com', path: /^\/blog\/entry\/\d+\/?$/ },
  atcoder: { list: listAtCoderEditorials, fetch: fetchAtCoderEditorial, host: 'atcoder.jp', path: /^\/contests\/[\w-]+\/editorial\/\d+\/?$/ },
  nowcoder: { list: listNowcoderEditorials, fetch: fetchNowcoderEditorial, host: 'blog.nowcoder.net', path: /^\/n\/[\w-]+\/?$/ },
};

function sourceOf(value) {
  const adapter = Object.hasOwn(ADAPTERS, value?.platform ?? '') ? ADAPTERS[value.platform] : null;
  if (!adapter || typeof value.problemKey !== 'string' || !value.problemKey ||
      typeof value.title !== 'string' || !value.title.trim() || typeof value.url !== 'string') {
    throw new Error('题解信息不完整，请重新获取题解列表');
  }
  const url = new URL(editorialUrl(value.url));
  if (url.hostname !== adapter.host || !adapter.path.test(url.pathname)) {
    throw new Error('题解链接与平台不匹配，请重新获取题解列表');
  }
  return {
    platform: value.platform, problemKey: value.problemKey,
    title: value.title.trim(), url: url.href,
    ...(typeof value.author === 'string' && value.author ? { author: value.author } : {}),
    ...(typeof value.language === 'string' && value.language ? { language: value.language } : {}),
  };
}

/** 只抓列表，用户选定后才下载正文，避免一次打开就抓几十篇题解。 */
export async function listEditorials(rawUrl, fetchFn = fetch) {
  const url = new URL(editorialUrl(rawUrl));
  if (url.hostname === 'luogu.com.cn') url.hostname = 'www.luogu.com.cn';
  if (url.hostname === 'www.codeforces.com') url.hostname = 'codeforces.com';
  const id = url.hostname === 'www.luogu.com.cn'
    ? { platform: 'luogu', problemKey: luoguProblemKey(url.href) }
    : identifyUrl(url.href);
  if (!id || !Object.hasOwn(ADAPTERS, id.platform)) {
    throw new Error('目前支持洛谷、Codeforces、牛客和 AtCoder 的题目页链接');
  }
  const entries = await ADAPTERS[id.platform].list(url.href, createEditorialClient(fetchFn));
  const seen = new Set();
  return entries.map(sourceOf).filter((source) => {
    if (source.platform !== id.platform || source.problemKey !== id.problemKey) {
      throw new Error('平台返回了其他题目的题解，请检查题目链接');
    }
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  }).slice(0, 20);
}

export async function fetchEditorial(value, fetchFn = fetch) {
  const selected = sourceOf(value);
  const fetched = await ADAPTERS[selected.platform].fetch(selected, createEditorialClient(fetchFn));
  const source = sourceOf({ ...selected,
    title: typeof fetched.title === 'string' && fetched.title.trim() ? fetched.title : selected.title,
    author: typeof fetched.author === 'string' && fetched.author ? fetched.author : selected.author,
    language: typeof fetched.language === 'string' && fetched.language ? fetched.language : selected.language,
  });
  if (typeof fetched.markdown !== 'string' || !fetched.markdown.trim()) {
    throw new Error('页面中没有可读取的题解正文，未保存文件');
  }
  const metadata = [
    '---', 'kind: editorial', `platform: ${JSON.stringify(source.platform)}`,
    `problem: ${JSON.stringify(source.problemKey)}`, `title: ${JSON.stringify(source.title)}`,
    `source: ${JSON.stringify(source.url)}`,
    ...(source.author ? [`author: ${JSON.stringify(source.author)}`] : []),
    ...(source.language ? [`language: ${JSON.stringify(source.language)}`] : []),
    `fetched: ${new Date().toISOString()}`, '---', '',
  ].join('\n');
  const body = source.platform === 'luogu' ? absolutizeMarkdownLinks(fetched.markdown, source.url) : fetched.markdown;
  const markdown = `${metadata}${body.trim()}\n`;
  // 按实际 JSON 帧的字节数留足余量，避免 engine.io 丢弃超过 1 MB 的回包。
  if (new TextEncoder().encode(JSON.stringify({ ...source, markdown })).length > 800 * 1024) {
    throw new Error('题解内容超过 800 KB 的回传上限，未截断；请在浏览器阅读原文');
  }
  return { ...source, markdown };
}
