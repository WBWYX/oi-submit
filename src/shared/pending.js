/**
 * session 中的待提交任务。所有读改写排队执行，避免两个标签页覆盖彼此的任务。
 * 保留原来的 pending 存储格式；worker 重启后仍以 session 中的数据为准。
 */
export class PendingTasks {
  #storage;
  #queue = Promise.resolve();

  constructor(storage) {
    this.#storage = storage;
  }

  get(tabId) {
    return this.#run(async () => {
      const { pending } = await this.#storage.get('pending');
      return pending?.[tabId] ?? null;
    });
  }

  /** transform 返回新任务；返回 null/undefined 表示删除。 */
  update(tabId, transform) {
    return this.#run(async () => {
      const stored = await this.#storage.get('pending');
      const pending = stored.pending ?? {};
      const current = pending[tabId] ?? null;
      const next = transform(current) ?? null;
      if (next === current) return next;
      if (next) pending[tabId] = next;
      else delete pending[tabId];
      await this.#storage.set({ pending });
      return next;
    });
  }

  #run(operation) {
    const result = this.#queue.then(operation);
    // 错误交给当前调用方；一次存储失败不能阻塞后续所有任务。
    this.#queue = result.catch(() => {});
    return result;
  }
}
