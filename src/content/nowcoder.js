/**
 * 牛客提交与结果回读。
 *
 * 牛客的题目页本身就是「终端」页：左边题面、右边编辑器，**没有另一个提交页**，
 * 提交也不跳转——和洛谷一样，填完之后得留在原文档里接着盯结果。
 *
 * ## 控件
 *
 * 代码框是 **CodeMirror 5**（`editor.setOption('readOnly', …)` 是 CM5 的 API），
 * 内容在页面 JS 持有的 model 里，改隐藏 textarea 没用，只能装成粘贴——见 editor.js。
 *
 * 语言选择器是**运行时用自绘组件拼出来的**：
 *
 *     t.langueSelect = new F({ options: i, renderTo: t.headerEl, renderBy: 'prepend', … })
 *
 * 也就是说它在静态 HTML 里根本不存在，类名由组件内部生成，**离线无法确定**。
 * 所以这里和洛谷用同一套策略：先找原生 `<select>`，找不到就按"当前显示的文本
 * 像不像一门语言"去认那个自绘控件，并且**把实际选中的结果回报出去**——
 * 面板上看得到「语言 C++」，对不上当场就能发现，而不是等 CE 了再怀疑自己的代码。
 *
 * ## 提交这一下比别家弱
 *
 * 别的平台提交会跳转，「到了结果页」是个硬判据。牛客不跳转，只能看状态区的文字。
 * 所以这里**要求出现「判题机已经收下」的明确信号**（判题中／排队中／已提交／终局结论），
 * 而不是「点了按钮就算成功」。牛客提交还会弹验证码，人没过验证码时状态区会显示
 * 验证码相关的错误——那种情况必须报失败，不能因为按钮点过了就说交上去了。
 */

import { pickOption } from '../shared/platforms.js';
import {
  clickOrHighlight,
  findByText,
  optionsOf,
  pollVerdict,
  selectValue,
  sleep,
  waitFor,
  waitForElement,
} from './dom.js';
import { pickFromCustomDropdown, setCode } from './editor.js';

/** 手动模式下人要自己点按钮，等待窗口必须足够长（5 分钟）。 */
const MANUAL_WAIT_MS = 300000;

/** 判题机确实收下了这一发的信号。 */
const ACCEPTED_BY_JUDGE = /判题中|正在判题|排队中|等待判题|已提交|正在评测|评测中/;

/** 仍在评测中（结果轮询用）。 */
const IN_FLIGHT = /判题中|正在判题|排队中|等待判题|正在提交|正在评测|评测中|等待评测|运行中/;

/** 牛客的终局结论文本，取自 icpc-workbench 的 adapters/nowcoder.ts 的映射表。 */
const FINAL_VERDICT =
  /答案正确|答案错误|格式错误|运行超时|编译错误|运行错误|段错误|内存超限|输出超限|系统错误|未知错误|请求超时/;

/**
 * 点提交之前页面上显示的状态。
 *
 * **这个快照是必需的，不是优化。** 牛客的题目页上本来就可能显示着上一次提交的
 * 结论（「答案正确」之类）。如果只是「在页面文本里找到一个结论就算交成功」，
 * 那么一次根本没发出去的提交（验证码没过、没登录）会当场被判成成功——
 * 页面上那个「答案正确」是上一发的。又是 Timus 那次谎报成功的形状。
 *
 * 所以判据是**状态变了**，而不是「有个状态」。
 *
 * 模块级变量在这里是安全的：牛客就地提交、不跳转，fill 和 waitUntilSubmitted
 * 跑在同一个文档、同一次脚本加载里（会跳转的平台不能这么写，状态得放后台）。
 */
let statusBeforeSubmit = '';

export async function fill(task) {
  // CodeMirror 挂上来才说明编辑器可用了，等它比等任何容器都准
  await waitForElement(['.CodeMirror'], { timeoutMs: 30000 });
  const editor = mainEditor();

  const language = await chooseLanguage(task.language);
  await setCode(editor, task.sourceCode);

  statusBeforeSubmit = readStatus()?.text ?? '';

  const submit = findSubmitButton();
  if (!submit) throw new Error('找不到提交按钮（页面结构可能变了）');
  const submitted = clickOrHighlight(submit, task.manualSubmit);

  return { language, submitted };
}

/**
 * 找出**写代码的那个**编辑器。
 *
 * 不能直接拿文档里第一个 `.CodeMirror`：牛客的页面上除了代码框，还可能有自测输入
 * 之类的小编辑器，而它在文档里不一定排在后面。填错地方的后果很安静——代码进了
 * 自测框，交上去的是语言模板，编译错误指向一段你没写过的代码。
 *
 * 先按容器认；认不出就取**最高的那个**——代码框和边上那些小输入框的高度不是
 * 一个量级，这个判据比按顺序猜稳得多。
 */
function mainEditor() {
  const scoped = document.querySelector('.terminal-code .CodeMirror, .subject-code .CodeMirror, #code .CodeMirror');
  if (scoped) return scoped.parentElement ?? scoped;

  const all = [...document.querySelectorAll('.CodeMirror')];
  if (!all.length) throw new Error('没找到代码编辑器');
  const tallest = all.reduce((a, b) => (b.clientHeight > a.clientHeight ? b : a));
  return tallest.parentElement ?? tallest;
}

/**
 * 选语言：原生 select 优先，否则按文本点自绘控件（见文件头）。
 */
async function chooseLanguage(wanted) {
  if (!wanted) return '';

  const native = [...document.querySelectorAll('select')].find((el) =>
    optionsOf(el).some((o) => /C\+\+|Python|Java|Pascal/i.test(o.text)),
  );
  if (native) {
    const option = pickOption(optionsOf(native), wanted);
    if (!option) {
      return `${native.selectedOptions[0]?.textContent?.trim() ?? ''}（没找到「${wanted}」，用的是页面当前选项）`;
    }
    selectValue(native, option.value);
    return option.text.trim();
  }

  const trigger = [...document.querySelectorAll('div, span, a, button')].find((el) => {
    // 只看自己的文本，不看后代的——否则会命中一路向上的所有祖先容器
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? '')
      .join('')
      .trim();
    return /^(C\+\+|C|Java|Python\s*3?|Pascal|Go|Rust|Kotlin|C#|JavaScript|PHP|Ruby|Swift|Scala)$/i.test(own);
  });
  if (!trigger) return '（没找到语言选择器，用的是页面当前选项）';

  const picked = await pickFromCustomDropdown(trigger, wanted, {
    itemSelector: 'li, .item, [data-value], .option',
  });
  return picked.ok ? picked.text : `（${picked.text}）`;
}

/**
 * 找提交按钮。
 *
 * 两种形态都见于线上代码：Vue 版是 `button.btn-submit`（文本「保存并提交」），
 * 老版是 `a.js-submit-code`（文本由 `#{runTxt}` 填）。按类名找，找不到再按文本。
 */
function findSubmitButton() {
  return (
    document.querySelector('button.btn-submit') ??
    document.querySelector('.js-submit-code') ??
    findByText('button, a', /^\s*(保存并提交|提交代码|提交)\s*$/)
  );
}

/* ────────────────────────── 结果回读 ────────────────────────── */

export function isResultPage() {
  // 提交不跳转，结果就在题目页上；另有独立的提交详情页
  return /\/acm\/(problem|contest)\//.test(location.pathname) || /view-submission/.test(location.search);
}

export function watch(onUpdate) {
  return pollVerdict(readStatus, (text) => FINAL_VERDICT.test(text) && !IN_FLIGHT.test(text), onUpdate);
}

/**
 * 读状态。
 *
 * **牛客不给逐个测试点的结果**——它只报一条总结论和「通过率 x/y」。
 * 所以 tests 一律是空数组，不伪造一份看起来完整的测试点列表：报一个假的完整列表，
 * 比什么都不报更误导（Timus 那边同一处考量）。
 */
function readStatus() {
  const area = document.querySelector('.js-run-info, .subject-describe-answer, .terminal-code-status, .code-status');
  const text = pickStatusText(area) || pickStatusText(document.body);
  if (!text) return null;

  const rate = /通过率[：: ]*([\d./%]+)/.exec(document.body.textContent ?? '')?.[1] ?? '';
  return { text, detail: rate ? `通过率 ${rate}` : '', tests: [] };
}

function pickStatusText(root) {
  if (!root) return '';
  const raw = (root.textContent ?? '').replace(/\s+/g, ' ');
  const hit = FINAL_VERDICT.exec(raw) ?? IN_FLIGHT.exec(raw);
  return hit ? hit[0] : '';
}

/**
 * 确认真的提交出去了。
 *
 * 判据是**状态区出现了「判题机收下了」的信号**，而不是「按钮点过了」。牛客提交
 * 不跳转，还会弹验证码；没过验证码时页面只是弹个错误提示，按钮恢复原样——
 * 拿点击当成功，正是 Timus 上那次谎报成功的翻版。
 */
export async function waitUntilSubmitted({ manual = false } = {}) {
  await waitFor(
    () => {
      const now = readStatus()?.text ?? '';
      if (!now || now === statusBeforeSubmit) return false;
      return ACCEPTED_BY_JUDGE.test(now) || FINAL_VERDICT.test(now);
    },
    { timeoutMs: manual ? MANUAL_WAIT_MS : 30000, label: '判题机收下这一发' },
  ).catch(() => {
    const message = pageError();
    throw new Error(message ? `牛客拒绝了这次提交：${message}` : '提交后没等到判题状态');
  });
}

/** 页面上的错误提示。找不到就返回空串，不要编。 */
function pageError() {
  const raw = (document.body.textContent ?? '').replace(/\s+/g, ' ');
  const known = [/验证码[^。，,.]{0,20}/, /请先登录[^。，,.]{0,20}/, /(?:提交|操作)过于频繁[^。，,.]{0,20}/, /比赛[^。，,.]{0,10}(?:未开始|已结束)/];
  for (const re of known) {
    const hit = re.exec(raw);
    if (hit) return hit[0].trim();
  }
  return '';
}
