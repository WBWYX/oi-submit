/**
 * 往各家的代码编辑器里塞代码。
 *
 * 七个平台用了四种编辑器，而**没有一种能靠 `el.value = code` 搞定**：
 *
 *   | 平台            | 编辑器          | 为什么不能直接赋值 |
 *   |-----------------|-----------------|--------------------|
 *   | Codeforces/Timus| 原生 textarea   | 能，走 setValue 就行 |
 *   | 洛谷            | CodeMirror 6    | 是 contenteditable，没有 value |
 *   | 牛客            | CodeMirror 5    | textarea 是隐藏的，真正的内容在 CM 的 model 里 |
 *   | LOJ             | Monaco          | 同上，而且 Monaco 只渲染可见的那几行 |
 *   | QOJ             | textarea（可能挂 CM5）| 看用户开没开「高级编辑器」 |
 *
 * CM5 和 Monaco 的共同点是：**页面 JS 持有 model，DOM 上那个 textarea 只是输入口**。
 * 内容脚本跑在隔离世界里，拿不到页面的 JS 对象（`el.CodeMirror` 这种页面挂上去的
 * 属性，在内容脚本里是看不见的），所以没法调 `setValue`。
 *
 * 能走的路只有一条：**装成用户在粘贴**。两种编辑器都监听那个隐藏输入框上的
 * `paste` 事件并从 `clipboardData` 读文本——这正是人按 Ctrl+V 时发生的事。
 * 合成事件的 `isTrusted` 是 false，但这两家都不检查它。
 *
 * 为什么不注入 MAIN world 脚本去调 `monaco.editor.getModels()[0].setValue()`：
 * 那要求页面把 monaco 挂在 window 上，而 LOJ 是用 vite 打包的，没有这个全局；
 * 而且多一条注入路径就多一份「页面改版后静默失效」的可能。粘贴这条路只依赖
 * 编辑器对用户输入的处理，那是它最不可能改的部分。
 */

import { setValue, sleep } from './dom.js';

/**
 * 把代码写进编辑器，自动识别是哪一种。
 *
 * @param {Element} root 在哪个范围里找编辑器（提交表单或提交面板），收窄它很重要：
 *   页面上常有不止一个编辑器（牛客的「自测输入」、LOJ 的评论框都是），
 *   在整个 document 上找会写进错的那个，而且不报错。
 * @param {string} code
 * @returns {Promise<string>} 实际用了哪条路径，供回报时说明
 */
export async function setCode(root, code) {
  const monaco = root.querySelector('.monaco-editor');
  if (monaco) {
    await pasteInto(monaco.querySelector('textarea.inputarea') ?? monaco.querySelector('textarea'), code);
    return 'monaco';
  }

  const cm5 = root.querySelector('.CodeMirror');
  if (cm5) {
    await pasteInto(cm5.querySelector('textarea'), code);
    return 'codemirror5';
  }

  // CodeMirror 6：contenteditable，改 innerText 能生效（洛谷走的就是这条）
  const cm6 = root.querySelector('.cm-content');
  if (cm6) {
    cm6.focus();
    cm6.innerText = '';
    await sleep(50);
    cm6.innerText = code;
    cm6.dispatchEvent(new Event('input', { bubbles: true }));
    return 'codemirror6';
  }

  const textarea = root.querySelector('textarea:not([style*="display: none"]):not([style*="display:none"])') ?? root.querySelector('textarea');
  if (textarea) {
    setValue(textarea, code);
    return 'textarea';
  }

  throw new Error('没找到代码编辑器');
}

/**
 * 往隐藏输入框里「粘贴」。
 *
 * 顺序是：聚焦 → 全选（把里面已有的内容选中，粘贴时才会被替换）→ 派发 paste。
 *
 * **全选这一步不能省。** 编辑器里常常已经有内容——上次没交完的代码、平台预填的
 * 模板（牛客每种语言都有模板）。不选中就粘贴的话，新代码会插在光标处，交上去是
 * 两份代码拼在一起，而编译错误的位置会指向一个你根本没写过的地方。
 */
async function pasteInto(input, code) {
  if (!input) throw new Error('编辑器里没有可输入的元素');

  input.focus();
  await sleep(50);

  selectAll(input);
  await sleep(30);

  const data = new DataTransfer();
  data.setData('text/plain', code);
  const pasted = input.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
  );
  await sleep(120);

  /*
   * `dispatchEvent` 返回 false 说明有人 preventDefault 了——对编辑器来说这**正是
   * 成功的标志**：它接管了这次粘贴。返回 true 反而可疑，多半是没人处理，
   * 于是退回到 execCommand 再试一次（它走的是浏览器的编辑命令通道）。
   */
  if (pasted) {
    selectAll(input);
    await sleep(30);
    // eslint-disable-next-line deprecation/deprecation -- 没有等价替代，见文件头
    document.execCommand('insertText', false, code);
    await sleep(120);
  }
}

/** 全选当前输入框的内容。 */
function selectAll(input) {
  if (typeof input.select === 'function') {
    input.select();
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(input);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * 在一组自绘下拉里按文本选项。
 *
 * 洛谷、LOJ 这类前端框架画出来的下拉不是 `<select>`，选不了值只能点：
 * 先点开触发器，再在展开的列表里按文本找条目点掉。
 *
 * **找不到就不点，并把这件事说出来**——绝不「挑一个最像的」。选错语言直接 CE，
 * 而人多半会先去怀疑自己的代码。
 *
 * @returns {Promise<{ok: boolean, text: string}>} ok=false 时 text 是说明
 */
export async function pickFromCustomDropdown(trigger, wanted, { itemSelector, timeoutMs = 3000 } = {}) {
  if (!trigger) return { ok: false, text: '没找到下拉控件' };
  trigger.click();
  await sleep(200);

  const target = String(wanted).toLowerCase().replace(/\s+/g, '');
  let item = null;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const candidates = [...document.querySelectorAll(itemSelector)];
    item = candidates.find((el) => (el.textContent ?? '').toLowerCase().replace(/\s+/g, '') === target);
    // 精确匹配优先；没有再退一步用包含，避免 "C++" 命中 "C++ with something"
    if (!item) item = candidates.find((el) => (el.textContent ?? '').toLowerCase().replace(/\s+/g, '').includes(target));
    if (item || Date.now() >= deadline) break;
    await sleep(100);
  }

  if (!item) {
    document.body.click(); // 收起下拉，别把展开的菜单留着挡住提交按钮
    return { ok: false, text: `没找到「${wanted}」，用的是页面当前选项` };
  }
  item.click();
  await sleep(150);
  return { ok: true, text: (item.textContent ?? '').trim() };
}
