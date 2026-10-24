// 搜尋（`screens/search/**`、單一源結果頁的篩選）：每個源一排的結果列表、篩選 sheet、歷史搜尋。
//
// 源的東西一律不翻：漫畫標題，以及 `optionList` 的標籤與選項顯示名（後者是 `"值-顯示名"`
// 的顯示半邊，見 `sources/searchOptions.ts`）——那些是源回傳的資料。
// 導覽列標題也不在這裡：它與搜尋分頁的標題同一個字，來源是 `common.tabs.search`。

export default {
  /** 系統搜尋框的提示字。 */
  keyword: "關鍵字",

  noSources: "尚無已啟用的源",
  noResults: "沒有結果",
  /** 一排的標題列：源名後面的筆數。`{n}` 是這個源的結果數。 */
  rowCount: { one: "{n} 筆", other: "{n} 筆" },
  /** 推入該源完整結果的那一列的無障礙標籤；`{name}` 是源的名字（資料）。 */
  openSource: "開啟 {name} 的全部結果",
  /** 底部收合區：0 筆與失敗的源。`{n}` 是收進去的源數。 */
  closedTitle: "沒有結果或失敗（{n}）",

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
}
