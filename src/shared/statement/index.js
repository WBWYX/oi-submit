/**
 * 按题目链接抓题面，转成 Markdown。
 *
 * ## 为什么搬到浏览器里
 *
 * 这套代码原先在 icpc-workbench 的服务端。那边为了**让服务器冒充浏览器**，
 * 背了三样东西：
 *
 *   · 平台登录 Cookie 要在应用里单独配（洛谷有些题不登录看不到）；
 *   · 洛谷的 C3VK 挑战要自己重试；
 *   · Codeforces 在 Cloudflare 后面按 **TLS 指纹**拦截，Node 的握手根本过不去，
 *     只能在 403 时回退到起一个系统 curl 子进程。
 *
 * 搬进扩展之后这三样**同时消失**：这里本来就是浏览器，带着你已登录的会话，
 * TLS 指纹就是真的。代价是抓题面从此依赖「浏览器开着且扩展启用」。
 *
 * 解析全程只用正则和字符串，所以能直接跑在 MV3 的 service worker 里
 * （那里没有 DOMParser）。
 */

import { StatementError, assertNotTooLarge } from './common.js';
import { parseLuogu } from './luogu.js';
import { parseCodeforces } from './codeforces.js';
import { parseAtCoder } from './atcoder.js';
import { parseTimus } from './timus.js';

/**
 * 认出链接属于哪道题。认不出返回 null——**绝不猜**：猜错的后果是抓回一份
 * 别的题的题面覆盖掉你的笔记。
 */
export function identifyUrl(raw) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();

  if (host === 'www.luogu.com.cn' || host === 'luogu.com.cn') {
    const m = /\/problem\/([A-Za-z]*\d+[A-Za-z0-9_]*)/.exec(url.pathname);
    return m?.[1] ? { platform: 'luogu', problemKey: m[1].toUpperCase() } : null;
  }
  if (host.endsWith('codeforces.com')) {
    const contest = /\/(?:contest|gym)\/(\d+)\/problem\/(\w+)/.exec(url.pathname);
    if (contest) return { platform: 'codeforces', problemKey: `${contest[1]}${contest[2].toUpperCase()}` };
    const set = /\/problemset\/problem\/(\d+)\/(\w+)/.exec(url.pathname);
    if (set) return { platform: 'codeforces', problemKey: `${set[1]}${set[2].toUpperCase()}` };
    return null;
  }
  if (host === 'atcoder.jp') {
    const m = /\/contests\/[\w-]+\/tasks\/(\w+)/.exec(url.pathname);
    return m?.[1] ? { platform: 'atcoder', problemKey: m[1] } : null;
  }
  if (host === 'acm.timus.ru') {
    const m = /[?&]num=(\d+)/.exec(url.search);
    return m?.[1] ? { platform: 'timus', problemKey: m[1] } : null;
  }
  return null;
}

const SUPPORTED = '洛谷、Codeforces、AtCoder、Timus';

export async function fetchStatement(rawUrl) {
  const id = identifyUrl(rawUrl);
  if (!id) {
    throw new StatementError(
      400,
      `认不出这个链接属于哪道题：${rawUrl}\n目前支持 ${SUPPORTED} 的题目页链接。`,
    );
  }
  switch (id.platform) {
    case 'luogu':
      return assertSize(await fetchLuogu(id.problemKey, rawUrl));
    case 'codeforces':
      return assertSize(parseCodeforces(await getHtml(rawUrl), id.problemKey, rawUrl));
    case 'atcoder':
      return assertSize(parseAtCoder(await getHtml(rawUrl), id.problemKey, rawUrl));
    default:
      return assertSize(
        parseTimus(
          await getHtml(`https://acm.timus.ru/problem.aspx?space=1&num=${id.problemKey}`),
          id.problemKey,
          rawUrl,
        ),
      );
  }
}

function assertSize(statement) {
  assertNotTooLarge(statement.markdown, statement.platform);
  return statement;
}

/**
 * 洛谷走它自己的 JSON 接口。
 *
 * 靠请求头 `x-lentille-request: content-only`，**不是** `?_contentOnly=1`——
 * 那个参数已失效，用它会拿回一整页 HTML。
 */
async function fetchLuogu(pid, url) {
  const target = `https://www.luogu.com.cn/problem/${pid}`;
  const res = await request(target, {
    'x-lentille-request': 'content-only',
    Accept: 'application/json',
    Referer: target,
  });
  if (res.status === 404) throw new StatementError(404, `洛谷没有题目 ${pid}`);
  /*
   * 302 在这里只有一个意思：这道题要登录才看得到，而浏览器当前没登录。
   * （fetch 默认会跟随跳转，所以真正会看到的是登录页；下面按内容类型再兜一层。）
   */
  if ([301, 302, 303].includes(res.status)) {
    throw new StatementError(403, `洛谷要求登录才能看 ${pid}。请先在浏览器里登录洛谷，再试一次。`);
  }
  if (!res.ok) throw new StatementError(502, `洛谷返回 HTTP ${res.status}`);

  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    throw new StatementError(
      403,
      `洛谷返回的不是 JSON 而是 ${type.split(';')[0] || '未知类型'}——多半是没登录，或者触发了风控。`,
    );
  }
  return parseLuogu(await res.json(), pid, url);
}

async function getHtml(url) {
  const res = await request(url, { Accept: 'text/html,application/xhtml+xml' });
  if (res.status === 404) throw new StatementError(404, `页面不存在：${url}`);
  if (res.status === 403) {
    throw new StatementError(403, `目标站点拒绝访问（403）。若是需要登录的题目，请先在浏览器里登录。`);
  }
  if (!res.ok) throw new StatementError(502, `目标站点返回 HTTP ${res.status}`);
  return res.text();
}

/**
 * 发请求。
 *
 * `credentials: 'include'` 是关键：带上浏览器里已有的会话，需要登录的题目才看得到。
 * 扩展要能带 Cookie 访问这些站，manifest 的 host_permissions 必须包含它们。
 */
function request(url, headers) {
  return fetch(url, {
    credentials: 'include',
    headers,
    signal: AbortSignal.timeout(20000),
  });
}
