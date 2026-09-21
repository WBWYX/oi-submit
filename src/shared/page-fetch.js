const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const MAX_RESULT_BYTES = 6 * 1024 * 1024;
const REQUEST_HEADERS = new Set(['accept', 'accept-language', 'x-lentille-request']);
const RESPONSE_HEADERS = ['content-type', 'retry-after', 'location', 'cf-mitigated'];
const POSITIVE = /^[1-9]\d*$/;
const LANG = /^(?:en|ja|ru)$/;

// 只列出四个平台现有读取客户端用到的入口；新增平台读取方法时显式补充。
const SITES = {
  'www.luogu.com.cn': 'luogu',
  'codeforces.com': 'codeforces',
  'www.codeforces.com': 'codeforces',
  'atcoder.jp': 'atcoder',
  'ac.nowcoder.com': 'nowcoder',
  'www.nowcoder.com': 'nowcoder',
  'blog.nowcoder.net': 'nowcoder',
};

function queryRules(url) {
  const path = url.pathname;
  switch (url.hostname) {
    case 'www.luogu.com.cn':
      if (path === '/contest/list') return { _contentOnly: /^1$/, page: POSITIVE };
      if (/^\/problem\/[A-Za-z0-9_]{1,64}\/?$/.test(path)) return { _contentOnly: /^1$/, contestId: POSITIVE };
      if (/^\/problem\/solution\/[A-Za-z0-9_]{1,64}\/?$/.test(path)) return { _contentOnly: /^1$/, page: POSITIVE };
      if (/^\/discuss\/[1-9]\d*\/?$/.test(path)) return { _contentOnly: /^1$/, page: POSITIVE };
      if (/^\/(?:contest|record)\/[1-9]\d*\/?$/.test(path)) return { _contentOnly: /^1$/ };
      if (/^\/article\/[A-Za-z0-9]+\/?$/.test(path)) return { _contentOnly: /^1$/ };
      break;
    case 'codeforces.com':
    case 'www.codeforces.com':
      if (path === '/api/contest.list') return { gym: /^(?:true|false)$/ };
      if (path === '/api/blogEntry.view') return { blogEntryId: POSITIVE };
      if (/^\/(?:contest|gym)\/[1-9]\d*(?:\/problem\/[A-Za-z][A-Za-z0-9]{0,7})?\/?$/.test(path) ||
          /^\/problemset\/problem\/[1-9]\d*\/[A-Za-z][A-Za-z0-9]{0,7}\/?$/.test(path) ||
          /^\/blog\/entry\/[1-9]\d*\/?$/.test(path)) return { locale: LANG };
      break;
    case 'atcoder.jp':
      if (/^\/contests\/?$/.test(path)) return {};
      if (/^\/contests\/[a-zA-Z0-9_-]+(?:\/tasks(?:\/[a-zA-Z0-9_-]+(?:\/editorial)?)?|\/editorial(?:\/\d+)?)?\/?$/.test(path)) {
        return { lang: /^(?:en|ja)$/ };
      }
      break;
    case 'ac.nowcoder.com':
      if (path === '/acm/contest/vip-index') return {};
      if (path === '/acm/contest/problem-list') return { id: POSITIVE };
      if (path === '/acm/discuss/blogs/answer/list') return { contestId: POSITIVE, page: POSITIVE };
      if (/^\/acm\/contest\/[1-9]\d*(?:\/[A-Za-z][A-Za-z0-9]{0,7})?\/?$/.test(path) ||
          /^\/acm\/problem\/(?:blogs\/)?[1-9]\d*\/?$/.test(path) ||
          /^\/discuss\/[1-9]\d*\/?$/.test(path) || /^\/acm\/discuss\/[1-9]\d*\/?$/.test(path)) return {};
      break;
    case 'www.nowcoder.com':
      if (path === '/blog/content') return { uuid: /^[a-fA-F0-9]{32}$/ };
      if (/^\/discuss\/[1-9]\d*\/?$/.test(path)) return {};
      break;
    case 'blog.nowcoder.net':
      if (/^\/n\/[a-fA-F0-9]{32}\/?$/.test(path)) return {};
      break;
  }
  return null;
}

export function pageUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 4096) throw new Error('页面读取需要有效的平台 URL');
  let url;
  try { url = new URL(raw); } catch { throw new Error('页面读取 URL 无效'); }
  const rules = queryRules(url);
  if (url.protocol !== 'https:' || !SITES[url.hostname] || url.username || url.password || url.port ||
      url.hash || !rules || /\/(?:submit|logout|signout|delete|edit|update|register|login|enter)(?:\/|$)/i.test(url.pathname)) {
    throw new Error('仅允许读取四个平台已支持的题目、比赛、题解、讨论和记录入口');
  }
  const seen = new Set();
  for (const [name, value] of url.searchParams) {
    if (!Object.hasOwn(rules, name) || !rules[name].test(value) || seen.has(name)) {
      throw new Error('页面读取包含未支持的查询参数');
    }
    seen.add(name);
  }
  return url;
}

function requestHeaders(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('页面请求头必须是字符串映射');
  const result = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (!REQUEST_HEADERS.has(name.toLowerCase())) continue;
    if (typeof value !== 'string' || value.length > 2048) throw new Error('页面请求头格式无效');
    try { result.set(name, value); } catch { throw new Error('页面请求头格式无效'); }
  }
  return result;
}

async function pageBody(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let body = '';
  let bytes = 0;
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        return body + decoder.decode();
      }
      bytes += value.byteLength;
      if (bytes > MAX_PAGE_BYTES) throw new Error('平台页面超过 5 MiB，已停止下载');
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** 登录态只留在浏览器中；每个平台共用一个队列，失败不阻塞后续读取。 */
export function createPageFetcher({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const queues = new Map();
  return async function fetchPage(request) {
    if (!request || Object.hasOwn(request, 'method') || Object.hasOwn(request, 'body')) {
      throw new Error('页面读取只接受 URL 和可选请求头，不能指定方法或请求体');
    }
    const url = pageUrl(request.url);
    const headers = requestHeaders(request.headers);
    const site = SITES[url.hostname];
    let queue = queues.get(site);
    if (!queue) {
      queue = { tail: Promise.resolve(), last: -Infinity, lastApi: -Infinity };
      queues.set(site, queue);
    }
    const execute = async () => {
      const api = site === 'codeforces' && url.pathname.startsWith('/api/');
      const wait = Math.max(queue.last + 1000, api ? queue.lastApi + 2100 : -Infinity) - now();
      if (wait > 0) await sleep(wait);
      queue.last = now();
      if (api) queue.lastApi = queue.last;
      const response = await fetchImpl(url.href, {
        method: 'GET', headers, credentials: 'include', redirect: 'manual', signal: AbortSignal.timeout(20000),
      });
      try {
        if (response.type === 'opaqueredirect') {
          throw new Error('平台页面发生不可读取的重定向，请先在浏览器打开最终原文页面并确认登录状态');
        }
        if (response.status === 0) throw new Error('浏览器无法读取平台响应，请打开原文确认登录与访问权限');
        const finalUrl = pageUrl(response.url || url.href);
        if (SITES[finalUrl.hostname] !== site) throw new Error('平台页面跳转到了其他站点，已拒绝读取');
        const location = response.headers.get('location');
        if (response.status >= 300 && response.status < 400 && location) {
          const target = pageUrl(new URL(location, finalUrl).href);
          if (SITES[target.hostname] !== site) throw new Error('平台页面重定向到了其他站点，已拒绝读取');
        }
        const page = {
          url: finalUrl.href, status: response.status,
          headers: Object.fromEntries(RESPONSE_HEADERS.flatMap((name) => {
            const value = response.headers.get(name);
            return value === null ? [] : [[name, value]];
          })),
          body: await pageBody(response),
        };
        if (new TextEncoder().encode(JSON.stringify(page)).byteLength > MAX_RESULT_BYTES) {
          throw new Error('平台页面序列化后超过 6 MiB，无法回传');
        }
        return page;
      } catch (error) {
        if (!response.body?.locked) await response.body?.cancel().catch(() => {});
        throw error;
      }
    };
    const result = queue.tail.then(execute);
    queue.tail = result.catch(() => {});
    return result;
  };
}
