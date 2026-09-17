import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_LANGUAGE, pickOption, submitTarget } from '../src/shared/platforms.js';

/**
 * 针对真实 submit.php 页面结构的回归测试。
 *
 * 这一家有一个**会让提交静默变空**的机制，必须钉死：表单挂着
 * `onsubmit="submitEncode()"`，那个函数把代码 base64 之后塞进隐藏的 `_usercode`，
 * 同时把明文 `usercode` 的 name 属性摘掉。也就是说真正发出去的是 `_usercode`。
 *
 * 而程序调用 `form.submit()` **不触发 onsubmit** —— 那样 `_usercode` 是空的，
 * HDU 收到一份空提交而且不报错。所以填表脚本只能点真实按钮。
 * 下面几条就是把这个前提钉下来：只要它们还成立，任何 `form.submit()` 的写法都是错的。
 *
 * 夹具是登录态下原样保存的（2026-09，GB2312），用户名已抹成占位串。
 */

const here = dirname(fileURLToPath(import.meta.url));
// 页面是 GB2312，夹具按原始字节存，用 utf8 读会整页乱码
const html = new TextDecoder('gbk').decode(readFileSync(join(here, 'fixtures', 'hdu-submit.html')));

/** 提交表单那一段（id=submitform），不含页头的两个搜索表单 */
function submitForm() {
  const start = html.indexOf('id="submitform"');
  assert.notEqual(start, -1, '页面上找不到 id=submitform');
  const open = html.lastIndexOf('<form', start);
  return html.slice(open, html.indexOf('</form>', start));
}

test('提交靠 onsubmit 里的 submitEncode，真正发出去的是 _usercode', () => {
  const form = submitForm();
  assert.match(form, /onsubmit="submitEncode\(\)"/i, '表单上没有 onsubmit 了？');
  assert.match(form, /<input[^>]*type="hidden"[^>]*name="_usercode"/i, '隐藏的 _usercode 不见了');

  // submitEncode 的两件事：base64 进 _usercode、把明文那个的 name 摘掉
  assert.match(html, /form\._usercode\.value\s*=\s*btoa\(/, 'submitEncode 不再做 base64 了？');
  assert.match(html, /form\.usercode\.removeAttribute\('name'\)/, '不再摘 usercode 的 name 了？');
});

test('提交表单里只有一个 type=submit，但整页不止一个', () => {
  /*
   * 页头有两个搜索表单，各自带 `value=Search` 的提交按钮，而且排在前面。
   * 所以提交按钮必须从**表单元素**出发去找（submitButtonOf(form)），
   * 不能在 document 上找通用选择器——Timus 那次就是这么点中搜索的。
   */
  const all = [...html.matchAll(/<input[^>]*type="submit"[^>]*>/gi)].map((m) => m[0]);
  const inForm = [...submitForm().matchAll(/<input[^>]*type="submit"[^>]*>/gi)].map((m) => m[0]);
  assert.equal(inForm.length, 1, '提交表单里的 submit 控件不止一个');
  assert.ok(all.length > 1, '整页只有一个 submit？那这条前提就变了');
  assert.match(inForm[0], /value="Submit"/i);
  assert.notEqual(all[0], inForm[0], '文档里第一个 submit 仍然不该是提交按钮');
});

test('填表脚本用到的字段名都还在', () => {
  const form = submitForm();
  for (const sel of [
    /<input[^>]*name="problemid"/i,
    /<select[^>]*name="language"/i,
    /<textarea[^>]*name="usercode"/i,
  ]) {
    assert.match(form, sel, `字段不见了：${sel}`);
  }
});

test('语言选项里有 G++，且默认配置匹配得上', () => {
  const select = /<select[^>]*name="language"[\s\S]*?<\/select>/i.exec(html)?.[0] ?? '';
  const options = [...select.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)/gi)].map((m) => ({
    value: m[1],
    text: m[2].trim(),
  }));
  assert.ok(options.length >= 5, `语言选项只有 ${options.length} 个`);

  const picked = pickOption(options, DEFAULT_LANGUAGE.hdu);
  assert.ok(picked, `默认语言「${DEFAULT_LANGUAGE.hdu}」在页面上匹配不到`);
  assert.equal(picked.text, 'G++');
});

test('验证码那一行默认是隐藏的', () => {
  /*
   * 平时 display:none，HDU 决定要验证时才显示。填表脚本据此判断要不要中止——
   * 读不了图，硬选一个数字只会让提交静默失败。
   */
  const row = /<tr[^>]*id="exe_checkcode"[^>]*>/i.exec(html)?.[0] ?? '';
  assert.ok(row, '验证码那一行不见了，判定逻辑要重新看');
  assert.match(row, /display:\s*none/i, '它默认不再是隐藏的了？那每次提交都会被拦');
  assert.match(html, /<select[^>]*name="check"/i);
});

test('submitTarget 构造的提交页就是这个页面', () => {
  const t = submitTarget('https://acm.hdu.edu.cn/showproblem.php?pid=2609');
  assert.deepEqual(t, {
    platform: 'hdu',
    submitUrl: 'https://acm.hdu.edu.cn/submit.php?pid=2609',
    problemNum: '2609',
    problemKey: '2609',
  });
  // 表单的 action 是相对的 submit.php?action=submit，说明提交页确实是 submit.php
  assert.match(submitForm(), /action="[^"]*submit\.php\?action=submit"/i);
});
