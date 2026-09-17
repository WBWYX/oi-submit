/**
 * 平台识别、提交页 URL 构造、默认设置。
 *
 * 这个文件里没有任何 DOM 操作，全是纯函数，所以能直接用 node:test 覆盖——
 * 填表那部分要等真的登录上去才能验，而 URL 构造错了同样会让提交静默失败
 * （浏览器打开一个不对的页面，然后就没有然后了），那部分必须在离线阶段就锁死。
 */

/** 平台 id → 支持的域名。域名要精确匹配，不能用「包含」——见 isSupported。 */
export const DOMAINS = {
  luogu: ['www.luogu.com.cn'],
  codeforces: ['codeforces.com', 'm1.codeforces.com', 'm2.codeforces.com', 'm3.codeforces.com'],
  atcoder: ['atcoder.jp'],
  timus: ['acm.timus.ru'],
  qoj: ['qoj.ac'],
  nowcoder: ['ac.nowcoder.com'],
  loj: ['loj.ac'],
  hdu: ['acm.hdu.edu.cn'],
};

export const PLATFORM_NAME = {
  luogu: '洛谷',
  codeforces: 'Codeforces',
  atcoder: 'AtCoder',
  timus: 'Timus',
  qoj: 'QOJ',
  nowcoder: '牛客',
  loj: 'LibreOJ',
  hdu: 'HDU',
};

/**
 * 按 hostname **精确相等**判定平台。
 *
 * 不用 endsWith：`luogu.com.cn`（不带 www）在洛谷那边是另一台服务器，
 * 提交页的结构对不上；而 `notcodeforces.com`.endsWith('codeforces.com') 是 true。
 */
export function platformOf(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  for (const [id, hosts] of Object.entries(DOMAINS)) {
    if (hosts.includes(host)) return id;
  }
  return null;
}

const CF_CONTEST = /^\/(contest|gym)\/(\d+)\/problem\/(\w+)/;
const CF_PROBLEMSET = /^\/problemset\/problem\/(\d+)\/(\w+)/;
const AT_TASK = /^\/contests\/([\w-]+)\/tasks\/(\w+)/;
const LUOGU_PROBLEM = /^\/problem\/([A-Za-z0-9_]+)/;
const TIMUS_NUM = /[?&]num=(\d+)/;
const QOJ_PROBLEM = /^\/problem\/(\d+)/;
const QOJ_CONTEST = /^\/contest\/(\d+)\/problem\/(\d+)/;
const NC_PROBLEM = /^\/acm\/problem\/(\d+)/;
const NC_CONTEST = /^\/acm\/contest\/(\d+)\/([A-Za-z0-9]+)/;
const LOJ_PROBLEM = /^\/p\/(\d+)/;
const HDU_PID = /[?&]pid=(\d+)/;

/**
 * 题目链接 → 提交页链接 + 题目定位信息。
 *
 * 返回 null 表示「这个链接我认不出来」，调用方必须当成错误报出去而不是照着原样打开——
 * 打开一个不是提交页的页面，填表会一直等元素等到超时，而人只看到浏览器无故跳了一下。
 */
export function submitTarget(url) {
  const platform = platformOf(url);
  if (!platform) return null;
  const u = new URL(url);

  if (platform === 'codeforces') {
    const contest = CF_CONTEST.exec(u.pathname);
    if (contest) {
      return {
        platform,
        submitUrl: `${u.origin}/${contest[1]}/${contest[2]}/submit`,
        problemIndex: contest[3].toUpperCase(),
        problemKey: `${contest[2]}${contest[3].toUpperCase()}`,
      };
    }
    const set = CF_PROBLEMSET.exec(u.pathname);
    if (set) {
      return {
        platform,
        submitUrl: `${u.origin}/problemset/submit`,
        problemCode: `${set[1]}${set[2].toUpperCase()}`,
        problemKey: `${set[1]}${set[2].toUpperCase()}`,
      };
    }
    return null;
  }

  if (platform === 'atcoder') {
    const task = AT_TASK.exec(u.pathname);
    if (!task) return null;
    return {
      platform,
      submitUrl: `${u.origin}/contests/${task[1]}/submit?taskScreenName=${task[2]}`,
      taskScreenName: task[2],
      problemKey: task[2],
    };
  }

  if (platform === 'luogu') {
    const prob = LUOGU_PROBLEM.exec(u.pathname);
    if (!prob) return null;
    /*
     * 洛谷没有独立的提交页，提交面板在题目页里，**靠 `#submit` 这个锚点打开**。
     *
     * 早先打开的是不带锚点的题目页，再去点那个「提交」标签——那条路要靠一串
     * 很深的 CSS 选择器定位标签页，洛谷一改版就失灵。锚点是站点自己的约定，
     * 交给它的路由去处理，比我们猜 DOM 结构稳得多。
     */
    return {
      platform,
      submitUrl: `${u.origin}/problem/${prob[1]}#submit`,
      problemKey: prob[1].toUpperCase(),
    };
  }

  if (platform === 'qoj') {
    /*
     * QOJ（UOJ 系）没有独立提交页：提交表单就在题目页上，藏在一个 Bootstrap
     * 标签页里（`#tab-submit-answer`）。
     *
     * **锚点不会把标签页打开**——uoj.js 里没有任何处理 location.hash 的代码，
     * Bootstrap 的标签只认对 `[data-toggle="tab"]` 的点击。所以这里照样把锚点带上
     * （链接本身是对的，人点开也能定位），但真正展开面板由内容脚本去点。
     *
     * 比赛题保持在比赛页提交：换到题库页交，那一发就不算进比赛了。
     */
    const contest = QOJ_CONTEST.exec(u.pathname);
    if (contest) {
      return {
        platform,
        submitUrl: `${u.origin}/contest/${contest[1]}/problem/${contest[2]}#tab-submit-answer`,
        problemKey: contest[2],
      };
    }
    const prob = QOJ_PROBLEM.exec(u.pathname);
    if (!prob) return null;
    return {
      platform,
      submitUrl: `${u.origin}/problem/${prob[1]}#tab-submit-answer`,
      problemKey: prob[1],
    };
  }

  if (platform === 'nowcoder') {
    /*
     * 牛客的题目页本身就是「终端」页：题面在左、代码编辑器在右，没有另一个提交页。
     * 所以提交页就是题目页，原样打开。
     */
    const bank = NC_PROBLEM.exec(u.pathname);
    if (bank) {
      return {
        platform,
        submitUrl: `${u.origin}/acm/problem/${bank[1]}`,
        problemKey: bank[1],
      };
    }
    const contest = NC_CONTEST.exec(u.pathname);
    if (!contest) return null;
    return {
      platform,
      submitUrl: `${u.origin}/acm/contest/${contest[1]}/${contest[2]}`,
      problemKey: `${contest[1]}-${contest[2].toUpperCase()}`,
    };
  }

  if (platform === 'loj') {
    const prob = LOJ_PROBLEM.exec(u.pathname);
    if (!prob) return null;
    return {
      platform,
      submitUrl: `${u.origin}/p/${prob[1]}/submit`,
      problemKey: prob[1],
    };
  }

  if (platform === 'hdu') {
    /*
     * HDU 的提交页是独立的 `submit.php?pid=<pid>`，题号在 query 里（同 Timus 的形态）。
     *
     * 那个页面**要登录**，匿名访问直接 302 跳登录页——所以填表脚本必须先确认
     * 表单在不在，不在就明说「请先登录 HDU」，而不是干等元素等到超时。
     */
    const pid = HDU_PID.exec(u.search);
    if (!pid) return null;
    return {
      platform,
      submitUrl: `${u.origin}/submit.php?pid=${pid[1]}`,
      problemNum: pid[1],
      problemKey: pid[1],
    };
  }

  // Timus：题目页是 problem.aspx?space=1&num=1297，提交页是独立的 submit.aspx
  const num = TIMUS_NUM.exec(u.search);
  if (!num) return null;
  return {
    platform,
    submitUrl: `${u.origin}/submit.aspx?space=1&num=${num[1]}`,
    problemNum: num[1],
    problemKey: num[1],
  };
}

/**
 * 各平台默认选哪个语言。
 *
 * **存的是一段文本，不是选项的数字 id**，这是本扩展与 CPH-NG 最要紧的一处不同。
 * CPH-NG 在 AtCoder 上写死 `value = '6017'`，而 AtCoder 的语言 id **每场比赛都不一样**，
 * 写死的那个在别的比赛里要么不存在、要么指向另一门语言。Codeforces 也会不定期新增
 * 编译器选项。按可见文本匹配就没有这个问题：新增了 "GNU G++23 (64)" 之后，
 * 匹配 "G++23" 仍然命中。
 *
 * 匹配规则见 pickOption：不区分大小写的「包含」，多个命中取第一个。
 */
export const DEFAULT_LANGUAGE = {
  luogu: 'C++17',
  codeforces: 'GNU G++17',
  atcoder: 'C++ 20',
  timus: 'G++',
  /*
   * QOJ 的选项文本是 `C++ 17`（带空格），value 是 `C++17`（不带）。
   * pickOption 归一化时会去掉空白，两种写法都能命中。
   */
  qoj: 'C++ 17',
  nowcoder: 'C++',
  /*
   * LOJ 的语言下拉是 Semantic UI 的自绘控件，选项文本就是 `C++`；
   * C++ 标准是另一个下拉（std），由 lojStandard 单独配。
   */
  loj: 'C++',
  /*
   * HDU 的语言下拉只有 7 项、文本极短：G++ / GCC / C++ / C / Pascal / Java / C#。
   * 选 `G++` 而不是 `C++`：HDU 的「C++」那一项用的是更老的编译器，
   * 而 pickOption 是「包含」匹配——填 `C++` 会先命中 `G++` 之外的那一项。
   */
  hdu: 'G++',
};

export const DEFAULT_SETTINGS = {
  port: 27121,
  language: { ...DEFAULT_LANGUAGE },
  /** 洛谷专有：O2 开关。其余平台没有这个概念。 */
  enableO2: true,
  /** Timus 的 Judge ID 就是它的凭据，没有别的登录方式。 */
  timusJudgeId: '',
  /**
   * LOJ 专有：C++ 标准。
   *
   * LOJ 把编译选项拆成了四个下拉（compiler / std / O / m），其中只有 std 会影响
   * 能不能编过——它的默认值是 **c++11**，比其他平台低一大截。带 `auto` 类型推导、
   * 结构化绑定的代码在别处交得好好的，到这儿直接 CE。所以这一项单独可配。
   * 留空表示不动页面上的选项。
   */
  lojStandard: 'c++17',
  /** 提交后是否盯着评测结果回传给 oi-bench。 */
  reportResult: true,
  /**
   * 填好表单后**停下来等人自己点提交**。
   *
   * 默认开着。自动点按钮省下的只是一次点击，代价却是：页面上到底发生了什么
   * 全凭扩展的选择器说了算——Timus 上就曾因为点中了页头的搜索按钮，
   * 交也没交成、还报了成功。停一下让人看一眼，语言对不对、代码对不对、
   * O2 开没开，都摆在眼前，点下去心里有数。
   */
  manualSubmit: true,
};

/**
 * 从一组选项里挑出最匹配的那个。
 *
 * @param {Array<{value:string,text:string}>} options
 * @param {string} wanted 用户配置的语言文本，如 "GNU G++23"
 * @returns {{value:string,text:string}|null}
 *
 * 三级回退，每一级都有具体理由：
 *  1. 文本包含配置值（不区分大小写、忽略空格差异）——正常路径。
 *  2. 配置值是纯数字时按 value 精确匹配——让人能在选项文本古怪时直接写 id 兜底。
 *  3. 都没命中就返回 null，由调用方决定是「用页面当前选中的」还是报错。
 *     **绝不「猜一个最像的」**：提交语言选错会直接 CE，而人会以为是自己代码的问题。
 */
export function pickOption(options, wanted) {
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, '');
  const target = norm(wanted);
  if (!target) return null;

  const hit = options.find((o) => norm(o.text).includes(target));
  if (hit) return hit;

  if (/^\d+$/.test(wanted.trim())) {
    const byValue = options.find((o) => o.value === wanted.trim());
    if (byValue) return byValue;
  }
  return null;
}
