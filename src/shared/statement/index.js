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
import { parseQoj } from './qoj.js';
import { parseNowcoder } from './nowcoder.js';
import { parseLoj } from './loj.js';

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
  if (host === 'qoj.ac' || host === 'www.qoj.ac') {
    /*
     * 比赛题的链接是 /contest/<cid>/problem/<pid>，而那个 <pid> 就是题库里的题号——
     * 两条路径取到的是同一道题，所以都归一到 /problem/<pid> 去抓。
     */
    const contest = /\/contest\/\d+\/problem\/(\d+)/.exec(url.pathname);
    if (contest?.[1]) return { platform: 'qoj', problemKey: contest[1] };
    const m = /\/problem\/(\d+)/.exec(url.pathname);
    return m?.[1] ? { platform: 'qoj', problemKey: m[1] } : null;
  }
  if (host === 'ac.nowcoder.com') {
    // 题库题：/acm/problem/13885
    const bank = /\/acm\/problem\/(\d+)/.exec(url.pathname);
    if (bank?.[1]) return { platform: 'nowcoder', problemKey: bank[1] };
    /*
     * 比赛题：/acm/contest/<cid>/<index>。题号在页面上才有，链接里没有，
     * 所以 key 用 `<cid>-<index>` 这个能唯一定位、且能反推回链接的形式。
     * 同步适配器用的是页面上的 NC 号，两边对不上——**这是已知的**：
     * 抓题面只需要定位到页面，不需要与提交记录对账。
     */
    const contest = /\/acm\/contest\/(\d+)\/([A-Za-z0-9]+)/.exec(url.pathname);
    if (contest) return { platform: 'nowcoder', problemKey: `${contest[1]}-${contest[2].toUpperCase()}` };
    return null;
  }
  if (host === 'loj.ac' || host === 'www.loj.ac') {
    const m = /\/p\/(\d+)/.exec(url.pathname);
    return m?.[1] ? { platform: 'loj', problemKey: m[1] } : null;
  }
  return null;
}

const SUPPORTED = '洛谷、Codeforces、AtCoder、Timus、QOJ、牛客、LibreOJ';

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
    case 'qoj':
      /*
       * 一律走题库页而不是原链接：比赛题的 /contest/<cid>/problem/<pid> 在比赛
       * 结束前可能看不到题面，而题库页 /problem/<pid> 是同一道题的常驻位置。
       */
      return assertSize(
        parseQoj(await getHtml(`https://qoj.ac/problem/${id.problemKey}`), id.problemKey, rawUrl),
      );
    case 'nowcoder':
      return assertSize(parseNowcoder(await getHtml(rawUrl), id.problemKey, rawUrl));
    case 'loj':
      return assertSize(await fetchLoj(id.problemKey, rawUrl));
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

/**
 * LOJ 走它自己的 JSON 接口，**而且是另一个域名**。
 *
 * `loj.ac/api/...` 只会拿回 SPA 的 HTML 外壳，数据接口在 `api.loj.ac`
 * （前端把它写死在 `window.apiEndpoint` 里）。这一条在 icpc-workbench 的
 * `adapters/loj.ts` 里也踩过并记着，搬到这边同样适用。
 *
 * 接口对匿名可读的题直接返回内容，不需要登录；不公开的题返回
 * `{ error: 'PERMISSION_DENIED' }` 而**状态码是 201**——所以不能只看 HTTP 状态，
 * 判断交给 parseLoj。
 */
async function fetchLoj(displayId, url) {
  const res = await fetch('https://api.loj.ac/api/problem/getProblem', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      displayId: Number(displayId),
      localizedContentsOfLocale: 'zh_CN',
      samples: true,
      judgeInfo: true,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok && res.status !== 201) {
    throw new StatementError(502, `LOJ 接口返回 HTTP ${res.status}`);
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    throw new StatementError(502, `LOJ 接口返回的不是 JSON 而是 ${type.split(';')[0] || '未知类型'}`);
  }
  return parseLoj(await res.json(), displayId, url);
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
