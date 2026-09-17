/**
 * Codeforces 提交与结果回读。
 *
 * 与 CPH-NG 的差别只有一处，但正是这次要做的那处：**它选语言**。
 * CPH-NG 只填代码和题号，语言用页面上「你上次用的那个」——所以在本地换了语言
 * 也没用，交上去还是老样子，而人根本不知道发生了什么。
 */

import { pickOption } from '../shared/platforms.js';
import {
  clickOrHighlight,
  optionsOf,
  pollVerdict,
  selectValue,
  setValue,
  submitButtonOf,
  waitFor,
  waitForElement,
} from './dom.js';

export async function fill(task) {
  const source = await waitForElement(['#sourceCodeTextarea', 'textarea[name="source"]']);
  /*
   * 所有查找都收窄到源码框所在的那个表单。
   * Codeforces 页头也有搜索框和别的表单，在 document 上找通用选择器
   * （尤其是提交按钮）随时可能点中别人的——Timus 上就是这么栽的。
   */
  const form = source.closest('form') ?? document;

  // 题目定位：比赛页是下拉框，problemset 页是输入框，两种表单长得不一样
  if (task.problemIndex) {
    const select = await waitForElement('select[name="submittedProblemIndex"]', { root: form });
    selectValue(select, task.problemIndex);
  } else if (task.problemCode) {
    const input = await waitForElement('input[name="submittedProblemCode"]', { root: form });
    setValue(input, task.problemCode);
  }

  let chosen = '';
  const langSelect = form.querySelector('select[name="programTypeId"]');
  if (langSelect && task.language) {
    const option = pickOption(optionsOf(langSelect), task.language);
    if (option) {
      selectValue(langSelect, option.value);
      chosen = option.text.trim();
    } else {
      /*
       * 配的语言在这个页面上找不到。**不猜**，用页面当前值并如实报出来——
       * 猜错语言会直接 CE，而人会对着一份没问题的代码查半天。
       */
      chosen = `${langSelect.selectedOptions[0]?.textContent?.trim() ?? ''}（没找到「${task.language}」，用的是页面当前选项）`;
    }
  }

  setValue(source, task.sourceCode);

  const submit =
    (form instanceof HTMLFormElement ? submitButtonOf(form) : null) ??
    (await waitForElement(['.submit'], { root: form }));
  submit.disabled = false;
  const submitted = clickOrHighlight(submit, task.manualSubmit);

  return { language: chosen, submitted };
}

/** 手动模式下人要自己点按钮，等待窗口必须足够长（5 分钟）。 */
const MANUAL_WAIT_MS = 300000;

/** CF 的「还在评测」文案；只要还是这些就继续等。 */
const IN_FLIGHT = /in queue|running|pending|judging|^testing/i;

export function watch(onUpdate) {
  return pollVerdict(
    () => {
      // 提交后会跳到「我的提交」列表，第一行就是刚交的那份
      const row = document.querySelector('.status-frame-datatable tr[data-submission-id]');
      const cell = row?.querySelector('.status-verdict-cell, td.status-cell:nth-child(6)');
      const text = (cell?.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!text) return null;
      const id = row?.getAttribute('data-submission-id') ?? '';

      /*
       * CF 的列表页**只说卡在第几个测试点**（"Wrong answer on test 5"），
       * 没有逐点列表——那在提交详情页里，要再跳一次。这里不去跳：
       * 多开一个页面换几行信息不划算，而「第几个挂的」本来就是最有用的那条。
       */
      const onTest = /on\s+test\s+(\d+)/i.exec(text);
      const time = row?.querySelector('.time-consumed-cell')?.textContent?.trim() ?? '';
      const memory = row?.querySelector('.memory-consumed-cell')?.textContent?.trim() ?? '';
      const tests = onTest
        ? [
            {
              index: Number(onTest[1]),
              verdict: text.replace(/\s*on\s+test\s+\d+\s*/i, '').trim(),
              label: `卡在第 ${onTest[1]} 个测试点`,
              ...(time ? { timeText: time } : {}),
              ...(memory ? { memoryText: memory } : {}),
            },
          ]
        : [];

      const detail = [id ? `提交号 ${id}` : '', time, memory].filter(Boolean).join(' · ');
      return { text, detail, tests };
    },
    (text) => !IN_FLIGHT.test(text),
    onUpdate,
  );
}

/** 当前页面是不是「提交之后会出现结果」的那种页面。 */
export function isResultPage() {
  return /\/(my|status)\b/.test(location.pathname) || location.search.includes('my=on');
}

/**
 * 确认真的提交出去了。
 *
 * 判据是**到了「我的提交」页**，不是「表单不见了」。后者会把任何一次跳转
 * （包括点错按钮跳去别处）都算成成功——Timus 上就是这么谎报了一次。
 *
 * 停在原地通常是 CF 把提交打回来了，最常见的是「交过一模一样的代码」，
 * 页面上那句红字比我们自己编的错误信息准确得多，原样带回去。
 */
export async function waitUntilSubmitted({ manual = false } = {}) {
  await waitFor(() => isResultPage(), { timeoutMs: manual ? MANUAL_WAIT_MS : 20000, label: '跳转到提交列表' }).catch(() => {
    const error = document.querySelector('.error, .for__source, span.error')?.textContent?.trim();
    throw new Error(error ? `Codeforces 拒绝了这次提交：${error}` : '提交后没有跳转到提交列表');
  });
}
