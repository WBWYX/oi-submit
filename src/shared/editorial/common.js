import { decodeEntities, htmlToMarkdown, stripTags } from '../statement/html.js';

const HOSTS = new Set([
  'www.luogu.com.cn', 'luogu.com.cn', 'codeforces.com', 'www.codeforces.com',
  'atcoder.jp', 'ac.nowcoder.com', 'blog.nowcoder.net',
]);
const MAX_PAGE_BYTES = 5 * 1024 * 1024;

/** 请求范围只包含支持平台，不能把本机网关变成任意 URL 抓取器。 */
export function editorialUrl(raw, base) {
  const url = new URL(raw, base);
  if (!['https:', 'http:'].includes(url.protocol) || !HOSTS.has(url.hostname) ||
      url.username || url.password || url.port) {
    throw new Error('题解链接必须属于洛谷、Codeforces、AtCoder 或牛客');
  }
  url.protocol = 'https:';
  return url.href;
}

/** 浏览器登录态、超时和下载上限共用一处。 */
export function createEditorialClient(fetchFn = fetch) {
  async function read(url, headers = {}, init = {}) {
    const response = await fetchFn(editorialUrl(url), {
      ...init, credentials: 'include', headers, signal: AbortSignal.timeout(20000),
    });
    if (response.url) editorialUrl(response.url);
    if (response.status === 401 || response.status === 403) {
      throw new Error('题解访问被拒绝，请先在浏览器登录对应平台，确认能打开题解后重试');
    }
    if (response.status === 429) throw new Error('平台请求过于频繁，请稍后再抓取题解');
    if (response.status === 404) throw new Error('题解页面不存在或尚未发布');
    if (!response.ok) throw new Error(`题解请求失败：HTTP ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) return '';
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    let finished = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          finished = true;
          return text + decoder.decode();
        }
        bytes += value.byteLength;
        if (bytes > MAX_PAGE_BYTES) throw new Error('题解页面超过 5 MB，已停止下载');
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      if (!finished) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  function json(text) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('平台没有返回题解数据，请确认浏览器登录状态，或稍后重试');
    }
  }
  return {
    getHtml: (url) => read(url, { Accept: 'text/html,application/xhtml+xml' }),
    async getJson(url, headers = {}) {
      return json(await read(url, { Accept: 'application/json', ...headers }));
    },
    async postForm(url, values, headers = {}) {
      const requestHeaders = new Headers(headers);
      requestHeaders.set('Accept', 'application/json');
      requestHeaders.set('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8');
      // 不允许重定向把同页 CSRF 字段或请求头转发到其他来源。
      return json(await read(url, requestHeaders, {
        method: 'POST', body: new URLSearchParams(values).toString(), redirect: 'error',
      }));
    },
  };
}

function attribute(tag, name) {
  return new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
    .exec(tag)?.slice(1).find((value) => value !== undefined) ?? '';
}

function linkUrl(raw, baseUrl) {
  try {
    const url = new URL(decodeEntities(raw), baseUrl);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function codeFence(code, minimum) {
  let length = minimum;
  for (const match of code.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  return '`'.repeat(length);
}

/** 代码先隔离再转换 HTML，避免 #include <...> 和模板参数被当标签吞掉。 */
export function editorialHtmlToMarkdown(html, baseUrl) {
  let marker = '\uE000EDITORIAL';
  while (html.includes(marker)) marker += '_';
  const saved = [];
  const protect = (text) => `${marker}${saved.push(text) - 1}\uE001`;
  const restore = (text) => {
    for (let i = saved.length - 1; i >= 0; i--) text = text.replaceAll(`${marker}${i}\uE001`, () => saved[i]);
    return text;
  };
  let text = html.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, (block) => {
    const lang = /\b(?:language|lang)-([\w+-]+)/i.exec(block)?.[1] ?? '';
    const body = block.replace(/^<pre\b[^>]*>|<\/pre>$/gi, '')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/div>\s*<div\b[^>]*>/gi, '\n');
    const code = decodeEntities(stripTags(body)).replace(/\r\n?/g, '\n').trimEnd();
    const fence = codeFence(code, 3);
    return `\n\n${protect(`${fence}${lang}\n${code}\n${fence}`)}\n\n`;
  });
  text = text.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, body) => {
    const code = decodeEntities(stripTags(body));
    const fence = codeFence(code, 1);
    return protect(`${fence} ${code} ${fence}`);
  });
  text = text.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (_, attrs, body) => {
    const type = attribute(attrs, 'type');
    if (!/^math\/tex(?:;|$)/i.test(type)) return '';
    const delimiter = /mode\s*=\s*display/i.test(type) ? '$$' : '$';
    return protect(`${delimiter}${decodeEntities(body).trim()}${delimiter}`);
  });
  text = text.replace(/<var\b[^>]*>([\s\S]*?)<\/var>/gi, (_, body) => {
    const math = decodeEntities(stripTags(body)).trim();
    return protect(math.startsWith('$') && math.endsWith('$') ? math : `$${math}$`);
  });
  // CF 用 $$$ 标记行内公式、$$$$$$ 标记块级公式；普通 $$ 不改。
  text = text.replace(/\${6}([\s\S]*?)\${6}/g, (_, math) => protect(`$$${math}$$`));
  text = text.replace(/\${3}([\s\S]*?)\${3}/g, (_, math) => protect(`$${math}$`));
  // HTML 里的 "$a < b$" 是文本，不能让后面的剥标签把两个不等号之间的公式吞掉。
  text = text.replace(/\$\$[\s\S]*?\$\$|\$[^\n$]+\$/g, (math) => protect(decodeEntities(math)));
  text = text.replace(/<img\b[^>]*>/gi, (tag) => {
    const url = linkUrl(attribute(tag, 'src'), baseUrl);
    const alt = decodeEntities(attribute(tag, 'alt')).replace(/[\[\]]/g, '\\$&');
    return url ? protect(`![${alt}](<${url}>)`) : '';
  });
  text = text.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs, body) => {
    const label = decodeEntities(stripTags(body)).trim();
    const href = attribute(attrs, 'href');
    const url = href ? linkUrl(href, baseUrl) : null;
    return url ? protect(`[${label.replace(/[\[\]]/g, '\\$&')}](<${url}>)`) : label;
  });
  text = text.replace(/<h([1-6])\b[^>]*>/gi, (_, level) => `\n\n${'#'.repeat(Number(level))} `);
  text = text.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, table) => {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map((cell) => restore(htmlToMarkdown(cell[1])).replace(/\n/g, ' ').replace(/\|/g, '\\|')),
    ).filter((row) => row.length > 0);
    if (!rows.length) return '';
    const width = Math.max(...rows.map((row) => row.length));
    const line = (row) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ')} |`;
    return `\n\n${protect([line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n'))}\n\n`;
  });
  text = htmlToMarkdown(text);
  // 外层链接可能包含已保护的图片/代码，倒序恢复以保留嵌套内容。
  return restore(text).trim();
}

/**
 * 原始 Markdown 离线保存时补全相对链接。只改能明确识别的链接目标，
 * 保留正文、代码、公式和文内锚点；复杂的转义或嵌套目标原样留下。
 */
export function absolutizeMarkdownLinks(markdown, baseUrl) {
  let marker = '\uE002MDLINK';
  while (markdown.includes(marker)) marker += '_';
  const saved = [];
  const protect = (value) => `${marker}${saved.push(value) - 1}\uE003`;
  const protectBlock = (value) => {
    const newline = /(?:\r\n|\n|\r)$/.exec(value)?.[0] ?? '';
    return protect(newline ? value.slice(0, -newline.length) : value) + newline;
  };

  let text = '';
  let fence = null;
  let block = '';
  for (const [line] of markdown.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)) {
    if (!line) continue;
    const visible = line.replace(/(?:\r\n|\n|\r)$/, '').replace(/^(?: {0,3}>[ \t]?)+/, '');
    const match = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(visible);
    if (fence) {
      block += line;
      if (match && match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) {
        text += protectBlock(block);
        fence = null;
        block = '';
      }
    } else if (match && (match[1][0] !== '`' || !match[2].includes('`'))) {
      fence = match[1];
      block = line;
    } else {
      text += /^(?: {4}|\t)/.test(visible) ? protectBlock(line) : line;
    }
  }
  if (block) text += protectBlock(block);

  text = text.replace(/<(pre|code|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (value) => protect(value));
  // 同长度反引号可跨行；公式里的 [x](y) 是数学文本，不能当链接改写。
  text = text.replace(/(?<!`)(`+)(?!`)([\s\S]*?)(?<!`)\1(?!`)/g, (value) => protect(value));
  text = text.replace(/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, (value) => protect(value));
  text = text.replace(/(?<![\\$])(\${1,2})(?!\$)[\s\S]*?\1(?!\$)/g, (value) => protect(value));

  const absolute = (destination) => {
    const angled = destination.startsWith('<') && destination.endsWith('>');
    const raw = angled ? destination.slice(1, -1) : destination;
    if (!raw || raw.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.includes('\\') || raw.includes(marker)) {
      return destination;
    }
    try {
      const url = new URL(raw, baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return destination;
      return angled ? `<${url.href}>` : url.href;
    } catch {
      return destination;
    }
  };

  // 不尝试解析含转义括号或多层嵌套的目标；角括号形式可明确包含空格和括号。
  text = text.replace(
    /(?<!\\)(!?\[(?:\\.|[^\]\\\r\n])*\]\([ \t]*)(<[^>\r\n]*>|[^\\\s()<>"']+)([ \t]*(?:(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^()\r\n]*\))[ \t]*)?\))/g,
    (_, before, destination, after) => before + absolute(destination) + after,
  );
  text = text.replace(
    /^( {0,3}\[[^\]\r\n]+\]:[ \t]*)(<[^>\r\n]*>|[^\\\s()<>"']+)(?=[ \t]*(?:$|"[^"\r\n]*"|'[^'\r\n]*'|\([^()\r\n]*\)))/gm,
    (_, before, destination) => before + absolute(destination),
  );
  for (let i = saved.length - 1; i >= 0; i--) text = text.replaceAll(`${marker}${i}\uE003`, () => saved[i]);
  return text;
}
