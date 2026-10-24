// 简体中文。**LLM 產出、未經母語者校對**。

export default {
  working: "处理中…",
  input: "输入",
  confirm: "确定",
  untitled: "(无标题)",
  noCover: "无封面",
  undecodable: "无法解码",
  exitLabel: "退出 Vesper，返回 Scripting",
  exitBlockedTitle: "无法缩小到后台",
  exitBlockedMessage: "可能是开了多窗口模式。关闭会中断下载（已经抓到的页会留着）。",
  exitContinue: "继续下载",
  exitAnyway: "仍要退出",
  allShown: "— 已显示全部内容 —",
  loadFailed: "加载失败：{message}",
  /** 技术错误字符串的人话版（见 `engine/errors.ts`）。 */
  problem: {
    server: "服务器错误（{status}）",
    request: "请求被拒绝（{status}）",
    timeout: "连接超时",
    network: "没有网络连接",
    unknown: "发生未知错误",
  },
  retry: "重试",
  imageFailed: "（图片加载失败）",
  offlineTag: "离线",

  pageMissing: "第 {n} 页不存在（共 {total} 页）",
  pages: { one: "{n} 页", other: "{n} 页" },

  tabs: {
    home: "首页",
    bookshelf: "书架",
    browse: "浏览",
    settings: "设置",
    search: "搜索",
  },
  sectionMenu: "切换分类，当前是{title}",

  cancel: "取消",
  save: "保存",
  add: "添加",
  delete: "删除",
  remove: "移除",
  clear: "清除",
  inProgress: "{label}…",
  failed: "失败：{message}",

  loading: "加载中…",
  loadingMore: "正在加载更多…",

  preparingEnv: "正在准备阅读器环境…",
  installingCoreDeps: "初次启动正在安装必要核心依赖 (cheerio, crypto-js)，请稍候数秒…",
  depsInstallFailed: "核心依赖安装失败。请确认网络连接后重试。",
  depsRetryInstall: "重试安装",
  depsMissing: "核心依赖 {name} 未安装。请到「设置 → 核心依赖」重新安装后再试。",
}
