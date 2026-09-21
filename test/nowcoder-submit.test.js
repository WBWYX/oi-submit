import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observeSubmission, waitUntilSubmitted } from '../src/content/nowcoder.js';

for (const text of ['已提交', '等待评测']) {
  test(`牛客已接收：${text} 应结束手动提交等待`, async t => {
    const previous = globalThis.document;
    globalThis.document = { querySelector: () => ({ textContent: text }), body: { textContent: text } };
    t.after(() => { globalThis.document = previous; });
    t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const result = waitUntilSubmitted({ manual: true });
    t.mock.timers.tick(300001);
    await assert.doesNotReject(result);
  });
}

function page(t, initial) {
  let notify;
  const oldDocument = globalThis.document, oldObserver = globalThis.MutationObserver;
  const area = { textContent: initial, nodeType: 1, closest: () => area };
  globalThis.document = { querySelector: () => area, body: area };
  globalThis.MutationObserver = class {
    constructor(fn) { notify = fn; }
    observe() {}
    disconnect() {}
  };
  t.after(() => { globalThis.document = oldDocument; globalThis.MutationObserver = oldObserver; });
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  observeSubmission();
  return { area, notify: records => notify(records) };
}

test('新旧结果同为 AC，短暂评测状态不能被 100ms 轮询漏掉', async t => {
  const { area, notify } = page(t, '答案正确');
  const result = waitUntilSubmitted({ manual: true });
  area.textContent = '评测中';
  notify([]);
  area.textContent = '答案正确';
  notify([]);
  t.mock.timers.tick(100);
  await assert.doesNotReject(result);
});

test('同一轮 DOM 更新结束前已恢复旧结论，仍能根据中间状态确认接收', async t => {
  const { area, notify } = page(t, '答案正确');
  const result = waitUntilSubmitted({ manual: true });
  notify([{ target: area, oldValue: '正在评测', removedNodes: [] }]);
  t.mock.timers.tick(100);
  await assert.doesNotReject(result);
});

test('旧 AC 没有新评测证据时不能谎报提交成功', async t => {
  const { notify } = page(t, '答案正确');
  const result = waitUntilSubmitted({ manual: true });
  notify([]);
  t.mock.timers.tick(300001);
  await assert.rejects(result, /没等到判题状态/);
});

test('只移除填表前已有的排队文字，不算本次提交证据', async t => {
  const { area, notify } = page(t, '等待评测');
  const result = waitUntilSubmitted({ manual: true });
  area.textContent = '';
  notify([{ target: area, oldValue: '等待评测', removedNodes: [] }]);
  t.mock.timers.tick(300001);
  await assert.rejects(result, /没等到判题状态/);
});

test('验证码拒绝且旧 AC 保留时，不把点击误当成功', async t => {
  const { area, notify } = page(t, '答案正确');
  const result = waitUntilSubmitted({ manual: true });
  area.textContent = '答案正确 验证码错误';
  notify([]);
  t.mock.timers.tick(300001);
  await assert.rejects(result, /验证码/);
});

test('状态区同时含旧终局和新排队状态，优先读取本次排队', async t => {
  const { area } = page(t, '答案正确');
  area.textContent = '答案正确 等待评测';
  await assert.doesNotReject(waitUntilSubmitted({ manual: true }));
});
