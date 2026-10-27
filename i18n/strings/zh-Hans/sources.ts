// 简体中文。**LLM 產出、未經母語者校對**。

export default {
  unsupported: {
    search: "这个源不支持搜索",
    searchPaging: "这个源的搜索不支持翻页",
    category: "这个源不支持分类列表",
    ranking: "这个源没有排行榜",
    detail: "这个源不支持读取详情",
    chapter: "这个源不支持读取章节",
    comments: "这个源不支持读取评论",
    sendComment: "这个源不支持发表评论",
    account: "这个源不支持账号密码登录",
    cookie: "这个源不支持 Cookie 登录",
    browser: "这个源不支持浏览器登录",
    explore: "「{title}」目前无法加载（这个源没有提供加载函数）",
    exploreIndex: "这个源没有第 {n} 个探索分类",
    home: "这个源没有首页",
  },

  notLoaded: "{name} 没有加载成功",
  notLoadedShort: "源没有加载",
  notFound: "找不到来源 {key}",
  codeMissing: "找不到源码",

  exploreFallback: "探索 {n}",
  categoryFallback: "分类 {n}",
  untitled: "(无标题)",
  emptyChapter: "这一章没有可用的图片",
  commentEmpty: "评论内容不能只有空白",

  notOffline: "这一章不在离线存储里",
  pageUnreadable: "第 {n} 页读不到（文件不存在或已损坏）",

  verificationTitle: "请完成安全验证 ({name})",

  aidoku: {
    failed: "源出错：{message}",
    missing: "源的档案不见了（请重新安装这个源）",
    timeout: "源响应超时",
    initFailed: "源初始化失败",
    invalidPackage: "这不是有效的 Aidoku 源文件（.aix）",
    chapter: "第 {n} 话",
    volume: "第 {n} 卷",
    unavailable: "这个源暂时不可用（{reason}），到来源设置关掉再开就会重新尝试",

    requiresPro: "Aidoku 源需要 Scripting Pro",
    requiresProDetail: "Aidoku 源要靠本机 HTTP 服务器运行源的 WebAssembly。升级 Scripting Pro 后再回来安装。",

    indexInvalid: "Aidoku 索引格式不对（要 { sources: [...] } 或 JSON 数组）",
    indexBadId: "源 id 不合法：{id}",
    indexBadEntry: "索引条目缺 name、version 或下载路径",
  },

  login: {
    expired: "登录已过期，请重新登录",
    cancelled: "已取消登录",
    done: "已登录",
    cookiesSaved: { one: "已保存 {count} 个 cookie", other: "已保存 {count} 个 cookie" },
    webAccount: "WebView 登录",
    windowTitle: "登录 {name}",
    windowBusy: "已经有一个登录窗口开着",
    pageLoading: "网页加载",
    pageLoadFailed: "网页加载失败：{message}",
    callback: "源的 onLoginSuccess()",
    timeout: "{subject}超时（{seconds} 秒）",
    validateFailed: "验证失败，请检查输入内容",
    incompleteTitle: "登录未完成",
    incompleteMessage: {
      one: "这次没有检测到登录成功。要把刚才取得的 {count} 个 cookie 保存下来吗？",
      other: "这次没有检测到登录成功。要把刚才取得的 {count} 个 cookie 保存下来吗？",
    },
    saveCookies: "保存",
  },

  catalog: {
    notArray: "索引不是 JSON 数组",
    notObject: "不是对象",
    badFields: "name / key / version 必须是字符串",
    badKey: "key 不合法：{key}",
    badVersion: "version 不合法：{version}",
    noTarget: "url 与 fileName 至少要有一个",
    empty: "索引里没有可用的源",
    emptyWithReason: "索引里没有可用的源（{reason}）",
    entryLabel: "(索引条目)",
    singleObject: "这是单一 JSON 对象，不是源也不是索引",
    isRepository: "这是仓库索引，请改用「源仓库」添加",
    repositoryNotArray: "仓库索引必须是 JSON 数组（index.json）",
    duplicateSkipped: "同一批里有同 key 的另一个变体，只保留第一个",
    relativeOnly: "只有相对路径，请改用索引的网址导入",
    keyMismatch: "源的 key 不符：预期 {expected}，实际 {actual}",
    downloadFailed: "下载失败：HTTP {status}",
  },

  repository: {
    urlRequired: "请输入仓库网址",
    notFound: "找不到这个仓库",
    entryNotFound: "仓库里没有这个源",
  },

  settingNoAction: "这个设置没有可执行的动作",
}
