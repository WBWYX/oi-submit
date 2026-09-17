/**
 * AtCoder 提交与结果回读。
 *
 * **语言必须按文本挑，绝不能写死 id。** CPH-NG 写的是 `value = '6017'`，而 AtCoder 的
 * 语言 id 是**每场比赛一套**的：同一个 6017 在另一场比赛里可能不存在，也可能是别的语言。
 * 这是本扩展存在的主要理由之一，所以这里宁可在找不到时如实报告，也不挑一个「最像的」。
 *
 * 编辑器那一处也有讲究：AtCoder 默认用 ACE 编辑器，直接往隐藏的 textarea 里写不生效。
 * 页面上那个「纯文本编辑器」开关会把 ACE 换成真正的 <textarea>，切过去写完再切回来，
 * 是这个站点上唯一稳的填法。
 */

import { pickOption } from '../shared/platforms.js';
import {
  clickOrHighlight,
  optionsOf,
  pollVerdict,
  selectValue,
  setValue,
  sleep,
  waitFor,
  waitForElement,
} from './dom.js';

export async function fill(task) {
  const langSelect = await waitForElement([
    '#select-lang select',
    '#select-lang > div > select',
    'select[name="data.LanguageId"]',
  ]);

  let chosen = '';
  if (task.language) {
    const option = pickOption(optionsOf(langSelect), task.language);
    if (option) {
      selectValue(langSelect, option.value);
      chosen = option.text.trim();
    } else {
      chosen = `${langSelect.selectedOptions[0]?.textContent?.trim() ?? ''}（没找到「${task.language}」，用的是页面当前选项）`;
    }
  }

  // 切到纯文本编辑器：aria-pressed 为 true 表示已经是纯文本模式
  const plainBtn = [...document.querySelectorAll('.editor-buttons button')].find((b) =>
    /plain|テキスト|纯文本/i.test(b.textContent ?? ''),
  ) ?? document.querySelector('.editor-buttons > button:nth-child(3)');
  if (plainBtn && plainBtn.getAttribute('aria-pressed') !== 'true') plainBtn.click();

  const textarea = await waitForElement(['#plain-textarea', 'textarea[name="sourceCode"]']);
  await waitFor(() => textarea.offsetParent !== null || textarea.style.display !== 'none', {
    timeoutMs: 10000,
    label: '纯文本编辑器可见',
  });
  setValue(textarea, task.sourceCode);

  // 切回 ACE：AtCoder 提交时读的是 ACE 的内容，停在纯文本模式反而可能交空
  if (plainBtn) plainBtn.click();
  await sleep(150);

  const submit = await waitForElement(['#submit', 'button[type="submit"]']);
  const submitted = clickOrHighlight(submit, task.manualSubmit);

  return { language: chosen, submitted };
}

/** 手动模式下人要自己点按钮，等待窗口必须足够长（5 分钟）。 */
const MANUAL_WAIT_MS = 300000;

/** WJ=Waiting for Judge，WR=Waiting for Re-judge，`12/35` 是评测进度 */
const IN_FLIGHT = /^(WJ|WR|Judging|Waiting)|^\d+\s*\/\s*\d+$/i;

export function watch(onUpdate) {
  return pollVerdict(
    () => {
      const row = document.querySelector('table tbody tr');
      const cell = row?.querySelector('[id^="judge-status"], td.text-center span.label, td:nth-child(7)');
      const text = (cell?.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!text) return null;
      const score = row?.querySelector('td.text-right')?.textContent?.trim() ?? '';

      /*
       * 提交详情页（/submissions/<id>）上有一张逐个测试点的表，列表页没有。
       * 两种页面这个内容脚本都可能待着，所以在这里顺手读一次——**读得到才报**，
       * 读不到就只给总状态，不去多跳一个页面。
       */
      const tests = readCaseTable();
      const detail = [score ? `得分 ${score}` : '', tests.length ? `${tests.length} 个测试点` : '']
        .filter(Boolean)
        .join(' · ');
      return { text, detail, tests };
    },
    (text) => !IN_FLIGHT.test(text),
    onUpdate,
  );
}

/**
 * 提交详情页上那张「Test Cases」表：每行是「用例名 | 结果 | 耗时 | 内存」。
 * 列表页上没有这张表，返回空数组。
 */
function readCaseTable() {
  const rows = [...document.querySelectorAll('table tbody tr')];
  const out = [];
  for (const row of rows) {
    const cells = [...row.querySelectorAll('td')].map((c) => (c.textContent ?? '').trim());
    if (cells.length < 2) continue;
    const label = cells[0];
    const verdict = row.querySelector('.label')?.textContent?.trim() ?? cells[1];
    // 用例名形如 sample_01 / random_12；没有下划线数字的多半不是用例行
    if (!/^[\w-]+_\d+$|^sample|^test/i.test(label)) continue;
    out.push({
      index: out.length + 1,
      verdict,
      label,
      ...(cells[2] ? { timeText: cells[2] } : {}),
      ...(cells[3] ? { memoryText: cells[3] } : {}),
    });
  }
  return out;
}

export function isResultPage() {
  return /\/submissions(\/me)?$/.test(location.pathname);
}

/**
 * 确认真的提交出去了。
 *
 * 同 Codeforces：判据是**到了提交列表页**而不是「表单不见了」，
 * 后者会把任何跳转都算成成功。
 */
export async function waitUntilSubmitted({ manual = false } = {}) {
  await waitFor(() => isResultPage(), { timeoutMs: manual ? MANUAL_WAIT_MS : 20000, label: '跳转到提交列表' }).catch(() => {
    const error = document.querySelector('.alert-danger, .alert.alert-danger')?.textContent?.trim();
    throw new Error(error ? `AtCoder 拒绝了这次提交：${error}` : '提交后没有跳转到提交列表');
  });
}
