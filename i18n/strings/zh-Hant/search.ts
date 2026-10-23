// 搜尋（`screens/search/**`）：聚合結果的側邊欄、單一源的篩選 sheet、歷史搜尋。
//
// 源的東西一律不翻：漫畫標題，以及 `optionList` 的標籤與選項顯示名（後者是 `"值-顯示名"`
// 的顯示半邊，見 `sources/searchOptions.ts`）——那些是源回傳的資料。
// 導覽列標題也不在這裡：它與搜尋分頁的標題同一個字，來源是 `common.tabs.search`。

export default {
  /** 系統搜尋框的提示字。 */
  keyword: "關鍵字",

  /** 側邊欄第一列「全部」（不篩源）。 */
  all: "全部",
  /** 還沒有任何源回來時的那行；`{n}` 是已啟用的源數。 */
  sourcesPending: { one: "{n} 個源待搜尋", other: "{n} 個源待搜尋" },
  noSources: "尚無已啟用的源",
  /** 搜尋中；`{done}` 是跑完的源數、`{total}` 是總數。 */
  running: "搜尋中… {done}/{total}",
  noResults: "沒有結果",

  /** 單一源的篩選鈕與它的狀態。 */
  filter: "篩選",
  updating: "更新中…",
  /** 這個源的篩選不是源的預設值（前面那個「·」是刻意的）。 */
  filterChanged: "· 已改過篩選",
  /** 篩選鈕的無障礙標籤；`{name}` 是源的名字（資料）。 */
  filterLabel: "{name} 的搜尋篩選",

  /** 篩選 sheet。 */
  filterTitle: "搜尋篩選",
  filterApply: "套用",
  filterReset: "重設為源的預設值",
  /** 選項列自己沒有標籤時的替代字；`{n}` 是第幾列（1 起算）。 */
  filterFallback: "篩選 {n}",
  filterMulti: "可多選",
  filterSelect: "選擇",
  filterNone: "不指定",
  /** 排序篩選的遞增開關。 */
  filterAscending: "遞增",
  filterDescending: "遞減",

  /** 還沒送出關鍵字時的歷史搜尋。 */
  history: "歷史搜尋",
  historyEmpty: "輸入關鍵字搜尋所有已啟用的源",
  historyClear: "清除搜尋歷史",

  /**
   * 側邊欄每一列的無障礙標籤。狀態詞由 `{status}` 帶進來（見 `sidebarLabel.ts`）——
   * 以前是一個三層的三元運算式塞進字串插值，三種語言的標點與量詞都不同，組不出來。
   */
  sidebarLabel: "{label}，{status}",
  /** 這個源這一輪失敗了（不管有沒有結果數）。 */
  sidebarFailed: "搜尋失敗",
  /** 這個源還沒回來。 */
  sidebarPending: "等待結果",
  /** `{n}` 是這個源的結果數。 */
  sidebarCount: { one: "{n} 個結果", other: "{n} 個結果" },
}
