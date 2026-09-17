/**
 * 手写的 socket.io v4 客户端，只实现我们真正用到的那一小块。
 *
 * 为什么不装 socket.io-client：这是个浏览器扩展，要的是「加载解压缩的扩展」就能跑，
 * 不希望为了连一个本机端口而引入一条构建链和一份 40 KB 的依赖。而我们两端都是自己的：
 * 服务端是 oi-bench 的 router，协议版本钉死在 v4，不存在要兼容各种服务端的问题。
 *
 * 帧格式（engine.io packet type + socket.io packet type，都是裸数字前缀）：
 *
 *   收 `0{"sid":...,"pingInterval":25000,"pingTimeout":20000}`  engine.io OPEN
 *   发 `40`                                                     连接默认命名空间
 *   收 `40{"sid":"..."}`                                        命名空间已连接
 *   收 `2`  → 必须回 `3`                                        心跳 PING/PONG
 *   收 `42["事件名",载荷]`                                       服务端事件
 *   发 `42["事件名",载荷]`                                       客户端事件
 *
 * 唯一一处容易写错又不会立刻报错的地方是 **PING 必须回 PONG**：不回的话连接会在
 * pingTimeout 之后被服务端静默掐掉，表现是「用着用着就提交不了了」，而扩展这边
 * 什么错都没有。所以下面对 `2` 的处理不能省。
 *
 * 另外 MV3 的 service worker 空闲 30 秒就会被回收。Chrome 116 起 **WebSocket 上的收发
 * 会重置那个计时器**，而服务端每 15~25 秒发一次 PING，正好把 worker 续住——这不是
 * 巧合而是这套连接能长期存活的原因，换成长轮询就不成立了。
 */

/** 连接状态。 */
export const State = {
  CLOSED: 'closed',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
};

export class SocketIoClient {
  #url;
  #ws = null;
  #state = State.CLOSED;
  #handlers = new Map();
  #onState = () => {};
  #retry = 0;
  #retryTimer = null;
  #closedByUs = false;

  /**
   * @param {string} origin 形如 `ws://127.0.0.1:27121`
   * @param {Record<string,string>} query 握手查询参数（router 靠 type 区分浏览器/编辑器）
   */
  constructor(origin, query = {}) {
    const qs = new URLSearchParams({ EIO: '4', transport: 'websocket', ...query });
    // router 的 socket.io 挂在 /ws 路径下；末尾那个斜杠是 engine.io 的惯例，少了会 404
    this.#url = `${origin}/ws/?${qs.toString()}`;
  }

  get state() {
    return this.#state;
  }

  onState(fn) {
    this.#onState = fn;
  }

  on(event, fn) {
    this.#handlers.set(event, fn);
  }

  emit(event, payload) {
    if (this.#state !== State.CONNECTED || !this.#ws) return false;
    this.#ws.send(`42${JSON.stringify(payload === undefined ? [event] : [event, payload])}`);
    return true;
  }

  connect() {
    this.#closedByUs = false;
    if (this.#state !== State.CLOSED) return;
    this.#setState(State.CONNECTING);

    let ws;
    try {
      ws = new WebSocket(this.#url);
    } catch {
      // 端口没开时构造就会抛；当作一次失败去排重连，不要让异常冒到调用方
      this.#setState(State.CLOSED);
      this.#scheduleRetry();
      return;
    }
    this.#ws = ws;

    ws.onmessage = (ev) => this.#onFrame(String(ev.data));
    ws.onerror = () => {
      /* onclose 一定会跟着来，统一在那里处理 */
    };
    ws.onclose = () => {
      this.#ws = null;
      this.#setState(State.CLOSED);
      if (!this.#closedByUs) this.#scheduleRetry();
    };
  }

  disconnect() {
    this.#closedByUs = true;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#ws?.close();
    this.#ws = null;
    this.#setState(State.CLOSED);
  }

  #onFrame(data) {
    if (data === '2') {
      // 心跳：不回 PONG 连接就会被静默掐掉，见文件头
      this.#ws?.send('3');
      return;
    }
    if (data.startsWith('0')) {
      this.#ws?.send('40'); // engine.io 握手完成，接着连默认命名空间
      return;
    }
    if (data.startsWith('40')) {
      this.#retry = 0;
      this.#setState(State.CONNECTED);
      return;
    }
    if (data.startsWith('42')) {
      let frame;
      try {
        frame = JSON.parse(data.slice(2));
      } catch {
        return; // 解不出来的帧直接丢，不值得为它断连
      }
      if (!Array.isArray(frame) || typeof frame[0] !== 'string') return;
      this.#handlers.get(frame[0])?.(frame[1]);
    }
  }

  #setState(next) {
    if (this.#state === next) return;
    this.#state = next;
    this.#onState(next);
  }

  /**
   * 指数退避重连，上限 30 秒。
   *
   * 不设上限的话，VS Code 关掉一夜之后再打开，扩展可能要等很久才重连上；
   * 而退避太激进又会在 VS Code 没开的时候每秒敲一次本机端口。
   */
  #scheduleRetry() {
    if (this.#closedByUs || this.#retryTimer) return;
    const delay = Math.min(1000 * 2 ** this.#retry, 30000);
    this.#retry += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.connect();
    }, delay);
  }
}
