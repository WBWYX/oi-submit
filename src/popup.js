/**
 * 弹窗：只回答两个问题——连上了没有、是不是活动浏览器。
 *
 * 「活动浏览器」这件事必须让人看得见：router 只把提交请求发给第一个连上的浏览器，
 * 开着两个浏览器窗口时提交会跑到另一个里去，而人在这边等得莫名其妙。
 */

const $ = (id) => document.getElementById(id);

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: 'getState' }).catch(() => null);
  if (!state) {
    $('state').textContent = '后台未响应';
    return;
  }
  const connected = state.state === 'connected';
  $('dot').classList.toggle('on', connected);
  $('state').textContent = connected
    ? state.isActive
      ? '已连接 · 活动浏览器'
      : '已连接 · 非活动'
    : state.state === 'connecting'
      ? '连接中…'
      : '未连接';
  $('detail').textContent = connected
    ? state.isActive
      ? `端口 ${state.port}，提交会送到这里`
      : `端口 ${state.port}，提交目前送往另一个浏览器`
    : `连不上 127.0.0.1:${state.port}——VS Code 开着吗？`;

  if (state.lastMessage) {
    $('msg').hidden = false;
    $('msg').textContent = state.lastMessage;
  }
}

$('reconnect').addEventListener('click', async () => {
  $('state').textContent = '重连中…';
  await chrome.runtime.sendMessage({ type: 'reconnect' });
  setTimeout(refresh, 600);
});

$('active').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'setActive' });
  setTimeout(refresh, 400);
});

$('options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'stateChanged') void refresh();
});

void refresh();
