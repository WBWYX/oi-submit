/**
 * LibreOJ 提交与结果回读。
 *
 * 和洛谷一样是 SPA（React + mobx），所以：提交之后**不会重新加载页面**，
 * 内容脚本不会重跑，填完之后得自己留在原文档里接着盯结果。
 *
 * ## 为什么不走它的 API
 *
 * LOJ 有 `POST https://api.loj.ac/api/submission/submit`，但前端注册它时写的是：
 *
 *     $p("submission/submit", { captchaAction: "submit_problem",
 *                               proofOfWorkAction: "submit_problem" })
 *
 * 也就是**每一次提交都要先算一遍工作量证明、再过一次腾讯验证码**
 * （PoW 是开 `navigator.hardwareConcurrency / 2` 个 Worker 暴力找 nonce，
 * 只有拥有 SkipRecaptcha 权限的账号才跳过）。在扩展里复刻这两样既不现实、
 * 也会在 LOJ 调整难度或换验证码供应商的那天悄悄失效。
 *
 * 驱动页面就没有这个问题：PoW 和验证码都是页面自己的事，我们只管填表。
 *
 * ## 控件
 *
 * 代码框是 **Monaco**，语言和编译选项是 **Semantic UI 的自绘下拉**（不是 `<select>`）。
 * 两者都不能直接赋值，见 editor.js 的文件头。
 *
 * ## 一个容易忽略的默认值
 *
 * LOJ 的 C++ 标准默认是 **c++11**（`{name:"std", defaultValue:"c++11"}`），比别家低一大截。
 * 带结构化绑定、`auto` 返回值的代码在洛谷交得好好的，到这儿直接 CE，而人第一反应
 * 是去查自己的代码。所以标准单独可配（设置项 `lojStandard`），默认 c++17。
 * 优化等级 `O` 默认就是 2，不用管。
 */

import {
  clickOrHighlight,
  findByText,
  pollVerdict,
  sleep,
  waitFor,
  waitForElement,
} from './dom.js';
import { pickFromCustomDropdown, setCode } from './editor.js';

/** 手动模式下人要自己点按钮，等待窗口必须足够长（5 分钟）。 */
const MANUAL_WAIT_MS = 300000;

/** Semantic UI 的下拉：触发器是 .ui.dropdown，选项是它里面的 .item。 */
const DROPDOWN = '.ui.dropdown';
const DROPDOWN_ITEM = '.ui.dropdown .menu .item, .ui.dropdown .item';

export async function fill(task) {
  /*
   * 等 Monaco 真的挂上来。SPA 的骨架先渲染、编辑器后加载，等 `.monaco-editor`
   * 比等任意一个容器都准——它出现就意味着可以填了。
   */
  const editorEl = await waitForElement(['.monaco-editor'], { timeoutMs: 30000 });
  const panel = editorEl.closest('form, .ui.segment, .ui.grid') ?? document.body;

  const language = await chooseLanguage(task.language);
  const standard = await chooseStandard(task.lojStandard);

  await setCode(panel, task.sourceCode);

  const submit = findSubmitButton();
  if (!submit) throw new Error('找不到提交按钮（页面结构可能变了）');
  const submitted = clickOrHighlight(submit, task.manualSubmit);

  return {
    language: [language, standard].filter(Boolean).join(' · '),
    submitted,
  };
}

/**
 * 选语言。
 *
 * 语言下拉是页面上第一个 Semantic 下拉，但**不按位置找**——LOJ 的提交面板上
 * 并排着四五个长得一样的下拉（语言、编译器、标准、优化等级、架构），
 * 按位置认迟早认错。这里按"它当前显示的文本是不是一门语言"来认。
 */
async function chooseLanguage(wanted) {
  if (!wanted) return '';
  const trigger = findDropdownByCurrentText(/^(C\+\+|C|Java|Kotlin|Pascal|Python|Rust|Swift|Go|Haskell|C#|F#)$/i);
  if (!trigger) return `（没找到语言下拉，用的是页面当前选项）`;
  const picked = await pickFromCustomDropdown(trigger, wanted, { itemSelector: DROPDOWN_ITEM });
  return picked.ok ? picked.text : `（${picked.text}）`;
}

/**
 * 选 C++ 标准。留空就不动页面上的选项。
 *
 * 标准下拉认的是「当前显示的文本长得像 c++NN / gnu++NN」。
 */
async function chooseStandard(wanted) {
  if (!wanted) return '';
  const trigger = findDropdownByCurrentText(/^(c|gnu)\+\+\d+$/i);
  if (!trigger) return ''; // 非 C++ 语言本来就没有这个下拉，不是错误
  const picked = await pickFromCustomDropdown(trigger, wanted, { itemSelector: DROPDOWN_ITEM });
  return picked.ok ? picked.text : `标准（${picked.text}）`;
}

/** 按「当前显示的文本」找一个自绘下拉。 */
function findDropdownByCurrentText(pattern) {
  return [...document.querySelectorAll(DROPDOWN)].find((el) => {
    const shown = (el.querySelector('.text')?.textContent ?? '').trim();
    return pattern.test(shown);
  });
}

/**
 * 找提交按钮。
 *
 * LOJ 的按钮没有稳定 id，只能按文本找。**限定在 `button` 上**：页面上"提交"
 * 两个字还出现在导航、统计等链接里，放开选择器会点到别处去。
 */
function findSubmitButton() {
  return (
    findByText('button', /^\s*(提交|Submit)\s*$/i) ??
    document.querySelector('button.ui.primary.button, button[type="submit"]')
  );
}

/* ────────────────────────── 结果回读 ────────────────────────── */

const IN_FLIGHT = /pending|waiting|preparing|compiling|running|判题中|等待中|编译中|运行中/i;

export function isResultPage() {
  // 提交后路由切到 /s/<id>
  return /^\/s\/\d+/.test(location.pathname);
}

export function watch(onUpdate) {
  return pollVerdict(readSubmission, (text) => !IN_FLIGHT.test(text), onUpdate, {
    // SPA 里状态由 WebSocket 推，刷得比别家快，poll 间隔相应短一些
    intervalMs: 1200,
  });
}

/**
 * 读评测结果。
 *
 * 总状态和逐点结果**各读各的**：一边读不到不该连累另一边（洛谷那边把两者绑在
 * 一起，总状态的路径猜错就把已经解析好的测试点全丢了）。
 */
function readSubmission() {
  const tests = readTests();
  const text = readOverall() || (tests.length ? tests[tests.length - 1].verdict : '');
  if (!text) return null;

  const detail = [...document.querySelectorAll('.ui.statistic .value, .ui.label')]
    .map((el) => (el.textContent ?? '').trim())
    .filter((t) => /^\d+\s*ms$|^[\d.]+\s*(MiB|KB|MB)$/i.test(t))
    .slice(0, 2)
    .join(' · ');

  return { text, detail, tests };
}

function readOverall() {
  /*
   * LOJ 给结论元素加了状态类名（`status-Accepted` 这类），那是专为这个用途存在的，
   * 比按位置猜稳。找不到再退回到「页面上第一个长得像结论的文本」。
   */
  const tagged = document.querySelector('[class*="status-"], [class*="Status"]');
  const text = (tagged?.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text && text.length < 40) return text;

  const guess = findByText(
    '.ui.header, .ui.label, td',
    /^(Accepted|Wrong Answer|Time Limit Exceeded|Memory Limit Exceeded|Runtime Error|Compilation Error|Partially Correct|通过|答案错误|超出时间限制|超出内存限制|运行错误|编译错误|部分正确)/i,
  );
  return (guess?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * 逐个测试点。
 *
 * LOJ 的测试点是一行一个，标题形如 `#1` / `测试点 #1`，后面跟结论和用时。
 * **只认带编号的**：页面上还有子任务（Subtask）的汇总行，混进来的话测试点数量
 * 会凭空变多（洛谷那边把子任务聚合项当成测试点，28 个报成了 35 个）。
 */
function readTests() {
  const tests = [];
  const seen = new Set();
  for (const row of document.querySelectorAll('.ui.segment, .ui.accordion .title, .ui.list .item, tr')) {
    const raw = (row.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!raw || raw.length > 200) continue;
    const m = /(?:测试点\s*)?#(\d+)\b/.exec(raw);
    if (!m) continue;
    if (/subtask|子任务/i.test(raw)) continue;

    const verdict =
      /(Accepted|Wrong Answer|Time Limit Exceeded|Memory Limit Exceeded|Runtime Error|Output Limit Exceeded|Partially Correct|通过|答案错误|超出时间限制|超出内存限制|运行错误|部分正确)/i.exec(raw)?.[0];
    if (!verdict) continue;

    const index = Number(m[1]);
    if (seen.has(index)) continue;
    seen.add(index);

    const time = /([\d.]+)\s*ms/i.exec(raw);
    const memory = /([\d.]+\s*(?:MiB|KB|MB))/i.exec(raw);
    tests.push({
      index,
      verdict: verdict.trim(),
      ...(time ? { timeText: `${time[1]}ms` } : {}),
      ...(memory ? { memoryText: memory[1] } : {}),
    });
  }
  return tests.sort((a, b) => a.index - b.index);
}

/**
 * 确认真的提交出去了。
 *
 * 判据是**路由切到了 /s/<id>**，不是「按钮不见了」。SPA 里按钮的显隐由状态驱动，
 * 提交失败（PoW 超时、验证码没过、没登录）时按钮同样会短暂变成 loading 再恢复，
 * 拿它当判据会谎报成功——Timus 上栽过一次，不再重犯。
 */
export async function waitUntilSubmitted({ manual = false } = {}) {
  await waitFor(() => isResultPage(), {
    timeoutMs: manual ? MANUAL_WAIT_MS : 60000,
    label: '跳转到提交详情页',
  }).catch(() => {
    const message = pageError();
    throw new Error(message ? `LOJ 拒绝了这次提交：${message}` : '提交后没有跳到提交详情页');
  });
}

/**
 * 页面上的错误提示。找不到就返回空串，不要编。
 *
 * LOJ 用 noty 弹提示，也用 Semantic 的 .ui.negative.message。
 */
function pageError() {
  const alerts = [...document.querySelectorAll('.noty_body, .ui.negative.message, .ui.error.message')]
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (alerts.length) return alerts[0].slice(0, 200);
  if (findByText('a', /^\s*(登录|Login|Sign in)\s*$/i)) return '看起来没有登录（页面上还有登录链接）';
  return '';
}
