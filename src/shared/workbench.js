import { SocketIoClient } from './sio.js';

/** 独立只读连接；ICPC 关闭或重启不影响 OI Bench 的提交连接。 */
export function connectWorkbench(fetchPage, onState) {
  const connection = new SocketIoClient('ws://127.0.0.1:27122', { type: 'browser' });
  let generation = 0;
  connection.onState(state => { generation++; onState(state); });
  connection.on('pageFetchRequest', async data => {
    if (typeof data?.requestId !== 'string' || !data.requestId) return;
    const current = generation;
    let result;
    try {
      result = { requestId: data.requestId, ok: true, page: await fetchPage(data) };
    } catch (error) {
      result = { requestId: data.requestId, ok: false, error: String(error?.message ?? error) };
    }
    if (current === generation) connection.emit('pageFetchResult', result);
  });
  connection.connect();
  return connection;
}
