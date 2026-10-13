// 閱讀器（`screens/shared/ReaderScreen.tsx`、`ResumeReaderScreen.tsx`）。
//
// 漫畫名、章節名、源的錯誤訊息都是源的資料，不翻；這裡只收我們自己寫的介面字。
// 「載入中…」沿用 `common.loading`，「單章」與收藏三態沿用 `detail.*`——同一件事同一句話，
// 不再各抄一份（詳情頁的收藏鈕與閱讀器的收藏鈕是同一顆）。

export default {
  /** 章節連標題都沒有時 HUD 上的替代字；`{n}` 是話數（1 起算）。 */
  chapterFallback: "第 {n} 話",

  /** 章節目錄（bottom sheet）。 */
  chaptersTitle: "章節目錄",
  /** `{n}` 是話數。中文沒有單複數，兩形同字——留著是為了跟英文同形。 */
  chapterCount: { one: "共 {n} 話", other: "共 {n} 話" },
  closeChapters: "關閉章節目錄",
  sortAscending: "改為章節正序",
  sortDescending: "改為章節倒序",
  /** 排序膠囊上的短標（旁邊有上下箭頭圖示）。 */
  sortAscendingShort: "正序",
  sortDescendingShort: "倒序",
  offlineOnlyDownloaded: "離線模式僅顯示已下載的章節",
  /** 快速跳轉至當前閱讀章節的按鈕文案。 */
  locateCurrent: "定位",
  readingBadge: "閱讀中",

  /** HUD。 */
  backToDetails: "返回漫畫詳情",
  readingSettings: "閱讀設定",
  /** 頁碼指示。`{page}`／`{total}` 都是頁。 */
  pageProgress: "第 {page} / {total} 頁",
  /** 還沒有頁數時的指示。`{index}`／`{total}` 都是話。 */
  chapterProgress: "{index} / {total} 話",
  dragToTurn: "拖曳翻頁",

  /** 換話列。 */
  previousChapter: "上一話",
  nextChapter: "下一話",
  atFirstChapter: "第一話",
  atLastChapter: "最後話",
  /** 換話鈕的無障礙標籤。`{label}` 是動作（「上一話」…），`{title}` 是章節名（源的資料）。 */
  chapterLinkLabel: "{label}：{title}",

  /** 章末提示。 */
  endOfBook: "— 已是全書最後一話 —",
  nextChapterShort: "下一話",

  /** 開章時蓋在畫布上的遮罩。載入中那句話沿用 `common.loading`。 */
  noImages: "這一章沒有圖片",

  /** 設定選單（右上角齒輪的 `Menu`）。 */
  mode: "閱讀模式",
  modeGallery: "畫廊",
  modeContinuous: "連續",
  direction: "閱讀方向",
  directionLtr: "左至右",
  directionRtl: "右至左",
  directionTtb: "縱向",
  gestureHint: "（縱向僅滑動）",
  tapZones: "三分區翻頁",
  hardwareSharpen: "AI 超解析度 (ACNet ONNX)",

  /** 續讀入口（`ResumeReaderScreen`）：不經詳情頁直開閱讀器，失敗只跳 toast。 */
  noChapters: "這部作品目前沒有章節",
  chapterUnavailable: "讀不到這一話",
  readerFailed: "載入閱讀器失敗",
}
