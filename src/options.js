import { DEFAULT_SETTINGS } from './shared/platforms.js';

const $ = (id) => document.getElementById(id);
const PLATFORMS = ['luogu', 'codeforces', 'atcoder', 'timus'];

async function load() {
  const stored = await chrome.storage.local.get('settings');
  const s = {
    ...DEFAULT_SETTINGS,
    ...(stored.settings ?? {}),
    language: { ...DEFAULT_SETTINGS.language, ...(stored.settings?.language ?? {}) },
  };
  $('port').value = String(s.port);
  for (const p of PLATFORMS) $(`lang-${p}`).value = s.language[p] ?? '';
  $('o2').checked = Boolean(s.enableO2);
  $('judgeid').value = s.timusJudgeId ?? '';
  $('report').checked = Boolean(s.reportResult);
  $('manual').checked = Boolean(s.manualSubmit);
}

$('save').addEventListener('click', async () => {
  const port = Number($('port').value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    $('saved').textContent = '端口不合法';
    return;
  }
  const language = {};
  for (const p of PLATFORMS) language[p] = $(`lang-${p}`).value.trim();

  await chrome.storage.local.set({
    settings: {
      port,
      language,
      enableO2: $('o2').checked,
      // Judge ID 去掉首尾空格：从网页上复制多半会带一个
      timusJudgeId: $('judgeid').value.trim(),
      reportResult: $('report').checked,
      manualSubmit: $('manual').checked,
    },
  });
  $('saved').textContent = '已保存';
  setTimeout(() => ($('saved').textContent = ''), 2000);
});

void load();
