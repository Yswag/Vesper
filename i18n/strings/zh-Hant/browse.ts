// 瀏覽（`screens/browse/**`）：已啟用的來源清單，與單一源的探索／分類／排行／大網格。
//
// 源的內容一律不翻：漫畫標題、標籤、分區名、`optionList` 的選項顯示名都是源回傳的資料
// （後者是 `"值-顯示名"` 的顯示半邊，見 `sources/options.ts`），我們只收自己寫的介面字
// 與狀態字。

export default {
  /** 來源清單頁。 */
  title: "瀏覽",
  manageSources: "漫畫來源管理",
  /** `{n}` 是已啟用的來源數。 */
  enabledSources: "已啟用的來源 ({n})",
  emptyTitle: "沒有已啟用的源",
  emptyDetail: "請到「設定 → 漫畫源」安裝並開啟漫畫來源；Aidoku 索引可在「源倉庫」加入。",
  pickSources: "去挑源",

  /** 單一源的外殼：三個檢視的選單與它們的導覽列替代標題。 */
  source: "源",
  explore: "探索",
  category: "分類",
  ranking: "排行",
  /** 檢視切換鈕的無障礙標籤；`{label}` 是目前檢視。 */
  viewLabel: "來源檢視：{label}",

  /** 三頁共用的狀態與按鈕字。 */
  noResults: "沒有結果",
  refresh: "重新整理",
  reload: "重新載入",
  rankingLoading: "正在載入排行榜…",

  /** 下拉搜尋框的提示字；`{name}` 是源的名字（資料）。 */
  searchInSource: "搜尋 {name}",
  /** 已經有結果時又改了關鍵字，網格上方那行。 */
  searching: "搜尋中…",

  /** 探索的區塊本身沒有標題時的替代字。 */
  hotPicks: "熱門推薦",
  /** 大網格頁沒有標題可顯示時（從分類 chip 進來）的替代字。 */
  all: "全部",

  /** 這個源沒有任何探索清單：搜尋是唯一入口。 */
  searchOnly: "這個源只能搜尋",

  /** 分類頁。 */
  noCategories: "這個源沒有可用的分類",
  /** 某一組分類讀不到；`{error}` 是原因（資料）。 */
  partError: "讀不到：{error}",
  /** 分類 chip 的無障礙標籤；`{label}` 是源給的分類名（資料）。 */
  categoryLabel: "分類：{label}",
}
