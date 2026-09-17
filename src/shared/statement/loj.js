/**
 * LibreOJ 题面。
 *
 * 四家 HTML 站之后，这一家是唯一**不用解析 HTML** 的：它的接口直接给结构化数据，
 * 而且正文本来就是 Markdown（LOJ 的题面就是用 Markdown + KaTeX 写的）。
 * 所以这里没有一条正则去认标签——照抄过来就是最高保真度的结果。
 *
 *   POST https://api.loj.ac/api/problem/getProblem
 *   { displayId, localizedContentsOfLocale: 'zh_CN', samples: true, judgeInfo: true }
 *   →
 *   { meta: { id, displayId, isPublic, locales: ['zh_CN', 'en_US'] },
 *     localizedContentsOfLocale: {
 *       locale, title,
 *       contentSections: [ { type: 'Text',   sectionTitle: '题目描述', text: '…' },
 *                          { type: 'Sample', sectionTitle: '样例', sampleId: 0 } ] },
 *     samples: [ { inputData, outputData } ],
 *     judgeInfo: { timeLimit: 1000, memoryLimit: 512 } }
 *
 * 三处要当心：
 *
 *   · **章节标题是出题人自己填的**，不是枚举值。中文题通常是「题目描述 / 输入格式」，
 *     但英文题、搬运题会写成 "Description" / "Input Format"，甚至留空。所以照抄，
 *     只对能认出来的做归一化，认不出的原样保留——猜错了比不动更糟。
 *   · **样例是按 sampleId 引用的**，不是内联在正文里。`type: 'Sample'` 的那一节只有
 *     一个下标，真正的数据在顶层 samples 数组里。而且 sampleId 不保证连续、也不保证
 *     和数组下标一致，必须按下标取而不是按出现顺序数。
 *   · **judgeInfo 可能整个没有**（交互题、提交答案题），limits 就是 null。
 */

import { StatementError, endsWithNewline, sampleSections, withFrontMatter } from './common.js';

export function parseLoj(body, displayId, url) {
  const content = body?.localizedContentsOfLocale;
  if (!content) {
    /*
     * 接口对不公开的题返回 `{ error: 'PERMISSION_DENIED' }`（HTTP 201，不是 4xx），
     * 所以状态码在这里毫无用处，只能看 body。把原始 error 带出去：
     * 「没权限」和「题号不存在」（NO_SUCH_PROBLEM）的处理方式完全不同。
     */
    const code = String(body?.error ?? '');
    if (code === 'PERMISSION_DENIED') {
      throw new StatementError(403, `LOJ #${displayId} 不公开。若你有权限，请先在浏览器里登录 LOJ 再试。`);
    }
    if (code) throw new StatementError(404, `LOJ 返回 ${code}（题号 ${displayId}）`);
    throw new StatementError(502, `LOJ 没有返回题面内容（题号 ${displayId}），页面结构可能变了。`);
  }

  const title = String(content.title ?? '').trim() || `#${displayId}`;
  const timeLimitMs = numberOrNull(body?.judgeInfo?.timeLimit);
  const memoryLimitMb = numberOrNull(body?.judgeInfo?.memoryLimit);

  const samples = (Array.isArray(body?.samples) ? body.samples : []).map((s) => ({
    input: endsWithNewline(String(s?.inputData ?? '')),
    output: endsWithNewline(String(s?.outputData ?? '')),
  }));

  const parts = [`# ${title}`, ''];
  if (timeLimitMs !== null || memoryLimitMb !== null) {
    parts.push(
      `> ${[
        timeLimitMs !== null ? `时间限制 ${timeLimitMs}ms` : '',
        memoryLimitMb !== null ? `内存限制 ${memoryLimitMb}MB` : '',
      ]
        .filter(Boolean)
        .join('　')}`,
      '',
    );
  }

  /*
   * 样例小节插在页面上原本的位置。LOJ 的「数据范围与提示」常排在样例之后，
   * 一律追加到末尾会把顺序颠倒，读起来和网站上不是一回事（与 Timus 同一处考量）。
   */
  const used = new Set();
  for (const section of Array.isArray(content.contentSections) ? content.contentSections : []) {
    if (section?.type === 'Sample') {
      const i = Number(section.sampleId);
      const sample = samples[i];
      if (!sample) continue; // 引用了不存在的样例：跳过，不要塞个空样例进去
      used.add(i);
      parts.push(...sampleSections([sample], i + 1));
      continue;
    }
    const text = String(section?.text ?? '').replace(/\r\n?/g, '\n').trim();
    if (!text) continue;
    parts.push(`## ${sectionName(section?.sectionTitle)}`, '', text, '');
  }

  // 没有被任何一节引用的样例补在末尾——宁可多一份，也不要把样例弄丢
  samples.forEach((sample, i) => {
    if (!used.has(i)) parts.push(...sampleSections([sample], i + 1));
  });

  return {
    platform: 'loj',
    problemKey: String(displayId),
    title,
    url,
    markdown: withFrontMatter(parts.join('\n'), 'loj', String(displayId), title, url, {
      timeLimitMs,
      memoryLimitMb,
    }),
    samples,
    timeLimitMs,
    memoryLimitMb,
  };
}

/** 章节名归一化：认得出的对齐成另外几家的说法，认不出的原样保留（见文件头）。 */
function sectionName(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '题目描述';
  const lower = s.toLowerCase();
  if (lower === 'description') return '题目描述';
  if (lower === 'input format' || lower === 'input') return '输入格式';
  if (lower === 'output format' || lower === 'output') return '输出格式';
  if (lower === 'limits and hints' || lower === 'hint' || lower === 'notes') return '提示';
  return s;
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
