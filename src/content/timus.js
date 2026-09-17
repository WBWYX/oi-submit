/**
 * Timus（URAL）提交与结果回读。
 *
 * 表单本身是四个平台里最省心的——老老实实的 multipart 表单，没有 Cookie、
 * 没有 CSRF、没有前端框架。凭据是 **Judge ID**，一串 8 位十六进制，
 * Timus 的整套身份就靠它，所以填在扩展选项里而不是靠登录态。
 *
 * 字段（逐字取自线上页面）：
 *   Action=submit  SpaceID=1  JudgeID=<...>  Language=<数字>  ProblemNum=<题号>  Source=<源码>
 *
 * ## 这个页面上踩过的坑
 *
 * **submit.aspx 上有两个表单。** 页头的搜索框排在前面，它的 `Search` 按钮在文档里
 * 出现得比真正的提交按钮更早。第一版写的是 `document.querySelector('input[type=submit]')`，
 * 于是每次都点中搜索：表单填得好好的，页面跳去 /search.aspx，什么也没提交。
 * 更糟的是当时用「JudgeID 输入框消失了」判断提交成功——搜索页上当然没有那个框，
 * 于是它**报告提交成功**。一个谎报成功的失败，比直接报错难查十倍。
 *
 * 由此定下两条规矩，下面的代码严格遵守：
 *   1. 所有元素都从**表单元素**出发去找，不在 document 上找通用选择器。
 *   2. 成功的判据是**真的到了状态页**，不是「表单不见了」。
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
  // 先拿 JudgeID 输入框，再顺着它拿到所属表单——后面所有查找都限定在这个表单里
  const judge = await waitForElement(['input[name="JudgeID"]']);
  const form = judge.closest('form');
  if (!form) throw new Error('找不到提交表单（页面结构可能变了）');

  setValue(judge, task.judgeId);

  const num = await waitForElement(['input[name="ProblemNum"]'], { root: form });
  setValue(num, task.problemNum);

  let chosen = '';
  const langSelect = await waitForElement(['select[name="Language"]'], { root: form });
  if (task.language) {
    const option = pickOption(optionsOf(langSelect), task.language);
    if (option) {
      selectValue(langSelect, option.value);
      chosen = option.text.trim();
    } else {
      chosen = `${langSelect.selectedOptions[0]?.textContent?.trim() ?? ''}（没找到「${task.language}」，用的是页面当前选项）`;
    }
  }

  const source = await waitForElement(['textarea[name="Source"]'], { root: form });
  setValue(source, task.sourceCode);

  const submit = submitButtonOf(form);
  if (!submit) throw new Error('找不到提交按钮（页面结构可能变了）');
  const submitted = clickOrHighlight(submit, task.manualSubmit);

  return { language: chosen, submitted };
}

/** 手动模式下人要自己点按钮，等待窗口必须足够长（5 分钟）。 */
const MANUAL_WAIT_MS = 300000;

/** Timus 的评测中状态 */
const IN_FLIGHT = /compiling|running|waiting|judging|in queue|evaluating/i;

export function watch(onUpdate) {
  return pollVerdict(
    () => {
      // 提交后跳到状态页，第一行就是刚交的
      const row = document.querySelector('TR.even, TR.odd, tr.even, tr.odd');
      const cell = row?.querySelector('[class^="verdict_"], [class^="VERDICT_"]');
      const text = (cell?.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!text) return null;

      const pick = (name) => row?.querySelector(`.${name}, [class="${name}"]`)?.textContent?.trim() ?? '';
      const id = pick('id');
      const test = pick('test');
      const runtime = pick('runtime');
      const memory = pick('memory');

      /*
       * **Timus 不给逐个测试点的结果**，只给「卡在第几个」。所以这里只报一条，
       * 而且明确标成「卡在第 N 个」而不是伪装成一份完整的测试点列表——
       * 报一个假的完整列表，比什么都不报更误导。
       */
      const tests = test
        ? [
            {
              index: Number(test) || test,
              verdict: text,
              label: `卡在第 ${test} 个测试点`,
              ...(runtime ? { timeText: `${runtime}s` } : {}),
              ...(memory ? { memoryText: memory } : {}),
            },
          ]
        : [];

      const detail = [id ? `提交号 ${id}` : '', runtime ? `${runtime}s` : '', memory]
        .filter(Boolean)
        .join(' · ');
      return { text, detail, tests };
    },
    (text) => !IN_FLIGHT.test(text),
    onUpdate,
  );
}

export function isResultPage() {
  return location.pathname.toLowerCase().includes('status.aspx');
}

/**
 * 确认真的提交出去了。
 *
 * 判据是**到了状态页**。不能用「表单不见了」——那是上面说的那个谎报成功的来源：
 * 任何一次跳转（包括误点搜索）都会让表单消失。
 *
 * 仍然停在 submit.aspx 通常意味着 Timus 把提交打回来了（Judge ID 不对、
 * 题号不存在、同一份代码交得太频繁），页面上会有一句英文说明，原样带回去——
 * 那句话比我们自己编的任何错误信息都准确。
 */
export async function waitUntilSubmitted({ manual = false } = {}) {
  await waitFor(() => isResultPage(), { timeoutMs: manual ? MANUAL_WAIT_MS : 20000, label: '跳转到状态页' }).catch(() => {
    const message = pageError();
    throw new Error(message ? `Timus 拒绝了这次提交：${message}` : '提交后没有跳转到状态页');
  });
}

/** 把页面上那句错误说明抠出来。找不到就返回空串，不要编。 */
function pageError() {
  const form = document.querySelector('form[action*="submit.aspx"]');
  const text = (form?.textContent ?? '').replace(/\s+/g, ' ');
  const known = [
    /Judge ID is (?:unknown|incorrect|invalid)[^.]*\./i,
    /You have to wait[^.]*\./i,
    /(?:Unknown|Invalid) problem[^.]*\./i,
    /[^.]*too (?:often|frequently)[^.]*\./i,
  ];
  for (const re of known) {
    const hit = re.exec(text);
    if (hit) return hit[0].trim();
  }
  return '';
}
