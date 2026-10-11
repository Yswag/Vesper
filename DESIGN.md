# Vesper — 設計文檔

在 Scripting 裡跑**真正的 Venera 漫畫源**（源檔不改）的閱讀器。

## 核心理念

- **源檔不改**：直接執行 Venera 源，不修改、不轉換
- **深層模組**：UI 只透過 `app/comic.ts` 拿資料，不直接 import `sources/` 或 `engine/`
- **隔離沙箱**：源拿不到 `FileManager` / `Storage` / 原生 `fetch` / `Script`

## 依賴方向（唯一規則）

```
screens/ + components/
    ↓
  app/comic.ts  ← 唯一的 domain seam（不 import JSX）
    ↓
sources/ + engine/ + library/
```

- `screens/` 與 `components/` 只透過 `app/comic.ts`（ComicLibrary）拿資料。
- `app/comic.ts` 只依賴 `sources/`、`engine/`、`library/`；不 import JSX。
- `sources/runner.ts` 是源執行的唯一入口。
- `engine/` 不 import `sources/`（登入過期重試等由呼叫端注入）。

**例外**：設定頁的源管理（安裝／倉庫／登入）直接用 `sources/registry` —— 那是源管理而不是漫畫流程。

## 架構

```
index.tsx            入口：檔案存取 → 載入源 → fullScreen → 退出時 Script.exit()
home_screen_default_ui.tsx  Scripting 首頁分頁入口（同一個 App，差在沒有 tab bar：左上選單切分類）
app/                 應用外殼（TabView／單堆疊兩種）與 domain seam
  comic.ts           ComicLibrary：UI 與 sources/engine/library 之間的唯一介面
  services.ts        production instances（composition root）
  hostUI.tsx         源的 UI 呼叫（訊息／對話框／輸入／載入指示）
  theme.tsx          頁面底色（7×8 種組合，Storage 持久化）
  offlineSession.ts  下載背景續命（BackgroundKeeper）與退出縮小流程
engine/              源執行環境
  loader.ts          載入源檔（new Function 沙箱）
  globals.ts         shim 全域（ComicSource / Network / HtmlDocument / Convert / UI / fetch / setTimeout）
  dom.ts             cheerio → Venera DOM wrapper
  http.ts            統一 HTTP（header 注入 / cookie jar / 重試 / 併發限制）
  imageprocess.ts    modifyImage（獨立引擎，只給 Image API）
  imagecache.ts      縮圖磁碟快取（封面／頭像／留言圖）
  pageimages.ts      正文記憶體 LRU（24 頁／30MB，不落地）
  prefetch.ts        正文預取（往前 3、併發 2）
  scope.ts           取消範圍（per-key signal 疊層）
  offline.ts         離線層（manifest + 磁碟快取）
sources/
  runner.ts          SourceRunner：源執行唯一入口
  store.ts           源落地（一源一檔 + index.json）
  repository.ts      倉庫落地（repositories.json）
  registry.ts        記憶體源集合（訂閱通知）
  webLogin.ts        瀏覽器登入（cookie 播種／收割 / localStorage）
  operations.ts      源操作實作層（SourceRunner / downloads / search 用）
  downloads.ts       下載管理員（不綁畫面）
  search.ts          跨源聚合搜尋
library/
  bookshelf.ts       收藏 + 閱讀進度（記到章節+頁）
  readerSettings.ts  閱讀模式（畫廊/連續 × 左到右/右到左/上到下）
design/              共享樣式（唯一來源）
  tokens.ts          卡片底 · 填充 · 圓角 · 語意色 · 中性色
  layout.tsx         PageScroll · Card · CardGroup · GroupHeader
  rows.tsx           IconRow · OptionRow · ToggleRow · FieldRow · ActionRow
  status.tsx         NoticeBanner · EmptyState · PageLoading
  Glass*.tsx         液態玻璃（Surface / Toolbar / Badge / Filter）
i18n/                三語字典（zh-Hant / zh-Hans / en）與切換狀態
components/          漫畫相關共用 UI
  ModifyImageRenderer.tsx  貼圖清單 → 離屏合成 → PNG（註冊進 engine）
screens/             各頁面（依 tab 分目錄：home / bookshelf / browse / search / settings / shared）
  shared/ReaderScreen.tsx  閱讀器（畫廊/連續 × 三方向 · HUD）
```

`modifyImage` 是源給的 JS 字串（不是函式），跑在獨立引擎裡：只給 `Image` API 與無害的標準物件，拿不到源實例、`Network`、`FileManager`。它的 7 個成員全部同步、越界拋錯，引擎只累積貼圖清單（純幾何），真正的合成由 UI 層注入。

圖片抓失敗時會跑源的 `onLoadFailed()`（回新設定就換掉重試，回 `null` 就放棄）。它是一次性的：新設定要自己再帶一個 `onLoadFailed` 才會繼續重試。

源規格以 Venera 官方 `doc/api/*.md` 為準，**不搬 `init.js` 的程式碼**；文件未載明處以「主要源跑得起來」為驗收。專案**不受 GPL 傳染**。

## v1 支援矩陣

**支援**：`Network`（get/post/put/delete/sendRequest/fetchBytes + cookie）· `HtmlDocument`（同步）· `Convert`（utf8/base64/md5/sha1/sha256/sha512/hmac/aes-cbc/aes-ecb）· `loadData`/`saveData`/`deleteData` · `loadSetting`（唯讀）· `isLogged` · `UI`（showMessage/showDialog/showInputDialog/launchUrl）· `fetch` · `setTimeout` · `randomInt` · `compute`（取完成值、參數展開）· `onResponse` · `onLoadFailed` · `modifyImage`（含 `Image` API 7 個成員）· 圖片 header 注入 · `explore`／`category.parts`／`categoryComics.ranking` · `loginWithWebview`（瀏覽器登入）· 留言（`comic.loadComments`／`sendComment`；富文本與圖片，留言不落地）· 離線閱讀（章節下載、下載管理頁、背景續傳開關）· 登入過期自動重登（只認源丟的 `Login expired`：用存好的憑證重登一次再重試，涵蓋探索／搜尋／分類／排行／詳情／章節／圖片解析／留言讀寫）· 章節分組（巢狀 `Map<GroupName, Map<ChapterId, Title>>` 支援）· 來源網址外開（Safari 獨立圓形按鈕）· 相關推薦漫畫（`recommend` 橫向海報列）· 評分：詳情的 `stars` **只讀顯示**（不寫入源站）與點贊數（`likesCount` 膠囊展示）· 縮圖標頭注入（`comic.onThumbnailLoad` 支援）

**不支援（UI 明確標示）**：Cloudflare 自動過盾（Venera 的 host 級 interceptor：`403` + `cf-mitigated: challenge` 就自己彈瀏覽器）· `saveSetting`

**刻意不做**：源端收藏與評分寫入（`favorites`／`starRating`）——要寫回源站帳號，用不到 · 源端 `archive` 下載檔——只有 `ehentai` 一個源有（走 `http_client: "dart:io"` 那條）· `translation`（來源端翻譯，用不到）

**已知落差**（也寫在 README）：`Network` 的 `http_client`／`prevent-parallel`／`cache-time`——Venera 的網路有兩條（rhttp 與源指定的 `dart:io`），可逐請求挑；Vesper 統一走 `fetch`，這三個選項不會生效（`http_client` 也不會漏成 header）。實測 `picacg`（每個請求都帶這個旗標）登入後正常。

**背景下載**是「盡量」不是「保證」：`BackgroundKeeper`（Scripting Pro）只在真的跑到時續命，系統仍可能結束 App，所以「從中斷處續傳」是必要的（一章要每一張都到齊才算完成）。**離線層**在 `<documents>/Vesper/offline/`，與縮圖快取分開，設定頁的「清除縮圖快取」不會動到它。

**登入**：三種都支援 —— `account.login`（帳密）、`loginWithCookies`（純表單）、`loginWithWebview`（開一個真的瀏覽器，Cloudflare 過盾與 localStorage 型的憑證走這條）。
瀏覽器登入的成本寫在 `sources/webLogin.ts`：Scripting 的 `WebViewController` 沒有任何導航事件，所以「有變化才問 `checkStatus`」是靠輪詢實作的；cookie 只收同網域的，而且只在使用者按下登入時才開視窗。

## UI

- 五 tab 骨架；搜尋頁為全螢幕 push，底部換成「輸入欄 + 清除」。
- 源頁（`SourceScreen`）：導覽列右上下拉切「探索 / 分類 / 排行」，源沒宣告的頁面不列；三棵子樹各自載入與翻頁。
- 搜尋：左側窄側邊欄（全部 + 各源，右對齊結果數，選中深色圓角），右側 2 欄結果網格；不混排、不排序、不重掃。
- 搜尋前：只顯示歷史搜尋。
- 源卡片顯示能力徽章（登入 / CF / 圖片處理），不支援者進詳情時給可解釋的錯誤。
- 源倉庫（`設定 → 漫畫源 → 源倉庫`）：加入索引只保存與列出，**不裝任何源**；進倉庫逐筆安裝 / 更新。清單讀本地快取，重新整理才連網。
- 內建 Log 檢視頁。
- 詳情頁：源有留言就多一個「留言」入口（未登入也看得到，只是送出會失敗）與章節區塊的「選取」／「下載全部」，章節列直接顯示離線狀態。支援章節分組切換、來源網址 Safari 開啟、點贊數與相關推薦海報列。閱讀器頂部 HUD 整合目錄抽屜（`list.bullet`）與齒輪設定選單，底部 HUD 為緊湊進度膠囊。設定頁多一頁「下載」（進行中／未完成／已完成、取消、刪除、佔用、背景續傳開關）。

## 資料

- 源：`<documents>/Vesper/sources/<key>.js` + `index.json`。存放抽象成模組，之後換 iCloud 只改一處。
- 倉庫：`<documents>/Vesper/sources/repositories.json`；只存索引與條目快取，加入不裝源，安裝是逐筆的動作。
- 書架：`<documents>/Vesper/library.json`；源被刪除**不**清書架紀錄，只標記「源已移除」。
- 快取：正文只在記憶體（一次閱讀、往前 3 頁預取）；縮圖（封面／頭像／留言圖）走磁碟，不快取下一話。
- 離線：`<documents>/Vesper/offline/<鍵的雜湊>/`（頁面 `.bin` + `manifest.json`）；與縮圖快取分開，清除縮圖快取不會動到它。

## 驗收線

大部分 `venera-configs` 源能走完基本流程（探索 → 詳情 → 章節 → 看到圖）。失敗的主要原因：
- 自架伺服器需要配置（komga / kavita / lanraragi）
- 需要登入或地區封鎖
- 站方改版或 DOM 結構變動

## 風險

1. 文件未載明的行為落差 → 以 33 源當測試套件，落差當頭號風險管。
2. 部分站點實際有 Cloudflare（源內沒寫）→ 實測才知道，可能下修驗收線。
3. 同步 DOM 解析成本（實測 cheerio 318 KB 約 163 ms）→ 單頁可接受，長頁需注意。
