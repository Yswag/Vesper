// 詳情頁（`screens/shared/ComicDetailScreen.tsx`）、封面原圖檢視器（`CoverViewerScreen.tsx`）
// 與章節列。
//
// 來源回傳的資料不翻：書名、作者名、標籤、簡介內文、章節名、更新時間字串都是源的內容，
// 這裡只收我們自己寫的介面字。

export default {
  /** 章節既沒有標題也沒有分組名時，列上顯示的替代字。 */
  singleChapter: "單章",
  author: "作者：{name}",
  artist: "作畫：{name}",
  /** `{n}` 是章節數。中文沒有單複數，兩形同字——留著是為了跟英文同形。 */
  chapterCount: { one: "{n} 個章節", other: "{n} 個章節" },
  /** `{time}` 是源給的更新時間字串（不翻）。 */
  updatedAt: "更新於 {time}",
  uploadedAt: "發布於 {time}",
  likesCount: { one: "{n} 人喜愛", other: "{n} 人喜愛" },

  /** 源的連載狀態。 */
  statusOngoing: "連載中",
  statusCompleted: "已完結",
  statusCancelled: "腰斬",
  statusHiatus: "休刊中",
  statusNotPublished: "未出版",
  /** 內容分級：只有「建議」與 R18 會顯示。 */
  ratingSuggestive: "建議 15+",
  ratingNsfw: "R18",

  /** 閱讀入口：有續讀點是「繼續閱讀」，沒有是「開始閱讀」。 */
  resumeReading: "繼續閱讀",
  startReading: "開始閱讀",
  /** 入口的第二行：`{chapter}` 是章節名，`{n}` 是續讀頁碼。 */
  chapterAtPage: "{chapter} · 第 {n} 頁",
  /** 連章節標題都拿不到時的替代字。 */
  firstChapter: "首話閱讀",

  /** 收藏鈕：顯示字與無障礙標籤各一組。 */
  favorite: "收藏",
  unfavorite: "取消收藏",
  favorited: "已收藏",

  /** 簡介區。 */
  summary: "簡介",
  expand: "展開",
  collapse: "收起",

  /** 章節列表的工具列。 */
  chaptersTitle: "章節列表",
  select: "選取",
  sortAscending: "章節改為正序",
  sortDescending: "章節改為倒序",
  /** 選取模式的下載鈕；`{n}` 是還沒下載的章節數。 */
  downloadSelected: "下載 ({n})",
  downloadAll: "全載",

  /** 章節列的下載狀態。`{done}`／`{total}` 是已下載與總頁數。 */
  downloadQueued: "等待下載",
  downloadRunning: "下載中 {done}/{total}",
  downloaded: "已下載",
  incomplete: "未完成",
  incompleteProgress: "未完成 {done}/{total}",
  /** 章節列左滑的動作。 */
  download: "下載",
  resumeDownload: "繼續下載",

  /** 續讀徽章；`{n}` 是頁碼。 */
  lastRead: "上次讀到",
  lastReadAtPage: "上次讀到 · 第 {n} 頁",

  /** 封面原圖檢視器。 */
  coverFailed: "無法載入封面",

  /** 更多操作與相關推薦。 */
  openInBrowser: "在瀏覽器中開啟",
  recommendTitle: "相關推薦",
}
