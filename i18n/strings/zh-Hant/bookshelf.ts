// 書架（`screens/bookshelf/**`）：收藏網格、閱讀歷史與離線內容兩個推入頁。
//
// 源的東西不翻：漫畫標題、章節名、來源名稱（`entry.title`／`entry.epTitle`／`comicTitle` 都是資料）。
// 導覽列標題也不在這裡：它與書架分頁的標題同一個字，來源是 `common.tabs.bookshelf`。
//
// 相對時間（歷史卡片第二行那個時間）也不在字典裡：那是 `Intl` 組的，書架走
// `screens/home/historyTime.ts` → `screens/shared/commentTime.ts` 的同一支。

export default {
  /** 書架頂部的兩個入口列，也是推入頁的標題。 */
  historyTab: "閱讀歷史",
  offlineTab: "離線內容",
  /** 入口列右側的數量。 */
  comicCount: { one: "{n} 本", other: "{n} 本" },
  downloadingCount: { one: "下載中 {n} 話", other: "下載中 {n} 話" },

  /** 導覽列右上的排序與篩選選單。 */
  menu: "排序與篩選",
  sortGroup: "排序",
  filterGroup: "顯示範圍",
  sortRecent: "最近閱讀",
  sortAdded: "最近收藏",
  sortTitle: "標題",
  filterAll: "全部",
  filterUpdates: "更新",
  filterRead: "讀過",
  filterUnread: "未讀",
  /** 收藏格子的狀態行：沒有閱讀紀錄。 */
  unread: "未讀",
  /** 封面右上角的未讀數字（讀屏用；畫面只顯示數字）。 */
  unreadBadge: "未讀 {n} 話",
  /** 下拉檢查追更時的進度列。 */
  checkingUpdates: "正在檢查更新 {done}/{total}",
  /** 篩選後一本都不剩。 */
  emptyFilteredTitle: "沒有符合的收藏",
  emptyFilteredDetail: "從右上角選單切換顯示範圍。",
  /** 「更新」篩選：收藏裡沒有未讀的章節。 */
  emptyUpdatesTitle: "目前沒有更新",
  emptyUpdatesDetail: "收藏的作品有新章節時，會出現在這裡。",

  /** 各個清單沒有內容時。 */
  emptyFavoritesTitle: "書架是空的",
  emptyFavoritesDetail: "在瀏覽漫畫時點擊右上角愛心即可收藏。",
  emptyHistoryTitle: "還沒有閱讀紀錄",
  emptyHistoryDetail: "已閱讀的章節和作品會自動排在這裡。",
  emptyOfflineTitle: "沒有離線內容",
  emptyOfflineDetail: "在漫畫詳情頁下載章節，即可離線閱讀。",
  /** 歷史列長按選單：推入漫畫詳情頁（點一下是直接續讀）。 */
  openDetail: "前往詳情",

  /** 源被刪掉之後紀錄還留著（刪源不清書架）：收藏格子裡的來源名稱位置顯示這一句。 */
  sourceRemoved: "已移除",
  /** 歷史卡片：來源名稱的位置（那一列是紅字）。 */
  sourceRemovedTitle: "來源已移除",
  /** 歷史卡片：章節名沒有記到時，退成這一句。 */
  lastRead: "上次閱讀",
  /** 歷史卡片：讀到第 `{page}` 頁（1 起算）。 */
  pageOf: "第 {page} 頁",
  /** 歷史卡片：`{page}` / `{total}`。 */
  pageOfTotal: "第 {page} / {total} 頁",

  /** 離線書架：manifest 沒記到作品名時。 */
  unknownComic: "未知漫畫",
  /** 離線書架卡片：下載完的章數／總章數與佔用空間。`{n}` 只給 `PluralRules` 挑形（＝總章數）。 */
  chapterStats: {
    one: "{done}/{total} 章 · {size}",
    other: "{done}/{total} 章 · {size}",
  },
  /** 離線章節列：已下載完，`{n}` 頁與佔用空間。 */
  downloadedStats: { one: "{n} 頁 · {size}", other: "{n} 頁 · {size}" },
  /** 離線章節列：沒下載完的頁數。 */
  incompleteStats: "未完成 {done}/{total}",

  /** 離線漫畫頁：一章都沒下載完，繼續閱讀按鈕的位置顯示這一句（按鈕按不下去）。 */
  noDownloadedChapter: "還沒有下載完的章節",
  /** 離線章節列：下載失敗（只有這個狀態用紅字）。 */
  downloadFailed: "下載失敗",
  /** 長按選單刪除整部的確認；`{n}` 是章數。 */
  deleteComicConfirm: "刪除《{title}》的 {n} 個離線章節？",
  /** 左滑刪除單章的確認。 */
  deleteChapterConfirm: "刪除「{chapter}」的離線內容？",
}
