// 首頁（`screens/home/HomeScreen.tsx`）與 Bangumi 條目詳情頁（`BangumiDetailScreen.tsx`）。
//
// 來源與 Bangumi 回傳的資料（漫畫標題、作者、標籤、簡介內文）不翻，我們自己寫的介面字才收。

export default {
  title: "首頁",

  /** 首頁三個區塊的標題。 */
  resumeTitle: "繼續閱讀",
  trendingTitle: "熱門新作",
  followingTitle: "大家在追",
  /** 榜單還沒回來／回不來時的兩句話。 */
  feedLoading: "正在獲取 Bangumi 推薦…",
  feedErrorTitle: "暫時無法連線至 Bangumi",
  feedErrorDetail: "請檢查網路連線或稍後點擊右上角重試。",

  /** 繼續閱讀卡片：話數解析不出來，以及來源被刪掉時的兩種說法。 */
  lastRead: "上次閱讀",
  sourceInvalid: "源失效",
  sourceRemoved: "源已移除",

  /** Scripting 首頁分頁的 Mini Hub（`home_screen_default_ui.tsx`）：開啟完整 App 與追更看板。 */
  miniHub: {
    openApp: "開啟完整 App",
    updatesTitle: "最新追更",
    allUpToDate: "所有收藏已是最新",
  },

  /** Bangumi 條目詳情頁。 */
  bangumi: {
    originalName: "原名：{name}",
    author: "作者：{author}",
    releaseDate: "發售：{date}",
    summary: "簡介",
    expand: "展開",
    collapse: "收起",
    sourcesTitle: "可用漫畫來源",
    manualSearch: "手動聚合搜尋",
    matching: "正在各漫畫源中比對《{title}》…",
    notFoundTitle: "目前已啟用的源中未找到此作品",
    notFoundDetail: "可能譯名不同，或需要到「設定」或「瀏覽」安裝更多漫畫源。",
  },
}
