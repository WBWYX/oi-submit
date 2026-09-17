/**
 * 内容脚本主流程。
 *
 * 每个页面加载都会跑一次，第一件事是问后台「这个标签页有我的活儿吗」。绝大多数
 * 情况下答案是没有（你只是在正常浏览洛谷），那就立刻退出、什么都不碰——一个提交
 * 扩展最不该做的事就是在用户正常看题时动页面。
 *
 * 有活儿的话分两个阶段：
 *   fill  —— 填表并点提交，然后告诉后台转入 watch
 *   watch —— 在结果页上盯评测结论，逐次回传，直到终态
 *
 * 两个阶段通常发生在**两次不同的页面加载**里（提交会跳转），所以阶段存在后台的
 * session 存储里，而不是这个脚本的变量里。
 *
 * **洛谷、LOJ、牛客是例外**：它们是 SPA（或干脆就地提交不跳转），提交后内容脚本
 * 不会重跑，所以填完之后本脚本自己留在同一个文档里接着盯结果——见下面 watchHere
 * 那一段。这也是 isResultPage() 对这三家返回「当前页就是结果页」的原因。
 */

import * as luogu from './luogu.js';
import * as codeforces from './codeforces.js';
import * as atcoder from './atcoder.js';
import * as timus from './timus.js';
import * as qoj from './qoj.js';
import * as nowcoder from './nowcoder.js';
import * as loj from './loj.js';
import * as hdu from './hdu.js';

const SUBMITTERS = { luogu, codeforces, atcoder, timus, qoj, nowcoder, loj, hdu };

const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => undefined);

async function run() {
  const task = await send({ type: 'pageReady' });
  if (!task) return; // 这个标签页没有待办：正常浏览，不碰页面

  const submitter = SUBMITTERS[task.platform];
  if (!submitter) return;

  if (task.phase === 'fill') {
    try {
      const result = await submitter.fill(task);
      await send({ type: 'phase', phase: 'watch' });

      /*
       * 手动模式：表单已经填好，提交按钮也标出来了，但那一下由人自己点。
       * 先把「填好了」这个状态报回去——面板上显示「等你在浏览器里点提交」，
       * 而不是让人对着一个「提交中」猜到底在等什么。
       */
      if (!result?.submitted) {
        await send({
          type: 'filled',
          message: result?.language ? `已填好（${result.language}），等你点提交` : '已填好，等你点提交',
          language: result?.language ?? '',
        });
      }

      /*
       * **确认之后才报成功。**
       *
       * 早先是填完表就报「已提交」，再去等跳转。那等于把「点了按钮」当成
       * 「交出去了」——被平台挡下来（没登录、验证码没输、比赛没开始、
       * 甚至点中了页面上另一个按钮）统统会先报一次成功。谎报成功的失败
       * 比直接报错难查十倍，Timus 上已经栽过一次。
       *
       * 手动模式下这里会等上几分钟，那正是人在看、在点的时间。
       */
      try {
        await submitter.waitUntilSubmitted({ manual: !result?.submitted });
      } catch (error) {
        await send({
          type: 'submitDone',
          ok: false,
          message: result?.submitted
            ? String(error?.message ?? error)
            : `一直没等到你点提交（${String(error?.message ?? error)}）`,
        });
        return;
      }

      await send({
        type: 'submitDone',
        ok: true,
        message: result?.language ? `已提交（${result.language}）` : '已提交',
        language: result?.language ?? '',
      });

      // 洛谷这种 SPA 不会重新加载脚本，只能在同一个文档里接着盯
      if (task.reportResult && submitter.isResultPage()) {
        await watchHere(submitter);
      }
    } catch (error) {
      await send({ type: 'submitDone', ok: false, message: `填表失败：${error?.message ?? error}` });
    }
    return;
  }

  if (task.phase === 'watch' && task.reportResult) {
    if (!submitter.isResultPage()) return; // 中间跳了别的页，等真正的结果页
    await watchHere(submitter);
  }
}

function watchHere(submitter) {
  return submitter.watch((update) =>
    send({
      type: 'verdict',
      verdict: update.verdict,
      detail: update.detail,
      tests: update.tests ?? [],
      final: update.final,
    }),
  );
}

void run();
