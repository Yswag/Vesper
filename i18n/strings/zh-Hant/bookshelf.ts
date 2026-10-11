// 書架（`screens/bookshelf/**`）：收藏／閱讀歷史／離線內容三個分頁，與離線書架的卡片。
//
// 源的東西不翻：漫畫標題、章節名、來源名稱（`entry.title`／`entry.epTitle`／`comicTitle` 都是資料）。
// 導覽列標題也不在這裡：它與書架分頁的標題同一個字，來源是 `common.tabs.bookshelf`。
//
// 相對時間（歷史卡片第二行那個時間）也不在字典裡：那是 `Intl` 組的，書架走
// `screens/bookshelf/historyTime.ts` → `screens/shared/commentTime.ts` 的同一支。

export default {
  /** 三個分頁那個 picker 的存取標籤。 */
  pickerLabel: "書架內容",
  /** picker 的三個選項；`{n}` 是該分頁的數量。三種語言的量詞都不隨數字變，所以不是複數形。 */
  favoritesCount: "收藏 ({n})",
  historyCount: "閱讀歷史 ({n})",
  offlineCount: "離線內容 ({n})",

  /** 三個分頁各自沒有內容時。 */
  emptyFavoritesTitle: "書架是空的",
  emptyFavoritesDetail: "在瀏覽漫畫時點擊右上角愛心即可收藏。",
  emptyHistoryTitle: "還沒有閱讀紀錄",
  emptyHistoryDetail: "已閱讀的章節和作品會自動排在這裡。",
  emptyOfflineTitle: "沒有離線內容",
  emptyOfflineDetail: "在漫畫詳情頁下載章節，即可離線閱讀。",

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
}
