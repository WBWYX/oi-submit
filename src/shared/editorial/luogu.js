// 2026-09 核对官方 problem.solution 前端：data.solutions.result 是 article 列表。
// article.show 返回原始 Markdown，contentFull=false 表示当前会话只能读摘要。
const ORIGIN = 'https://www.luogu.com.cn';
const HEADERS = { 'x-lentille-request': 'content-only', Accept: 'application/json' };

function normalizeProblemKey(pid) {
  const value = String(pid);
  return /^AT_/i.test(value) ? `AT_${value.slice(3)}` : value.toUpperCase();
}

// AT_ 镜像沿用原始任务名（如 abc020_a、dp_e），后缀不能整体转成大写。
export function luoguProblemKey(raw) {
  const url = new URL(raw);
  const match = /^\/problem\/(AT_[A-Za-z0-9_]+|[A-Za-z]*\d+[A-Za-z0-9_]*)\/?$/i.exec(url.pathname);
  if (!['www.luogu.com.cn', 'luogu.com.cn'].includes(url.hostname) || !match || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('请提供洛谷题目页链接，例如 https://www.luogu.com.cn/problem/P1001');
  }
  return normalizeProblemKey(match[1]);
}

function contentData(body) {
  const data = body?.data;
  const status = Number(data?.errorCode ?? body?.status);
  if (status === 401 || data?.errorData?.needLogin) {
    throw new Error('查看洛谷题解需要登录，请先在浏览器里登录洛谷。');
  }
  if (status === 403) throw new Error('当前洛谷账号没有权限查看这篇题解。');
  if (status === 404) throw new Error('洛谷题目或题解不存在，可能已被删除。');
  if (status >= 400 || body?.template === 'error') {
    throw new Error(`洛谷题解请求失败：${data?.errorMessage || `HTTP ${status}`}`);
  }
  return data;
}

export async function listLuoguEditorials(problemUrl, client) {
  const pid = luoguProblemKey(problemUrl);
  const data = contentData(await client.getJson(`${ORIGIN}/problem/solution/${pid}`, HEADERS));
  if (data?.problem?.pid && normalizeProblemKey(data.problem.pid) !== pid) {
    throw new Error('洛谷返回的题解列表与当前题号不一致。');
  }
  const articles = data?.solutions?.result;
  if (!Array.isArray(articles)) throw new Error('洛谷题解列表结构变化，未找到 solutions.result。');
  if (articles.length === 0) throw new Error(`洛谷题目 ${pid} 暂无可用题解。`);

  const sources = [];
  const seen = new Set();
  for (const article of articles) {
    if (!/^[a-zA-Z0-9]+$/.test(article?.lid ?? '')) continue;
    if (article.solutionFor?.pid && normalizeProblemKey(article.solutionFor.pid) !== pid) continue;
    if (seen.has(article.lid)) continue;
    seen.add(article.lid);
    sources.push({
      platform: 'luogu',
      problemKey: pid,
      title: typeof article.title === 'string' && article.title.trim() ? article.title : `${pid} 题解`,
      url: `${ORIGIN}/article/${article.lid}`,
      ...(typeof article.author?.name === 'string' ? { author: article.author.name } : {}),
    });
    if (sources.length === 20) break;
  }
  if (sources.length === 0) throw new Error('洛谷题解列表结构变化，未找到属于当前题目的文章。');
  return sources;
}

export async function fetchLuoguEditorial(source, client) {
  const url = new URL(source.url);
  const match = /^\/article\/([a-zA-Z0-9]+)\/?$/.exec(url.pathname);
  if (source.platform !== 'luogu' || url.origin !== ORIGIN || !match) {
    throw new Error('洛谷题解来源无效，请重新从当前题目的题解列表选择。');
  }
  const data = contentData(await client.getJson(`${ORIGIN}/article/${match[1]}`, HEADERS));
  const article = data?.article;
  if (!article || article.lid !== match[1]) throw new Error('洛谷文章结构变化，未找到所选题解。');
  if (article.solutionFor?.pid && normalizeProblemKey(article.solutionFor.pid) !== source.problemKey) {
    throw new Error('这篇洛谷题解属于其他题目，请重新选择。');
  }
  if (article.contentFull === false) throw new Error('洛谷仅返回题解摘要，请先登录有权查看全文的账号。');
  if (typeof article.content !== 'string' || !article.content.trim()) {
    throw new Error('洛谷题解正文为空或结构已变化，没有保存空文件。');
  }
  return {
    ...source,
    ...(typeof article.title === 'string' && article.title.trim() ? { title: article.title } : {}),
    ...(typeof article.author?.name === 'string' ? { author: article.author.name } : {}),
    markdown: article.content,
  };
}
