/**
 * 四个平台共用的产出格式。
 *
 * 样例那套标题（`## 样例 #N` / `### 样例输入 #N`）**不是随便定的**：
 * oi-bench 的 `core/testcases/statement.ts` 认的就是这套写法，「从题面导入样例」
 * 靠它把样例从 .md 里重新提出来。两边错开的话导入会静默返回 0 个样例，
 * 而没有任何地方会报错。所以这里集中成一个函数，四个平台都调它。
 */

/** 抓取失败。`status` 沿用 HTTP 语义，方便把平台的原始状态如实带出来。 */
export class StatementError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'StatementError';
    this.status = status;
  }
}

export function endsWithNewline(text) {
  const normalized = text.replace(/\r\n?/g, '\n');
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

/**
 * 样例小节。与 oi-bench 的提取器同一套写法，见文件头。
 *
 * `startNumber` 用于**一次只输出一个样例**的场合：LOJ 的样例是被正文按下标引用的，
 * 得一节一节地插到各自的位置上，这时编号不能每次都从 1 重新开始——那样一份三组
 * 样例的题面里会出现三个「样例 #1」，而 oi-bench 导入时按标题去重，结果只剩一组。
 */
export function sampleSections(samples, startNumber = 1) {
  const parts = [];
  samples.forEach((s, i) => {
    const n = startNumber + i;
    parts.push(`## 样例 #${n}`, '');
    parts.push(`### 样例输入 #${n}`, '', '```', s.input.trimEnd(), '```', '');
    parts.push(`### 样例输出 #${n}`, '', '```', s.output.trimEnd(), '```', '');
  });
  return parts;
}

/**
 * 顶部的 YAML front matter。
 *
 * 存在的理由不是好看：题面文件落到工作区之后，「这份 .md 是哪道题的」除了看
 * 目录名就没别的线索了，而目录名恰恰是最不可靠的那个（Codeforces 的目录名带的
 * 是 Round 编号而不是 contest id）。把 url 写进文件里，识别管线就多了一条
 * 高置信度的线索，而且是跟着文件走的。
 *
 * 限制也写进来。Codeforces 和 AtCoder 的正文里本来就有一句「时间限制 …」，
 * 洛谷却没有——它的限制来自接口而不是题面。所以这里是各平台唯一统一的、
 * 机器能直接读的位置，下游（oi-bench 导入题面时自动设置判题限制）就靠它。
 */
export function withFrontMatter(markdown, platform, key, title, url, limits) {
  const head = [
    '---',
    `platform: ${platform}`,
    `problem: ${key}`,
    `title: ${JSON.stringify(title)}`,
    `url: ${url}`,
    ...(limits.timeLimitMs !== null ? [`timeLimitMs: ${limits.timeLimitMs}`] : []),
    ...(limits.memoryLimitMb !== null ? [`memoryLimitMb: ${limits.memoryLimitMb}`] : []),
    `fetched: ${new Date().toISOString()}`,
    '---',
    '',
  ].join('\n');
  return `${head}${markdown.replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/**
 * 产出的 Markdown 上限。
 *
 * 结果要经 socket.io 回传给 oi-bench，而 engine.io 的 maxPayload 是 1 MB。
 * 超了的话连接层会直接把这一帧丢掉——表现是「抓取没反应」，两端都不报错。
 * 所以宁可在这里明确报错，也不要静默截断一份缺了一半的题面。
 */
export const MAX_MARKDOWN_BYTES = 800 * 1024;

export function assertNotTooLarge(markdown, platform) {
  const bytes = new TextEncoder().encode(markdown).length;
  if (bytes > MAX_MARKDOWN_BYTES) {
    throw new StatementError(
      413,
      `${platform} 的题面转出来有 ${Math.round(bytes / 1024)} KB，超过 ${MAX_MARKDOWN_BYTES / 1024} KB 的回传上限，没有截断也没有发送`,
    );
  }
  return markdown;
}
