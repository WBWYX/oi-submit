import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollVerdict } from '../src/content/dom.js';

test('测试点数量不变时回传状态与详情变化，重复的快照只发送一次', async () => {
  const snapshots = [
    { text: '评测中', detail: '0/1', tests: [{ verdict: '等待中' }] },
    { text: '评测中', detail: '0/1', tests: [{ verdict: '等待中' }] },
    { text: '评测中', detail: '0/1', tests: [{ verdict: '通过' }] },
    { text: '评测中', detail: '1/1', tests: [{ verdict: '通过' }] },
    { text: '通过', detail: '1/1', tests: [{ verdict: '通过' }] },
  ];
  const updates = [];
  await pollVerdict(
    () => snapshots.shift(),
    (text) => text === '通过',
    (update) => updates.push(update),
    { intervalMs: 0 },
  );
  assert.equal(updates.length, 4);
  assert.equal(updates[1].tests[0].verdict, '通过');
  assert.equal(updates[2].detail, '1/1');
  assert.equal(updates[3].final, true);
});

test('异步接口失败时回退 DOM，并等最终回传完成后才结束', async () => {
  const updates = [];
  await pollVerdict(
    () => ({ text: '通过' }),
    () => true,
    async (update) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      updates.push(update);
    },
    { readAsync: async () => { throw new Error('offline'); } },
  );
  assert.deepEqual(updates, [{ verdict: '通过', detail: '', tests: [], final: true }]);
});

test('超时回传最后一次测试点结果，不清空已收到的评测进度', async () => {
  const updates = [];
  const tests = [{ verdict: '通过' }, { verdict: '等待中' }];
  await pollVerdict(
    () => ({ text: '评测中', tests }),
    () => false,
    (update) => updates.push(update),
    { timeoutMs: 0 },
  );
  assert.equal(updates.length, 2);
  assert.deepEqual(updates[1].tests, tests);
  assert.equal(updates[1].verdict, '评测中');
  assert.match(updates[1].detail, /超时/);
  assert.equal(updates[1].final, true);
});

test('没有读到任何状态时，超时也会确定收尾', async () => {
  const updates = [];
  await pollVerdict(() => null, () => false, (update) => updates.push(update), { timeoutMs: 0 });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].verdict, '未知');
  assert.deepEqual(updates[0].tests, []);
  assert.equal(updates[0].final, true);
});
