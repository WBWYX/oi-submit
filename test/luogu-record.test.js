import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectTestCases } from '../src/content/luogu.js';

/**
 * 洛谷记录接口的测试点提取。
 *
 * 这是四个平台里唯一能拿到**逐个测试点**结果的地方（CF 和 Timus 只说卡在第几个，
 * AtCoder 要在详情页才有表），所以值得单独测。
 *
 * 提取用的是「遍历找特征」而不是写死 `currentData.record.detail.judgeResult.subtasks[]`
 * 这条路径：分子任务的题目多一层嵌套、不分子任务的少一层，而这个结构洛谷改过不止一次。
 * 下面的用例把两种形态都覆盖掉。
 */

test('不分子任务：一层 testCases', () => {
  const json = {
    currentData: {
      record: {
        status: 12,
        score: 100,
        detail: {
          judgeResult: {
            subtasks: [
              {
                score: 100,
                status: 12,
                testCases: [
                  { id: 1, status: 12, time: 15, memory: 1024, score: 50 },
                  { id: 2, status: 12, time: 20, memory: 1100, score: 50 },
                ],
              },
            ],
          },
        },
      },
    },
  };
  const cases = collectTestCases(json);
  assert.equal(cases.length, 2);
  assert.deepEqual(cases[0], { index: 1, verdict: 'AC', timeMs: 15, memoryKb: 1024, score: 50 });
});

test('分子任务：多个子任务的测试点按顺序摊平', () => {
  const json = {
    currentData: {
      record: {
        detail: {
          judgeResult: {
            subtasks: [
              { status: 12, testCases: [{ id: 1, status: 12, time: 10, memory: 500 }] },
              {
                status: 6,
                testCases: [
                  { id: 2, status: 12, time: 11, memory: 520 },
                  { id: 3, status: 6, time: 12, memory: 530 },
                ],
              },
            ],
          },
        },
      },
    },
  };
  const cases = collectTestCases(json);
  assert.equal(cases.length, 3);
  assert.deepEqual(
    cases.map((c) => c.verdict),
    ['AC', 'AC', '答案错误'],
  );
  // 摊平之后重新编号，面板上显示的就是「第几个测试点」
  assert.deepEqual(
    cases.map((c) => c.index),
    [1, 2, 3],
  );
});

test('各种状态码都翻成人话', () => {
  const build = (codes) => ({
    subtasks: [{ testCases: codes.map((status, i) => ({ id: i, status, time: 1, memory: 1 })) }],
  });
  const cases = collectTestCases(build([12, 6, 5, 4, 7, 2, 3]));
  assert.deepEqual(
    cases.map((c) => c.verdict),
    ['AC', '答案错误', '超时', '内存超限', '运行错误', '编译错误', '输出超限'],
  );
});

test('没见过的状态码原样显示，绝不当成 AC', () => {
  /*
   * 把未知状态显示成 AC 是这里最坏的一种错：人看到一片绿就以为过了。
   * 宁可显示成「状态99」这种难看但诚实的东西。
   */
  const cases = collectTestCases({ testCases: [{ id: 1, status: 99, time: 1, memory: 1 }] });
  assert.equal(cases[0].verdict, '状态99');
});

test('返回体里没有测试点时给空数组，不抛异常', () => {
  // 编译错误的记录就没有测试点；评测刚开始时也没有
  assert.deepEqual(collectTestCases({ currentData: { record: { status: 2 } } }), []);
  assert.deepEqual(collectTestCases(null), []);
  assert.deepEqual(collectTestCases({}), []);
});

test('不把普通对象误当成测试点', () => {
  /*
   * 判据是「有数字 status，且有 time 或 memory」。记录里还有别的带 status 的对象
   * （比如记录自身、子任务），它们没有 time/memory，不该被算进测试点。
   */
  const json = {
    currentData: {
      record: { status: 12, score: 100, user: { id: 333, name: 'x' } },
      testCaseGroup: { 1: [1, 2, 3] },
    },
  };
  assert.deepEqual(collectTestCases(json), []);
});

/* ────────── 总状态与逐点结果必须互不牵连 ────────── */

import {
  fetchRecordForTest,
  overallOfForTest,
  readFromApiForTest,
  readInjectedForTest,
} from '../src/content/luogu.js';

test('总状态认不出来时，测试点照样报上去', async () => {
  /*
   * 这是实际踩到的那个 bug：我把总状态的字段路径猜错了一次，
   * 而当时的代码是「总状态取不到就整个作废」，于是已经正确解析出来的
   * 测试点也被一起丢掉——面板上总状态有、逐点空着，还没有任何线索。
   */
  const weird = { 某个没见过的包装: { testCases: [{ id: 1, status: 12, time: 5, memory: 100 }] } };
  const got = await readFromApiForTest(weird);
  assert.equal(got.tests.length, 1);
  assert.equal(got.text, 'AC', '没有总状态就从逐点结果归纳一个');
});

test('从逐点结果归纳总状态：有一个不是 AC 就不是 AC', async () => {
  const json = {
    testCases: [
      { id: 1, status: 12, time: 5, memory: 100 },
      { id: 2, status: 5, time: 1000, memory: 100 },
    ],
  };
  const got = await readFromApiForTest(json);
  assert.equal(got.text, '超时');
  assert.equal(got.tests.length, 2);
});

test('换个包装层级也能找到总状态', () => {
  // 字段路径是我猜的，所以按特征找而不是写死 currentData.record
  assert.equal(overallOfForTest({ currentData: { record: { status: 12, score: 100 } } })?.verdict, 'AC');
  assert.equal(overallOfForTest({ data: { rec: { status: 6, detail: {} } } })?.verdict, '答案错误');
});

test('接口读不到时，能从页面注入的状态里解出记录', () => {
  /*
   * `?_contentOnly=1` 那条路是我猜的（匿名访问记录页直接 302，离线验不了），
   * 所以留了第二个来源：页面 SSR 注入的 window._feInjection。
   * 内容脚本读不到页面的 window，但读得到 <script> 的文本。
   */
  const payload = encodeURIComponent(
    JSON.stringify({ currentData: { record: { status: 6, score: 70, testCases: [] } } }),
  );
  globalThis.document = {
    scripts: [
      { textContent: 'console.log("别的脚本")' },
      { textContent: `window._feInjection = JSON.parse(decodeURIComponent("${payload}"));` },
    ],
  };
  const json = readInjectedForTest();
  assert.equal(json.currentData.record.status, 6);
  assert.equal(overallOfForTest(json).verdict, '答案错误');
  delete globalThis.document;
});

test('页面里没有注入状态时返回 null，不抛异常', () => {
  globalThis.document = { scripts: [{ textContent: 'var x = 1' }] };
  assert.equal(readInjectedForTest(), null);
  delete globalThis.document;
});

test('记录本身不会被当成一个测试点', () => {
  /*
   * 一条提交记录同样带 status / time / memory（整体耗时与内存）。
   * 不排掉的话每次都会凭空多出一个测试点，而且排在最前面，看着就像第 1 个点——
   * 于是「10 个测试点」会显示成 11 个，AC 数也跟着多一个。
   */
  const json = {
    currentData: {
      record: {
        status: 6,
        time: 1200,
        memory: 30000,
        score: 70,
        problem: { pid: 'P9088' },
        user: { uid: 1 },
        detail: {
          judgeResult: {
            subtasks: [
              {
                testCases: [
                  { id: 1, status: 12, time: 15, memory: 1024 },
                  { id: 2, status: 6, time: 16, memory: 1024 },
                ],
              },
            ],
          },
        },
      },
    },
  };
  const cases = collectTestCases(json);
  assert.equal(cases.length, 2, `多出来的多半是记录自己：${JSON.stringify(cases)}`);
  assert.deepEqual(
    cases.map((c) => c.verdict),
    ['AC', '答案错误'],
  );
});

test('拿回 HTML 时报「不是 JSON」而不是一句 token 错误', async () => {
  /*
   * 实际踩到的：用了已失效的 ?_contentOnly=1，洛谷返回整页 HTML，
   * res.json() 抛的是「Unexpected token '<'」——那句话只说明「不是 JSON」，
   * 指不出真正的原因是请求方式不对。现在先看 content-type 再解析。
   */
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('<!DOCTYPE html><html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  globalThis.location = { origin: 'https://www.luogu.com.cn', pathname: '/record/1' };
  try {
    await assert.rejects(() => fetchRecordForTest(), /不是 JSON/);
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.location;
  }
});

test('请求带的是 lentille 头，不是已失效的查询参数', async () => {
  const realFetch = globalThis.fetch;
  let seen = { url: '', headers: {} };
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), headers: init?.headers ?? {} };
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  globalThis.location = { origin: 'https://www.luogu.com.cn', pathname: '/record/123' };
  try {
    await fetchRecordForTest();
    assert.equal(seen.headers['x-lentille-request'], 'content-only');
    assert.ok(!seen.url.includes('_contentOnly'), '那个参数已失效，别再带上');
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.location;
  }
});

/* ────────── 实战回归：P9088 那次 35 格的误报 ────────── */

test('子任务汇总不算测试点（实测 35 格里只有 28 个是真的）', () => {
  /*
   * 线上真实症状：面板显示「35 个测试点：等待中×1 无效×6 答案错误×28」，
   * 而实际是 28 个测试点全部答案错误。
   *
   * 多出来的 7 个是：6 个子任务的汇总（它们自己也带 status/time/memory）
   * 和 1 个更外层的容器。它们各自顶着别的状态，看着就像题目真有那些结果。
   */
  const subtask = (statuses) => ({
    status: 14, // 子任务汇总：未通过
    time: 500,
    memory: 20000,
    score: 0,
    testCases: statuses.map((status, i) => ({ id: i, status, time: 15, memory: 1024 })),
  });
  const json = {
    currentData: {
      record: {
        status: 14,
        time: 1200,
        memory: 30000,
        score: 0,
        problem: { pid: 'P9088' },
        detail: {
          judgeResult: {
            status: 0,
            time: 1200,
            memory: 30000,
            subtasks: [
              subtask([6, 6, 6, 6, 6]),
              subtask([6, 6, 6, 6, 6]),
              subtask([6, 6, 6, 6, 6]),
              subtask([6, 6, 6, 6, 6]),
              subtask([6, 6, 6, 6]),
              subtask([6, 6, 6, 6]),
            ],
          },
        },
      },
    },
  };

  const cases = collectTestCases(json);
  assert.equal(cases.length, 28, `应当只有 28 个真测试点，实际 ${cases.length}`);
  assert.ok(
    cases.every((c) => c.verdict === '答案错误'),
    '28 个应当全是答案错误，不该混进子任务的「未通过」',
  );
  assert.deepEqual(cases[0].index, 1);
  assert.deepEqual(cases.at(-1).index, 28);
});

test('总状态是「未通过」这种统称时，报逐点结果里的具体结论', async () => {
  // 截图里总状态显示成「无效」，而真相是「答案错误」——统称帮不上忙
  const json = {
    currentData: {
      record: {
        status: 14,
        score: 0,
        problem: {},
        detail: {
          judgeResult: {
            subtasks: [{ status: 14, testCases: [{ id: 1, status: 6, time: 1, memory: 1 }] }],
          },
        },
      },
    },
  };
  const got = await readFromApiForTest(json);
  assert.equal(got.text, '答案错误');
  assert.equal(got.tests.length, 1);
});

test('状态码 14 是「未通过」不是「无效」', () => {
  // Unaccepted 是「没过」的统称，不是某种具体错误；「无效」会让人以为提交本身有问题
  const cases = collectTestCases({ testCases: [{ id: 1, status: 14, time: 1, memory: 1 }] });
  assert.equal(cases[0].verdict, '未通过');
});
