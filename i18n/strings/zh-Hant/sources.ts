// 源層自己寫、會被使用者看到的訊息：`sources/**`、`engine/cloudflare.ts`、`app/comic.ts`、離線 session。
//
// 來源回傳的資料（標題、標籤、選項名）與 `log()` 診斷不進字典（見 spec 跨票規則 1）：
// 那些是資料與開發訊息，收了只會讓字典變成雜物間。

export default {
  /** 源的宣告缺某個能力；畫面用「失敗：{message}」把它顯示出來。 */
  unsupported: {
    search: "這個源不支援搜尋",
    searchPaging: "這個源的搜尋不支援翻頁",
    category: "這個源不支援分類列表",
    ranking: "這個源沒有排行榜",
    detail: "這個源不支援讀取詳情",
    chapter: "這個源不支援讀取章節",
    comments: "這個源不支援讀取留言",
    sendComment: "這個源不支援送出留言",
    account: "這個源不支援帳密登入",
    cookie: "這個源不支援 Cookie 登入",
    browser: "這個源不支援瀏覽器登入",
    /** 探索分類宣告了卻沒有載入函式；`{title}` 是那一條的標題。 */
    explore: "「{title}」目前無法載入（這個源沒有提供載入函式）",
    /** `{n}` 是探索分類的序號（1 起算）。 */
    exploreIndex: "這個源沒有第 {n} 個探索分類",
  },

  /** 源找不到、或載不進沙箱。 */
  notLoaded: "{name} 沒有載入成功",
  notLoadedShort: "源沒有載入",
  notFound: "找不到來源 {key}",
  codeMissing: "找不到源碼",

  /** 源沒給名字時畫面用的替代字（`{n}` 是序號，1 起算）。 */
  exploreFallback: "探索 {n}",
  categoryFallback: "分類 {n}",
  /** 詳情沒有標題時的替代字。 */
  untitled: "(無標題)",
  /** 這一章一張圖都拿不到。 */
  emptyChapter: "這一章沒有可用的圖片",
  commentEmpty: "留言內容不能只有空白",

  /** 離線閱讀：manifest 裡沒有這一章、或這一頁的檔案不見了。 */
  notOffline: "這一章不在離線儲存裡",
  /** `{n}` 是頁碼（1 起算）。 */
  pageUnreadable: "第 {n} 頁讀不到（檔案不存在或已損壞）",

  /** Cloudflare 過盾視窗的標題；`{name}` 是來源名稱。 */
  verificationTitle: "請完成安全驗證 ({name})",

  /** Aidoku（WASM）源。`{message}` 是源自己或宿主給的原因。 */
  aidoku: {
    failed: "源出錯：{message}",
    missing: "源的檔案不見了（請重新安裝這個源）",
    timeout: "源回應逾時",
    initFailed: "源初始化失敗",
    invalidPackage: "這不是有效的 Aidoku 源檔（.aix）",
    chapter: "第 {n} 話",
    /** 源被判定不可用；`{reason}` 是最後一次的失敗原因。 */
    unavailable: "這個源暫時不可用（{reason}），到來源設定關掉再開就會重新嘗試",

    /** 倉庫索引（community／zh-sources 兩種 schema）。 */
    indexInvalid: "Aidoku 索引格式不對（要 { sources: [...] } 或 JSON 陣列）",
    /** `{id}` 是索引條目裡的源 id。 */
    indexBadId: "源 id 不合法：{id}",
    indexBadEntry: "索引條目缺 name、version 或下載路徑",
  },

  /** 登入（帳密 / cookie / 瀏覽器）。 */
  login: {
    expired: "登入已過期，請重新登入",
    cancelled: "已取消登入",
    done: "已登入",
    /** `{count}` 是瀏覽器登入收下的 cookie 數。 */
    cookiesSaved: { one: "已存下 {count} 個 cookie", other: "已存下 {count} 個 cookie" },
    /** 瀏覽器登入成功後記在源上的帳號名稱（這條路本來就沒有帳號）。 */
    webAccount: "WebView 登入",
    /** 登入視窗的標題；`{name}` 是來源名稱。 */
    windowTitle: "登入 {name}",
    windowBusy: "已經有一個登入視窗開著",
    /** 逾時訊息的主詞（`timeout` 的 `{subject}`）。 */
    pageLoading: "網頁載入",
    pageLoadFailed: "網頁載入失敗：{message}",
    callback: "源的 onLoginSuccess()",
    /** `{subject}` 逾時；`{seconds}` 是秒數。 */
    timeout: "{subject}逾時（{seconds} 秒）",
    validateFailed: "驗證失敗，請檢查輸入內容",
    /** 使用者自己關掉登入視窗、但抓到了 cookie 時的確認框。 */
    incompleteTitle: "登入未完成",
    incompleteMessage: {
      one: "這次沒有偵測到登入成功。要把剛才取得的 {count} 個 cookie 存下來嗎？",
      other: "這次沒有偵測到登入成功。要把剛才取得的 {count} 個 cookie 存下來嗎？",
    },
    saveCookies: "存下",
  },

  /** 倉庫索引的解析與匯入。 */
  catalog: {
    notArray: "索引不是 JSON 陣列",
    notObject: "不是物件",
    badFields: "name / key / version 必須是字串",
    badKey: "key 不合法：{key}",
    badVersion: "version 不合法：{version}",
    noTarget: "url 與 fileName 至少要有一個",
    /** 一條都裝不了；`{reason}` 是第一個被跳過的原因。 */
    empty: "索引裡沒有可用的源",
    emptyWithReason: "索引裡沒有可用的源（{reason}）",
    /** 索引裡被跳過的條目，在報告裡的名字。 */
    entryLabel: "(索引條目)",
    singleObject: "這是單一 JSON 物件，不是源也不是索引",
    isRepository: "這是倉庫索引，請改用「源倉庫」加入",
    repositoryNotArray: "倉庫索引必須是 JSON 陣列（index.json）",
    duplicateSkipped: "同一批裡有同 key 的另一個變體，只保留第一個",
    relativeOnly: "只有相對路徑，請改用索引的網址匯入",
    keyMismatch: "源的 key 不符：預期 {expected}，實際 {actual}",
    downloadFailed: "下載失敗：HTTP {status}",
  },

  /** 源倉庫清單頁的操作。 */
  repository: {
    urlRequired: "請輸入倉庫網址",
    notFound: "找不到這個倉庫",
    entryNotFound: "倉庫裡沒有這個源",
  },

  /** 源宣告的 `type: "callback"` 設定項沒有可呼叫的函式。 */
  settingNoAction: "這個設定沒有可執行的動作",
}
