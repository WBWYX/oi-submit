/**
 * HDU（杭电 OJ）提交与结果回读。
 *
 * 表单本身是八家里最老派的：普通 `<textarea>` + `<select>`，没有前端框架，
 * 所以不需要 Codeforces / AtCoder 那套伪造粘贴的手法，`setValue` 直接就成。
 *
 * 字段（逐字取自登录态下的真实页面）：
 *   problemid=<题号>  language=<0..6>  usercode=<源码>  _usercode=<base64>
 *
 * ## 这个页面上最要命的一处
 *
 * 表单挂着 `onsubmit="submitEncode()"`，而那个函数干的是：
 *
 *     form._usercode.value = btoa(encodeURIComponent(form.usercode.value));
 *     form.usercode.removeAttribute('name');   // 明文那个被摘掉，根本不发
 *
 * 也就是说**真正提交的是 `_usercode`**，明文的 `usercode` 只是给人看的输入框。
 * 而 `form.submit()`（程序调用）**不会触发 onsubmit** —— 那样发出去的
 * `_usercode` 是空的，HDU 收到一份空提交，**而且不报错**。
 *
 * 所以这里只点真实按钮，绝不调 `form.submit()`。这条与 Timus 那份「所有元素都从
 * 表单出发去找」是同一类教训：让浏览器走它自己的那条路，别绕过去。
 *
 * ## 验证码
 *
 * 页面上有一行 `<tr id="exe_checkcode" style="display: none;">`，里面是图片验证码。
 * HDU 只在特定条件下把它显示出来。读不了图，所以**可见就中止并明说**，
 * 让人手动交这一次——硬选一个数字只会让提交静默失败。
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
  /*
   * 从 textarea 出发拿到所属表单，后面所有查找都限定在这个表单里。
   * 页面上另有两个搜索表单，各自带着 `<input type=submit value=Search>`，
   * 在 document 上找通用选择器会点中搜索——Timus 那次就是这么谎报成功的。
   */
  const code = await waitForElement(['textarea[name="usercode"]']);
  const form = code.closest('form');
  if (!form) throw new Error('找不到提交表单（可能没登录 HDU，或页面结构变了）');

  assertNoCaptcha();

  const pid = form.querySelector('input[name="problemid"]');
  if (pid) setValue(pid, task.problemNum);

  let chosen = '';
  const langSelect = form.querySelector('select[name="language"]');
  if (langSelect && task.language) {
    const option = pickOption(optionsOf(langSelect), task.language);
    if (option) {
      selectValue(langSelect, option.value);
      chosen = option.text.trim();
    } else {
      chosen = `${langSelect.selectedOptions[0]?.textContent?.trim() ?? ''}（没找到「${task.language}」，用的是页面当前选项）`;
    }
  }

  setValue(code, task.sourceCode);

  const submit = submitButtonOf(form);
  if (!submit) throw new Error('找不到提交按钮（页面结构可能变了）');
  /*
   * **只点按钮。** clickOrHighlight 走的是 element.click()，会正常触发 onsubmit →
   * submitEncode()，代码才会以 base64 进到 _usercode 里。见文件头。
   */
  const submitted = clickOrHighlight(submit, task.manualSubmit);

  return { language: chosen, submitted };
}

/** 验证码那一行可见时中止。读不了图，硬猜只会静默失败。 */
function assertNoCaptcha() {
  const row = document.querySelector('#exe_checkcode');
  if (!row) return;
  // 平时是 display:none；HDU 决定要验证时才显示出来
  const visible = row.offsetParent !== null || getComputedStyle(row).display !== 'none';
  if (visible) {
    throw new Error('HDU 这次要求输入验证码（页面上那张图）。代码已填好，请手动选一下验证码再点 Submit。');
  }
}

/** 手动模式下人要自己点按钮，等待窗口必须足够长（5 分钟）。 */
const MANUAL_WAIT_MS = 300000;

/** HDU 的评测中状态。终态之外的都算还在跑。 */
const IN_FLIGHT = /queuing|compiling|running|judging|waiting/i;

export function watch(onUpdate) {
  return pollVerdict(
    () => {
      /*
       * 提交后跳到 status.php，表是 `class=table_text`，列依次是
       * Run ID | Submit Time | Judge Status | Pro.ID | Exe.Time | Exe.Memory | Code Len. | Language | Author
       * 第一行数据就是刚交的那一发。
       */
      const table = document.querySelector('table.table_text');
      const row = table?.querySelectorAll('tr')?.[1];
      const cells = row ? [...row.querySelectorAll('td')].map((c) => (c.textContent ?? '').trim()) : [];
      if (cells.length < 6) return null;

      const text = cells[2].replace(/\s+/g, ' ').trim();
      if (!text) return null;

      const detail = [cells[0] ? `提交号 ${cells[0]}` : '', cells[4], cells[5]]
        .filter(Boolean)
        .join(' · ');

      /*
       * **HDU 不给逐个测试点的结果**，连「卡在第几个」都没有——只有一个总结论。
       * 所以 tests 一律为空，而不是编一份看起来完整的列表出来。
       */
      return { text, detail, tests: [] };
    },
    (text) => !IN_FLIGHT.test(text),
    onUpdate,
  );
}

export function isResultPage() {
  return location.pathname.toLowerCase().includes('status.php');
}

/**
 * 确认真的提交出去了。
 *
 * 判据是**到了状态页**，不是「表单不见了」——任何一次跳转（包括误点搜索）都会让
 * 表单消失，用它当判据会把失败报成成功。
 *
 * 仍然停在 submit.php 通常意味着 HDU 把这一发打回来了（没登录、题号不存在、
 * 交得太频繁），页面上那句英文说明比我们自己编的任何错误信息都准确。
 */
export async function waitUntilSubmitted({ manual = false } = {}) {
  await waitFor(() => isResultPage(), {
    timeoutMs: manual ? MANUAL_WAIT_MS : 20000,
    label: '跳转到状态页',
  }).catch(() => {
    const message = pageError();
    throw new Error(message ? `HDU 拒绝了这次提交：${message}` : '提交后没有跳转到状态页');
  });
}

/** 把页面上那句说明抠出来。找不到返回空串，不要编。 */
function pageError() {
  const text = (document.body?.textContent ?? '').replace(/\s+/g, ' ');
  const known = [
    /Please login first[^.]*\./i,
    /[^.]*not exist[^.]*\./i,
    /[^.]*too (?:often|frequently)[^.]*\./i,
    /[^.]*Invalid[^.]*\./i,
  ];
  for (const re of known) {
    const hit = re.exec(text);
    if (hit) return hit[0].trim();
  }
  return '';
}
