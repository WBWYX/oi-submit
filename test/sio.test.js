import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SocketIoClient, State } from '../src/shared/sio.js';

/**
 * 手写 socket.io 帧的验收。
 *
 * 用一个假的 WebSocket 把收发记下来。这里测的每一条都对应「不这么做就会在某天
 * 安静地断掉」——尤其是 PING/PONG：不回 PONG 的话连接会在 pingTimeout 之后被
 * 服务端掐掉，而扩展这边不会报任何错，表现是"用着用着就提交不了了"。
 */

/** 装一个假的 WebSocket 全局，返回最近创建的那个实例 */
function installFakeWebSocket() {
  const created = [];
  class FakeWebSocket {
    static CONNECTING = 0;
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.closed = false;
      created.push(this);
    }
    send(data) {
      this.sent.push(data);
    }
    close() {
      this.closed = true;
      this.onclose?.({});
    }
    /** 模拟服务端发来一帧 */
    server(data) {
      this.onmessage?.({ data });
    }
  }
  globalThis.WebSocket = FakeWebSocket;
  return created;
}

test('握手顺序：收 0 → 发 40 → 收 40 → 视为已连接', () => {
  const created = installFakeWebSocket();
  const client = new SocketIoClient('ws://127.0.0.1:27121', { type: 'browser' });
  const states = [];
  client.onState((s) => states.push(s));
  client.connect();

  const ws = created[0];
  assert.match(ws.url, /^ws:\/\/127\.0\.0\.1:27121\/ws\/\?/);
  assert.match(ws.url, /EIO=4/);
  assert.match(ws.url, /transport=websocket/);
  assert.match(ws.url, /type=browser/);

  assert.equal(client.state, State.CONNECTING);
  ws.server('0{"sid":"abc","pingInterval":15000,"pingTimeout":20000}');
  assert.deepEqual(ws.sent, ['40'], '收到 engine.io OPEN 之后要连默认命名空间');

  ws.server('40{"sid":"xyz"}');
  assert.equal(client.state, State.CONNECTED);
  assert.deepEqual(states, [State.CONNECTING, State.CONNECTED]);
});

test('收到 PING 必须回 PONG', () => {
  const created = installFakeWebSocket();
  const client = new SocketIoClient('ws://127.0.0.1:27121');
  client.connect();
  const ws = created[0];
  ws.server('0{"sid":"abc"}');
  ws.server('40{"sid":"xyz"}');
  ws.sent.length = 0;

  ws.server('2');
  assert.deepEqual(ws.sent, ['3'], '不回 PONG 的话连接会在 pingTimeout 之后被静默掐掉');
});

test('事件帧派发给对应的处理函数', () => {
  const created = installFakeWebSocket();
  const client = new SocketIoClient('ws://127.0.0.1:27121');
  const got = [];
  client.on('submitRequest', (p) => got.push(p));
  client.on('status', (p) => got.push(p));
  client.connect();
  const ws = created[0];
  ws.server('0{"sid":"abc"}');
  ws.server('40{"sid":"xyz"}');

  ws.server('42["status",{"isActive":true}]');
  ws.server('42["submitRequest",{"url":"https://codeforces.com/contest/1/problem/A","sourceCode":"int main(){}"}]');
  assert.deepEqual(got[0], { isActive: true });
  assert.equal(got[1].url, 'https://codeforces.com/contest/1/problem/A');
});

test('没注册的事件与坏帧都不会把连接搞挂', () => {
  const created = installFakeWebSocket();
  const client = new SocketIoClient('ws://127.0.0.1:27121');
  client.connect();
  const ws = created[0];
  ws.server('0{"sid":"abc"}');
  ws.server('40{"sid":"xyz"}');

  ws.server('42["谁也没听这个事件",1]');
  ws.server('42{坏的 JSON');
  ws.server('');
  assert.equal(client.state, State.CONNECTED, '坏帧只该被丢掉，不该断连');
});

test('emit 在没连上时返回 false 而不是抛异常', () => {
  installFakeWebSocket();
  const client = new SocketIoClient('ws://127.0.0.1:27121');
  // 连都没连就发：调用方（后台）据此退回到「只记一条本地消息」
  assert.equal(client.emit('submitResult', { ok: true }), false);
});

test('emit 发出的是标准的 42 事件帧', () => {
  const created = installFakeWebSocket();
  const client = new SocketIoClient('ws://127.0.0.1:27121');
  client.connect();
  const ws = created[0];
  ws.server('0{"sid":"abc"}');
  ws.server('40{"sid":"xyz"}');
  ws.sent.length = 0;

  client.emit('submitResult', { ok: true, message: '已提交' });
  assert.equal(ws.sent[0], '42["submitResult",{"ok":true,"message":"已提交"}]');

  client.emit('setActive');
  assert.equal(ws.sent[1], '42["setActive"]', '无载荷的事件不该多带一个 undefined');
});

test('主动断开之后不再重连', async () => {
  const created = installFakeWebSocket();
  const client = new SocketIoClient('ws://127.0.0.1:27121');
  client.connect();
  created[0].server('0{"sid":"abc"}');
  created[0].server('40{"sid":"xyz"}');

  client.disconnect();
  assert.equal(client.state, State.CLOSED);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(created.length, 1, '人为断开就该停住，不然选项页改端口时会连出两条');
});
