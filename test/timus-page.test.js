import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * 针对真实 submit.aspx 页面结构的回归测试。
 *
 * 这个文件存在的原因是一个具体的失败：第一版用
 * `document.querySelector('input[type=submit]')` 找提交按钮，而这个页面上
 * **页头搜索框的 Search 按钮排在真正的提交按钮前面**，于是每次都点中搜索——
 * 表单填得好好的，页面跳去 /search.aspx，什么也没提交。
 *
 * 更糟的是当时还用「JudgeID 输入框消失了」当成功判据，搜索页上当然没有那个框，
 * 于是它报告提交成功。**谎报成功的失败比直接报错难查十倍。**
 *
 * 所以这里把页面的那个特征钉下来：文档里第一个 type=submit 不属于提交表单。
 * 只要这条还成立，任何「在整个 document 上找提交按钮」的写法就都是错的。
 *
 * 夹具是线上页面原样保存的（2026-09）。
 */

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'fixtures', 'timus-submit.html'), 'utf8');

/** 把页面切成若干 <FORM>…</FORM> 片段，按出现顺序 */
function forms(source) {
  return [...source.matchAll(/<FORM[\s\S]*?<\/FORM>/gi)].map((m) => ({
    start: m.index ?? 0,
    html: m[0],
  }));
}

function submitButtons(source) {
  return [...source.matchAll(/<INPUT[^>]*TYPE="SUBMIT"[^>]*>/gi)].map((m) => ({
    index: m.index ?? 0,
    value: /VALUE="([^"]*)"/i.exec(m[0])?.[1] ?? '',
  }));
}

test('页面上不止一个 type=submit，且第一个不是提交按钮', () => {
  const buttons = submitButtons(html);
  assert.ok(buttons.length >= 2, `只找到 ${buttons.length} 个提交按钮，夹具可能过期了`);
  assert.equal(buttons[0].value, 'Search', '文档里第一个 type=submit 是搜索按钮，不是提交');
  assert.ok(
    buttons.some((b) => b.value === 'Submit'),
    '真正的提交按钮应该在后面',
  );
});

test('提交表单是含 JudgeID 的那个，而搜索表单排在它前面', () => {
  const all = forms(html);
  const submitForm = all.find((f) => f.html.includes('JudgeID'));
  const searchForm = all.find((f) => !f.html.includes('JudgeID'));
  assert.ok(submitForm, '没找到含 JudgeID 的表单');
  assert.ok(searchForm, '没找到搜索表单');
  /*
   * 顺序正是陷阱所在：先出现的不是我们要的那个。
   * 代码里因此一律从 JudgeID 输入框 closest('form') 出发再找按钮，
   * 而不是在 document 上找一个通用选择器。
   */
  assert.ok(searchForm.start < submitForm.start, '搜索表单应排在提交表单之前');
});

test('提交表单里的字段名与适配代码一致', () => {
  const submitForm = forms(html).find((f) => f.html.includes('JudgeID'))?.html ?? '';
  for (const name of ['JudgeID', 'Language', 'ProblemNum', 'Source']) {
    assert.match(submitForm, new RegExp(`NAME="${name}"`, 'i'), `表单里应有 ${name} 字段`);
  }
  // 这个表单自己只有一个提交按钮，所以按表单取按钮是唯一确定的
  assert.equal(submitButtons(submitForm).length, 1);
  assert.equal(submitButtons(submitForm)[0].value, 'Submit');
});

test('语言选项里有 G++，默认配置匹配得上', () => {
  const options = [...html.matchAll(/<OPTION value="(\d+)"[^>]*>([^<]*)/gi)].map((m) => ({
    value: m[1],
    text: m[2].trim(),
  }));
  assert.ok(options.length > 5, '没解析到语言选项');
  // 默认配的是 'G++'，按文本匹配应当命中 G++ 而不是 GCC（后者是 C 不是 C++）
  const hit = options.find((o) => o.text.toLowerCase().replace(/\s+/g, '').includes('g++'));
  assert.ok(hit, `没有 G++ 选项，实际有：${options.map((o) => o.text).join(' / ')}`);
});
