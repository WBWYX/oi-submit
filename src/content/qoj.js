/**
 * QOJ（UOJ-System）提交与结果回读。
 *
 * 表单是老实的 POST 表单（带 CSRF `_token`），但**整个表单是 JS 在运行时拼出来的**：
 * 页面上只有一个空的 `<div id="form-group-answer_answer">`，语言下拉、上传方式单选、
 * 代码框都由 uoj.js 的 `source_code_form_group('answer_answer', …)` 生成。
 * 所以不能假设元素一开始就在，得等。
 *
 * 生成出来的东西（名字全由那个前缀推出来，见 uoj.js）：
 *   语言    <select id="input-answer_answer_language" name="answer_answer_language">
 *   上传方式 <input type="radio" name="answer_answer_upload_type" value="editor|file">
 *   代码    <textarea id="input-answer_answer_editor" name="answer_answer_editor">
 *   提交    <button id="button-submit-answer" name="submit-answer">
 *
 * ## 三个坑
 *
 * 1. **提交面板默认是收起来的。** 表单在 Bootstrap 标签页 `#tab-submit-answer` 里，
 *    而 uoj.js 里没有任何处理 location.hash 的代码——带锚点打开也不会展开。
 *    得点一下那个标签。
 *
 * 2. **上传方式可能停在「本地文件」。** 这个偏好存在 cookie 里
 *    （`uoj_source_code_form_group_preferred_upload_type`），上次用过文件上传的话，
 *    这次打开代码框是隐藏的。往一个隐藏的 textarea 里填代码不会报错，
 *    交上去的却是一个空文件。所以必须先把「编辑器」那个单选点上。
 *
 * 3. **高级编辑器（CodeMirror 5）会吃掉填进 textarea 的内容。** 用户勾过
 *    「use advanced editor」的话，CM 接管了 textarea，提交时它会把自己的内容
 *    写回去，覆盖我们填的。而且它是**异步挂载**的（`check_advanced_init` 轮询等
 *    面板可见后才 require CodeMirror），所以时序上还可能在我们填完之后才接管。
 *    处理办法见 detachAdvancedEditor。
 *
 * 另：页头搜索框的按钮 `#submit-search` 在文档里排在真正的提交按钮前面——
 * 又一次 Timus 那个坑。所有查找都从表单出发。
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
import { setCode } from './editor.js';

/** 手动模式下人要自己点按钮，等待窗口必须足够长（5 分钟）。 */
const MANUAL_WAIT_MS = 300000;

export async function fill(task) {
  await openSubmitTab();

  const form = await waitForElement(['form#form-answer']);

  // 上传方式先摆正，否则代码框是隐藏的，交上去是个空文件（见文件头坑 2）
  const editorRadio = form.querySelector('input[type="radio"][name$="_upload_type"][value="editor"]');
  if (editorRadio && !editorRadio.checked) {
    editorRadio.click();
    await sleep(200);
  }

  const language = await chooseLanguage(form, task.language);

  await detachAdvancedEditor(form);
  await setCode(form, task.sourceCode);
  // 高级编辑器可能在我们填完之后才异步挂上来（见文件头坑 3），再确认一次
  await sleep(300);
  if (await detachAdvancedEditor(form)) await setCode(form, task.sourceCode);

  const submit = form.querySelector('#button-submit-answer, button[name="submit-answer"]');
  if (!submit) throw new Error('找不到提交按钮（页面结构可能变了）');
  const submitted = clickOrHighlight(submit, task.manualSubmit);

  return { language, submitted };
}

/**
 * 展开提交标签页。
 *
 * 已经展开（表单可见）就不动。找标签靠 `href="#tab-submit-answer"`，那是 UOJ
 * 自己的约定，比按文本找 "Submit" 稳——页面语言可能是中文。
 */
async function openSubmitTab() {
  const form = document.querySelector('form#form-answer');
  if (form && form.offsetParent !== null) return;

  const tab =
    document.querySelector('a[href="#tab-submit-answer"]') ??
    findByText('a[data-toggle="tab"]', /^\s*(Submit|提交)\s*$/i);
  if (tab) {
    tab.click();
    await sleep(300);
  }
  await waitForElement(['form#form-answer'], { timeoutMs: 20000 });
}

/**
 * 选语言。
 *
 * QOJ 的 `<select>` 是原生的，但**它是 JS 生成的**，所以要等。
 * 选项文本是 `C++ 17`、value 是 `C++17`——pickOption 归一化时会去掉空白，
 * 两种写法都命中。
 */
async function chooseLanguage(form, wanted) {
  if (!wanted) return '';
  const select = await waitForElement(['select[name$="_language"]'], { root: form, timeoutMs: 15000 });
  const option = pickOption(optionsOf(select), wanted);
  if (!option) {
    return `${select.selectedOptions[0]?.textContent?.trim() ?? ''}（没找到「${wanted}」，用的是页面当前选项）`;
  }
  selectValue(select, option.value);
  return option.text.trim();
}

/**
 * 把 CodeMirror 高级编辑器摘掉，让 textarea 重新变成真正的输入口。
 *
 * 做法是**点那个「use advanced editor」复选框**：uoj.js 的处理函数在取消勾选时
 * 会调 `advanced_editor.toTextArea()`，把内容交还给 textarea 并解除接管。
 * 内容脚本没法直接调页面的 JS 对象，但点击是真的 DOM 事件，jQuery 的处理函数照样跑。
 *
 * @returns 是否真的摘掉了（调用方据此决定要不要重填一次）
 */
async function detachAdvancedEditor(form) {
  if (!form.querySelector('.CodeMirror')) return false;

  const boxes = [...form.querySelectorAll('input[type="checkbox"]')].filter((box) => box.checked);
  /*
   * 按标签文本认最准，但那句话是本地化的（uojLocale('editor::use advanced editor')），
   * 站点换个语言就认不出来了。而认不出的后果是代码被 CodeMirror 覆盖成空的——
   * 属于"交上去才发现"的那类失败。所以认不出时退一步：这个表单里勾上的复选框
   * 本来就只有这一个（见 uoj.js 的 source_code_form_group），直接点它。
   */
  const checkbox =
    boxes.find((box) => /advanced|高级/i.test(box.closest('label')?.textContent ?? '')) ?? boxes[0];
  if (!checkbox) return false;

  checkbox.click();
  await sleep(250);
  return !form.querySelector('.CodeMirror');
}

/* ────────────────────────── 结果回读 ────────────────────────── */

/** UOJ 的评测中状态 */
const IN_FLIGHT = /waiting|judging|judged|pending|compiling|running|评测中|等待/i;

export function isResultPage() {
  // 提交后跳到 /submission/<id>；提交列表页 /submissions 也能读到最新一条
  return /\/submission(s)?(\/|$)/.test(location.pathname);
}

export function watch(onUpdate) {
  return pollVerdict(readSubmission, (text) => !IN_FLIGHT.test(text), onUpdate);
}

/**
 * 读评测结果。
 *
 * UOJ 的提交详情页上，总状态在 `.uoj-content` 顶部的 badge/表格里，
 * 逐个测试点在下面的 `.card` 列表里，每个测试点一张卡片，标题形如
 * `Test #3: Accepted, 100 points, 15ms, 3.2 MiB`。
 *
 * **总状态读不到时不放弃逐点结果**（反过来也一样）：这两件事各读各的。
 * 早先在洛谷那边把它们绑在一起，总状态的路径猜错就把已经正确解析的测试点全丢了。
 */
function readSubmission() {
  const tests = readTests();
  const text = readOverall() || (tests.length ? tests[tests.length - 1].verdict : '');
  if (!text) return null;

  const detail = [...document.querySelectorAll('.uoj-content td, .uoj-content .badge')]
    .map((el) => (el.textContent ?? '').trim())
    .filter((t) => /^\d+\s*ms$|^[\d.]+\s*(MiB|KB|MB)$/i.test(t))
    .slice(0, 2)
    .join(' · ');

  return { text, detail, tests };
}

function readOverall() {
  /*
   * 优先找带 `result-` 类名的元素（UOJ 给结论加的类，如 `result-ac`、`result-wa`），
   * 它专为这个用途存在，比按位置猜稳得多。
   */
  const tagged = document.querySelector('[class*="result-"], .uoj-status-text');
  const text = (tagged?.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text;

  const row = document.querySelector('table.table tbody tr');
  const cells = [...(row?.querySelectorAll('td') ?? [])].map((td) => (td.textContent ?? '').trim());
  return cells.find((t) => /accepted|wrong|time limit|memory|runtime|compile|^\d+$/i.test(t)) ?? '';
}

/**
 * 逐个测试点。
 *
 * 卡片标题形如 `Test #3: Accepted, 100 points, 15ms, 3.2 MiB`。
 * 只认带 `Test #<数字>` 的那些——UOJ 的页面上还有「子任务」「Extra Test」这类
 * 聚合卡片，混进来的话测试点数量会凭空变多（洛谷那边就因为把子任务聚合项
 * 当成测试点，把 28 个点报成了 35 个）。
 */
function readTests() {
  const tests = [];
  for (const card of document.querySelectorAll('.card-header, .panel-heading, .uoj-test-title')) {
    const raw = (card.textContent ?? '').replace(/\s+/g, ' ').trim();
    const m = /^Test\s*#(\d+)\s*[:：]\s*([^,，]+)/i.exec(raw);
    if (!m) continue;
    const time = /([\d.]+)\s*ms/i.exec(raw);
    const memory = /([\d.]+\s*(?:MiB|KB|MB))/i.exec(raw);
    tests.push({
      index: Number(m[1]),
      verdict: (m[2] ?? '').trim(),
      ...(time ? { timeText: `${time[1]}ms` } : {}),
      ...(memory ? { memoryText: memory[1] } : {}),
    });
  }
  return tests;
}

/**
 * 确认真的提交出去了。
 *
 * 判据是**到了提交详情页**，不是「表单不见了」——理由见 timus.js 文件头那段。
 * 没跳转通常意味着 QOJ 打回了这一发（没登录、比赛没开始、交得太频繁），
 * 页面上那句说明原样带回去。
 */
export async function waitUntilSubmitted({ manual = false } = {}) {
  await waitFor(() => isResultPage(), {
    timeoutMs: manual ? MANUAL_WAIT_MS : 20000,
    label: '跳转到提交详情页',
  }).catch(() => {
    const message = pageError();
    throw new Error(message ? `QOJ 拒绝了这次提交：${message}` : '提交后没有跳转到提交详情页');
  });
}

/** 页面上的错误提示。找不到就返回空串，不要编。 */
function pageError() {
  const alerts = [...document.querySelectorAll('.alert-danger, .help-block, .invalid-feedback')]
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (alerts.length) return alerts[0].slice(0, 200);
  if (document.querySelector('a[href*="/login"]')) return '看起来没有登录（页面上还有登录链接）';
  return '';
}
