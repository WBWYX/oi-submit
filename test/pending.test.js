import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PendingTasks } from '../src/shared/pending.js';

function sessionStorage(initial = {}) {
  let data = structuredClone(initial);
  return {
    async get() {
      return structuredClone(data);
    },
    async set(value) {
      data = { ...data, ...structuredClone(value) };
    },
  };
}

test('并发收到两个提交时，两个标签页的任务都保存下来', async () => {
  const tasks = new PendingTasks(sessionStorage());
  await Promise.all([
    tasks.update(1, () => ({ requestId: 'a', phase: 'fill' })),
    tasks.update(2, () => ({ requestId: 'b', phase: 'fill' })),
  ]);
  assert.equal((await tasks.get(1)).requestId, 'a');
  assert.equal((await tasks.get(2)).requestId, 'b');
});

test('关闭一个标签页与另一个标签页切换阶段同时发生，不丢任务也不恢复已关闭的任务', async () => {
  const tasks = new PendingTasks(sessionStorage({
    pending: { 1: { phase: 'fill' }, 2: { phase: 'fill' } },
  }));
  await Promise.all([
    tasks.update(1, () => null),
    tasks.update(2, (task) => ({ ...task, phase: 'watch' })),
    tasks.update(1, (task) => task && { ...task, phase: 'watch' }),
  ]);
  assert.equal(await tasks.get(1), null);
  assert.deepEqual(await tasks.get(2), { phase: 'watch' });
});

test('pageReady 读取会等前面的保存完成，worker 重启后继续读取原来的 session', async () => {
  const storage = sessionStorage();
  const tasks = new PendingTasks(storage);
  const task = { requestId: 'a', phase: 'watch', sourceCode: 'int main(){}' };
  const [, saved] = await Promise.all([
    tasks.update(1, () => task),
    tasks.get(1),
  ]);
  assert.deepEqual(saved, task);
  assert.deepEqual(await new PendingTasks(storage).get(1), task);
});

test('一次存储失败会回报给调用方，但后续任务仍可保存', async () => {
  const storage = sessionStorage();
  const set = storage.set;
  let fail = true;
  storage.set = async (value) => {
    if (fail) {
      fail = false;
      throw new Error('storage unavailable');
    }
    return set(value);
  };
  const tasks = new PendingTasks(storage);
  const failed = tasks.update(1, () => ({ requestId: 'a' }));
  const saved = tasks.update(2, () => ({ requestId: 'b' }));
  await assert.rejects(failed, /storage unavailable/);
  await saved;
  assert.equal(await tasks.get(1), null);
  assert.deepEqual(await tasks.get(2), { requestId: 'b' });
});
