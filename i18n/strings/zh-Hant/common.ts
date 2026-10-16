// 通用訊息。**這一支是所有 key 的來源**：`t()` 的 key 型別由這裡的形狀推導，
// 另外兩份語言的 key 集合也被綁成同一個形狀（見 `../index.ts`）。
//
// 通用＝跨畫面重複出現、而且不屬於任何一個畫面的字；畫面自己的字在各自的領域檔。

export default {
  /** 浮動載入指示沒有訊息時的字（源沒給 message）。 */
  working: "處理中…",
  /** 輸入框的提示字。 */
  input: "輸入",
  confirm: "確定",
  /** 源沒給標題時的替代字。 */
  untitled: "(無標題)",
  /** 封面載入失敗。 */
  noCover: "無封面",
  /** 圖片的位元組解不回 UIImage。 */
  undecodable: "無法解碼",
  /** 退出鈕的存取標籤。 */
  exitLabel: "退出 Vesper，返回 Scripting",
  /** 縮小失敗時問使用者的那則對話框（見 app/offlineSession.ts）。 */
  exitBlockedTitle: "無法縮小到背景",
  exitBlockedMessage: "可能是開了多視窗模式。關閉會中斷下載（已經抓到的頁會留著）。",
  exitContinue: "繼續下載",
  exitAnyway: "仍要退出",
  /** 清單到底了（JSX 文字，不是字串字面值——掃描器抓得到、只找引號的抓不到）。 */
  allShown: "— 已顯示全部內容 —",
  /** 載入失敗：`{message}` 是原因。 */
  loadFailed: "載入失敗：{message}",
  /** 重試。 */
  retry: "重試",
  /** 留言裡的圖片載不出來。 */
  imageFailed: "（圖片載入失敗）",
  /** 續讀卡與歷史卡片的標籤：這一筆是在離線模式讀的（掛在來源名前面那一段）。 */
  offlineTag: "離線",

  /** 正文越界：`{n}` 是第幾頁（1 起算），`{total}` 是總頁數。 */
  pageMissing: "第 {n} 頁不存在（共 {total} 頁）",
  /** 頁數。中文沒有單複數，兩形同字——留著 `one`/`other` 是為了跟英文同形。 */
  pages: { one: "{n} 頁", other: "{n} 頁" },

  /**
   * 五個分類（＝五個分頁）的標題。
   *
   * 分頁列的 `<Tab title>` 與沒有分頁列時的切換選單都讀同一份（見 `app/sections.ts`），
   * 所以這裡是標題的唯一來源——以前那兩處各抄了一份中文。
   */
  tabs: {
    home: "首頁",
    bookshelf: "書架",
    browse: "瀏覽",
    settings: "設定",
    search: "搜尋",
  },
  /** 沒有分頁列時那顆切換分類的存取標籤：`{title}` 是目前分類。 */
  sectionMenu: "切換分類，目前是{title}",

  /** 按鈕與對話框的動詞。 */
  cancel: "取消",
  save: "儲存",
  add: "加入",
  delete: "刪除",
  remove: "移除",
  clear: "清除",
  /** 進行中：`{label}` 是動作本身（「登入…」／「加入…」）。 */
  inProgress: "{label}…",
  /** 失敗：`{message}` 是原因（可能是源或網路給的字）。 */
  failed: "失敗：{message}",

  /** `design/status` 兩個元件的預設文案（呼叫端沒給字時顯示的）。 */
  loading: "載入中…",
  loadingMore: "載入更多中…",

  /** 初次啟動準備環境與安裝核心依賴。 */
  preparingEnv: "正在準備閱讀器環境…",
  installingCoreDeps: "初次啟動正在安裝必要核心依賴 (cheerio, crypto-js)，請稍候數秒…",
  depsInstallFailed: "核心依賴安裝失敗。請確認網路連線後重試。",
  depsRetryInstall: "重試安裝",
  depsMissing: "核心依賴 {name} 未安裝。請到「設定 → 核心依賴」重新安裝後再試。",
}
