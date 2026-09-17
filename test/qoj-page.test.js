import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * 针对真实 QOJ 题目页结构的回归测试。
 *
 * QOJ 的提交表单**整个是 JS 在运行时拼出来的**：页面上只有一个空的
 * `<div id="form-group-answer_answer">`，语言下拉、上传方式单选、代码框都由
 * uoj.js 的 `source_code_form_group('answer_answer', …)` 生成，元素 id 和 name
 * 全是从那个前缀推出来的。
 *
 * 也就是说 content/qoj.js 里的那几个选择器，依据不是这份 HTML，而是 uoj.js 的
 * 那段生成代码——**离线能验的只有前缀和入口**。所以这里钉三件事：
 *
 *   1. 页面上确实是用 `answer_answer` 这个前缀调的（前缀一变，所有 name 全变）；
 *   2. 提交按钮的 id 是 `button-submit-answer`，且**页头搜索按钮排在它前面**
 *      （又一次 Timus 那个坑，见 timus-page.test.js）；
 *   3. 语言选项的 value 形如 `C++17`、文本形如 `C++ 17`，两种写法默认配置都得命中。
 *
 * 夹具是线上页面原样保存的（2026-09），只把 CSRF `_token` 抹成了占位串。
 */

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'fixtures', 'qoj-1000.html'), 'utf8');

test('提交表单用的是 answer_answer 前缀，content/qoj.js 的选择器据此推导', () => {
  /*
   * uoj.js 里：input_language_id = "input-" + name + "_language"，
   * textarea 是 "input-" + name + "_editor"，单选是 name + "_upload_type"。
   * 前缀一变，qoj.js 里 `select[name$="_language"]` 之类还能撑住，
   * 但 `#input-answer_answer_editor` 这种写死的就全废了——所以宁可只依赖后缀。
   */
  assert.match(html, /source_code_form_group\('answer_answer'/);
});

test('提交按钮在 form#form-answer 里，而页头搜索按钮排在它前面', () => {
  const searchAt = html.indexOf('id="submit-search"');
  const submitAt = html.indexOf('id="button-submit-answer"');
  assert.ok(searchAt >= 0, '页面上应当有页头搜索按钮');
  assert.ok(submitAt >= 0, '页面上应当有提交按钮');
  assert.ok(
    searchAt < submitAt,
    '搜索按钮不再排在提交按钮前面了——这条不成立时，本测试的前提要重新检查',
  );

  // 提交按钮必须落在 form#form-answer 的范围里，qoj.js 就是从这个表单出发找的
  const formStart = html.indexOf('id="form-answer"');
  const formEnd = html.indexOf('</form>', formStart);
  assert.ok(formStart >= 0 && formEnd > formStart);
  assert.ok(submitAt > formStart && submitAt < formEnd, '提交按钮不在 form#form-answer 里');
  assert.ok(searchAt < formStart, '搜索按钮落进了提交表单，选择器前提不再成立');
});

test('上传方式单选存在：不点它的话代码框是隐藏的，交上去是空文件', () => {
  /*
   * 这个偏好存在 cookie 里（uoj_source_code_form_group_preferred_upload_type），
   * 上次用过文件上传的话，这次打开代码框就是隐藏的。往隐藏的 textarea 里填代码
   * 不会报任何错，交上去却是一个空文件。
   *
   * 单选本身是 JS 生成的，静态页面里没有，所以这里验的是生成它的那段代码在。
   */
  assert.match(html, /_upload_type|source_code_form_group/);
});

test('语言选项的 value 不带空格、文本带空格，默认配置两种都得命中', () => {
  const optionsHtml = /source_code_form_group\('answer_answer',[^,]+,\s*"([\s\S]*?)",\s*(?:true|false)\)/.exec(html)?.[1];
  assert.ok(optionsHtml, '没抓到语言选项串');
  // 转义过的 HTML：value=\"C++17\">C++ 17<\/option>
  assert.match(optionsHtml, /value=\\"C\+\+17\\"/, 'value 应当是不带空格的 C++17');
  assert.match(optionsHtml, /C\+\+ 17/, '文本应当是带空格的 C++ 17');
});
