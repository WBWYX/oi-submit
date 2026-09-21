/**
 * 填表要用的 DOM 小工具。
 *
 * 这里每一个函数都对应一类「直接写会出错、而且错得很安静」的情况，
 * 提交类扩展的绝大部分玄学问题都出在这几处。
 */

/** 等一个条件成立，超时抛错。 */
export function waitFor(condition, { timeoutMs = 30000, label = '条件' } = {}) {
  return new Promise((resolve, reject) => {
    if (condition()) return resolve();
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() >= deadline) {
        clearInterval(timer);
        reject(new Error(`等待超时：${label}`));
      }
    }, 100);
  });
}

/**
 * 等某个选择器出现。
 *
 * 接受一组候选选择器，命中哪个用哪个。这不是过度设计：这些站点改版时通常只动
 * 一处结构，多写一个等价选择器就能扛过去，而写死单个选择器的后果是提交功能
 * 某天突然「卡在那儿不动」，且没有任何报错指向真正的原因。
 *
 * **`root` 不是可选的装饰，是踩过的坑。** 在整个 document 上找通用选择器，
 * 拿到的是「文档里第一个匹配的元素」，而它经常不是你要的那个：Timus 的
 * submit.aspx 上，页头搜索框的 `Search` 按钮排在真正的提交按钮前面，
 * `document.querySelector('input[type=submit]')` 点下去是搜索，不是提交。
 * 凡是页面上可能有同类元素的，都要把 root 收窄到对应的 <form>。
 */
export async function waitForElement(selectors, { timeoutMs = 30000, root = document } = {}) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  let found = null;
  await waitFor(
    () => {
      for (const sel of list) {
        const el = root.querySelector(sel);
        if (el) {
          found = el;
          return true;
        }
      }
      return false;
    },
    { timeoutMs, label: list.join(' | ') },
  );
  return found;
}

/** 找一个文本匹配的元素（按钮、标签页之类没有稳定选择器的东西靠它定位）。 */
export function findByText(selector, pattern, root = document) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return [...root.querySelectorAll(selector)].find((el) => re.test((el.textContent ?? '').trim()));
}

/**
 * 取某个表单自己的提交按钮。
 *
 * 一律从**表单元素**出发，而不是从 document 找一个通用选择器——理由见
 * waitForElement 里那段。form 是浏览器自己维护的归属关系，比任何选择器都可靠。
 */
export function submitButtonOf(form) {
  return form.querySelector('input[type="submit"], button[type="submit"], button:not([type])');
}

/**
 * 给受框架控制的输入框赋值。
 *
 * 直接 `el.value = x` 在 Vue / React 管着的表单里**看起来成功了，实际没生效**：
 * 框架内部维护着自己的一份状态，只有原生 setter 触发的 input 事件才会让它更新。
 * 洛谷（Vue）和 AtCoder 都属于这种，提交上去会发现内容是空的或者还是上一次的。
 *
 * 做法是调原型链上的原生 setter，再手动派发 input / change 事件。
 */
export function setValue(el, value) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** 给 <select> 选值，并派发 change——同上，不派发的话框架侧不会跟着变。 */
export function selectValue(el, value) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** 把 <select> 的选项读成 {value, text} 数组，供 pickOption 按文本匹配。 */
export function optionsOf(select) {
  return [...select.options].map((o) => ({ value: o.value, text: o.textContent ?? '' }));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 反复读取评测状态，直到不再是「评测中」，或超时。
 *
 * @param {() => {text:string, detail?:string, tests?:Array}|null} read 同步读取（扒 DOM）
 * @param {(text:string) => boolean} isFinal 判断是否已经是终态
 * @param {(update:{verdict:string, detail:string, tests:Array, final:boolean}) => void|Promise<void>} onUpdate
 * @param {{readAsync?: () => Promise<{text:string, detail?:string, tests?:Array}|null>}} options
 *
 * 给了 `readAsync` 就优先用它（洛谷走自己的记录接口，比扒 DOM 可靠得多），
 * **失败时自动退回同步的 DOM 读取**——接口挂了至少还能报个总状态，
 * 而不是让人对着一个永远「评测中」的面板。
 *
 * 超时后**仍然回报一次并标记 final**：让 oi-bench 那边的等待有个确定的收尾。
 * 悬着的状态比一个「没等到结果」的结论更糟——人会一直盯着它。
 */
export async function pollVerdict(read, isFinal, onUpdate, options = {}) {
  const { timeoutMs = 120000, intervalMs = 1500, readAsync } = options;
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let lastSnapshot = '';

  for (;;) {
    let got = null;
    if (readAsync) {
      try {
        got = await readAsync();
      } catch {
        got = null; // 接口读不到就退回 DOM
      }
    }
    if (!got) got = read();

    if (got?.text) {
      const update = {
        verdict: got.text,
        detail: got.detail ?? '',
        tests: got.tests ?? [],
        final: isFinal(got.text),
      };
      // 总状态和测试点数量不变时，逐点状态、耗时或通过率仍可能更新。
      const snapshot = JSON.stringify(update);
      if (snapshot !== lastSnapshot) {
        last = update;
        lastSnapshot = snapshot;
        await onUpdate(update);
      }
      if (update.final) return;
    }
    if (Date.now() >= deadline) {
      await onUpdate({
        verdict: last?.verdict || '未知',
        detail: '等待评测结果超时，去页面上看吧',
        tests: last?.tests ?? [],
        final: true,
      });
      return;
    }
    await sleep(intervalMs);
  }
}

/**
 * 点提交，或者在手动模式下把按钮标出来等人自己点。
 *
 * 标出来这件事不是装饰：Timus 的页面上有两个 `Submit` 样子的按钮（页头搜索
 * 也是一个 type=submit），人第一眼未必知道该点哪个——而扩展是知道的，
 * 它刚刚才从表单里找出来。把这个信息画在屏幕上，比写在文档里有用得多。
 *
 * @returns 是否已经替人点了
 */
export function clickOrHighlight(button, manual) {
  if (!manual) {
    button.click();
    return true;
  }
  button.scrollIntoView({ block: 'center', behavior: 'smooth' });
  button.style.outline = '3px solid #f0883e';
  button.style.outlineOffset = '2px';
  // 闪两下，静态描边在花哨的页面上容易被忽略
  let on = true;
  let times = 0;
  const timer = setInterval(() => {
    on = !on;
    button.style.outlineColor = on ? '#f0883e' : 'transparent';
    times += 1;
    if (times >= 6) {
      clearInterval(timer);
      button.style.outlineColor = '#f0883e';
    }
  }, 300);
  return false;
}
