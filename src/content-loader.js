/*
 * 内容脚本入口。
 *
 * manifest 里的内容脚本是「经典脚本」，不能直接写 import。所以这里只做一件事：
 * 动态导入真正的模块入口。这样四个平台的提交逻辑仍然是拆开的 ES 模块，
 * 而不是为了迁就 manifest 把它们塞进一个几百行的大文件里。
 *
 * 被导入的文件必须列进 manifest 的 web_accessible_resources，否则 getURL 拿得到、
 * 导入却会被挡下来——而且报的错在页面控制台里，扩展这边一声不吭。
 */
import(chrome.runtime.getURL('src/content/main.js')).catch((error) => {
  console.error('[oi-submit] 内容脚本加载失败', error);
});
