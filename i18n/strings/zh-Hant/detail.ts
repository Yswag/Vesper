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
  /** 有章節但全部被源鎖定（付費／登入）時，閱讀入口顯示的狀態。 */
  allChaptersLocked: "所有章節已鎖定",

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
  /** 選取模式的標題與結束鈕。 */
  selectedCount: "已選 {n} 話",
  selectDone: "完成",
  sortAscending: "章節改為正序",
  sortDescending: "章節改為倒序",
  /** 選取模式的下載鈕；`{n}` 是還沒下載的章節數。 */
  downloadSelected: "下載 ({n})",
  downloadAll: "下載全部",
  /** 選取模式的已讀鈕；`{n}` 是已選章節數。 */
  markSelectedRead: "已讀 ({n})",
  /** 章節工具列選單：一次把當前分組全部標成已讀。 */
  markAllRead: "全部標為已讀",
  /** 全選與取消全選 */
  selectAll: "全選",
  deselectAll: "取消全選",
  moreActions: "更多操作",

  /** 章節列的下載狀態。`{done}`／`{total}` 是已下載與總頁數。 */
  downloadQueued: "等待下載",
  downloadRunning: "下載中 {done}/{total}",
  downloaded: "已下載",
  incomplete: "未完成",
  incompleteProgress: "未完成 {done}/{total}",
  /** 章節列左滑的動作。 */
  download: "下載",
  resumeDownload: "繼續下載",
  markRead: "標為已讀",
  markUnread: "標為未讀",
  /** 章節列長按選單；「之前的章節」是子選單，裡面是標為已讀／未讀。 */
  previousChapters: "之前的章節",
  cancelDownload: "取消下載",
  removeDownload: "移除下載",

  /** 續讀徽章；`{n}` 是頁碼。 */
  lastRead: "上次讀到",
  lastReadAtPage: "上次讀到 · 第 {n} 頁",

  /** 封面原圖檢視器。 */
  coverFailed: "無法載入封面",

  /** 更多操作與相關推薦。 */
  openInBrowser: "在瀏覽器中開啟",
  recommendTitle: "相關推薦",

  /** 換源：在目前來源以外找同一部作品。 */
  switchSource: "切換來源",
  switchSourceSearching: "正在搜尋其他來源",
  switchSourceEmpty: "其他來源找不到這部作品",
  switchSourceNoOthers: "沒有其他已啟用的來源",
}
