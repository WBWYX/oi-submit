/**
 * HTML → Markdown 的最小转换，以及按标签/类名取块的几个工具。
 *
 * 这份代码是从 `icpc-workbench/server/src/problems/statement.ts` **逐行搬过来的**，
 * 逻辑一字未改——它已经被真实页面的夹具测试覆盖过，搬家时顺手"优化"是这类移植
 * 最常见的失败方式。唯一的改动是去掉 TypeScript 类型标注。
 *
 * 能整份搬进 MV3 的 service worker，是因为它**全程只用正则和字符串**，不碰 DOM。
 * （service worker 里没有 DOMParser，用得上的话还得再开一个 offscreen 文档。）
 */

/** 按 id 取一个元素的内容。 */
export function sliceId(html, id) {
  const start = html.search(new RegExp(`<[a-z][a-z0-9]*[^>]*\\bid=["']${id}["']`, 'i'));
  return start < 0 ? null : balancedFrom(html, start);
}

/** 按 class 取第一个匹配元素的内容。 */
export function sliceClass(html, className) {
  const start = html.search(new RegExp(`<[a-z][a-z0-9]*[^>]*\\bclass=["'][^"']*\\b${className}\\b`, 'i'));
  return start < 0 ? null : balancedFrom(html, start);
}

export function sliceTag(html, tag, className) {
  const start = html.search(new RegExp(`<${tag}[^>]*\\bclass=["'][^"']*\\b${className}\\b`, 'i'));
  return start < 0 ? null : balancedFrom(html, start);
}

/**
 * 从某个起始标签开始，取到与之配对的结束标签。
 *
 * 用配对计数而不是「找下一个 </div>」：题面里嵌套 div 是常态，非配对的取法
 * 会在第一个内层 div 处截断，把题面砍掉大半——而且砍得毫无征兆。
 */
export function balancedFrom(html, start) {
  /*
   * 标签名要允许数字：`h1`–`h6` 就带数字。
   *
   * 原实现写的是 `[a-z]+`，对 `<H2>` 只取到 `H`，接着去找 `</h>`，
   * 自然永远找不到、返回 null。服务端只对 div/span 调过它，所以一直没暴露；
   * Timus 的标题恰恰在 <H2> 里，一接就撞上。
   */
  const open = /^<([a-z][a-z0-9]*)/i.exec(html.slice(start));
  const tag = open?.[1]?.toLowerCase();
  if (!tag) return null;
  const pattern = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, 'gi');
  pattern.lastIndex = start;
  let depth = 0;
  for (let m = pattern.exec(html); m; m = pattern.exec(html)) {
    if (m[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return html.slice(start, m.index + m[0].length);
    } else if (!m[0].endsWith('/>')) {
      depth += 1;
    }
  }
  return null;
}

export function dropFirstHeading(html) {
  return html.replace(/<div class="section-title">[\s\S]*?<\/div>/i, '');
}

export function stripTags(html) {
  return html.replace(/<[^>]*>/g, '');
}

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  times: '×',
  le: '≤',
  ge: '≥',
  ne: '≠',
};

export function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}

/**
 * HTML → Markdown 的最小转换。
 *
 * 刻意只处理题面里真会出现的那几种结构。写一个完整的转换器是另一个项目，
 * 而题面里 99% 的内容是段落、行内代码、加粗、列表和数学公式——数学公式恰恰
 * **不能动**：Codeforces 和 AtCoder 的公式本来就是 `$...$`，任何「聪明」的
 * 处理都只会把它弄坏。
 */
export function htmlToMarkdown(html, opts = {}) {
  let text = html;
  // script/style 整块丢掉，它们的内容不是给人看的
  text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  /*
   * 图片：**只在调用方给了 baseUrl 时才转**，缺省行为与以前逐字一致（被 stripTags 吞掉）。
   *
   * 做成可选是因为这个函数是五家共用的，而那五家现在都不需要图片；为 HDU 一家
   * 改变它们的输出是不必要的风险。HDU 老题的关键公式常常就在图里，不转就缺内容。
   *
   * 用 new URL 解析而不是字符串拼接：HDU 的 src 是 `../data/images/x.gif`，
   * 页面在 /showproblem.php，手拼会留下 `../`。
   */
  if (opts.baseUrl) {
    text = text.replace(/<img[^>]*?\bsrc=["']?([^"'\s>]+)[^>]*>/gi, (_, src) => {
      try {
        return ` ![](${new URL(src, opts.baseUrl).href}) `;
      } catch {
        return ''; // src 拼不出合法 URL 就当它不存在，不要留一个坏链接
      }
    });
  }
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|section|h[1-6])>/gi, '\n\n');
  text = text.replace(/<li[^>]*>/gi, '\n- ');
  text = text.replace(/<\/li>/gi, '');
  text = text.replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, '**$2**');
  /*
   * 下标上标要在剥标签之前处理掉，否则 `t<sub>i</sub>` 会变成没有分隔的 `ti`，
   * 而 `10<sup>5</sup>` 会变成 `105`——后者是会让人读错题目数据范围的那种错。
   */
  text = text.replace(/<sub[^>]*>([\s\S]*?)<\/sub>/gi, (_, body) => `_{${stripTags(body)}}`);
  text = text.replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, (_, body) => `^{${stripTags(body)}}`);
  /*
   * `<i>` 在 Codeforces 的题面里标的是数学变量，不是强调。转成 Markdown 的 `*x*`
   * 会产出 `*t**i*` 这种既读不懂、又是坏 Markdown 的东西（连着的星号被当成粗体）。
   * 直接剥掉标签留下 `t_{i}`，朴素但从不出错。
   */
  text = text.replace(/<\/?(?:i|em)[^>]*>/gi, '');
  /*
   * AtCoder 把每个公式都包在 <var> 里，里面是裸 LaTeX（`1 \leq i \leq N-1`）。
   * 直接剥标签会得到一串没有分隔符的数学符号，读起来完全不知所云——必须补回
   * `$...$`。已经带 $ 的不再包一层，否则会变成 `$$x$$`（那是行间公式，排版会乱）。
   */
  text = text.replace(/<var>([\s\S]*?)<\/var>/gi, (_, body) => {
    const inner = decodeEntities(stripTags(body)).trim();
    if (inner === '') return '';
    return inner.startsWith('$') && inner.endsWith('$') ? inner : `$${inner}$`;
  });
  // 块级 pre 转围栏，行内 code 转反引号
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, body) => {
    return `\n\n\`\`\`\n${decodeEntities(stripTags(body)).trimEnd()}\n\`\`\`\n\n`;
  });
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, body) => {
    return `\`${decodeEntities(stripTags(body))}\``;
  });
  text = stripTags(text);
  text = decodeEntities(text);
  // 三个以上连续空行压成两个；行尾空格去掉
  return text
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 取 pre 里的纯文本，处理新旧两种行结构（Codeforces 用）。 */
export function preText(html) {
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(html);
  let inner = pre?.[1] ?? html;
  // 新版：每行一个 div。先把行边界变成换行，再统一剥标签
  inner = inner.replace(/<\/div>\s*<div[^>]*>/gi, '\n');
  inner = inner.replace(/<br\s*\/?>/gi, '\n');
  return decodeEntities(stripTags(inner)).replace(/\r\n?/g, '\n').replace(/^\n+/, '').trimEnd();
}
