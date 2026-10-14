# Vesper 架構設計

在 Scripting 中執行原生 Venera 漫畫源的架構規格。

## 依賴方向

```
screens/ + components/
         ↓
    app/comic.ts          ← 唯一的領域層介面（不依賴 JSX）
         ↓
sources/ + engine/ + library/
```

- **Domain Seam**：UI 層只透過 `app/comic.ts`（`ComicLibrary`）獲取資料，不直接跨層引用 `sources/` 或 `engine/`。
- **單一執行入口**：`sources/runner.ts` 是源執行的唯一入口；`engine/` 不反向依賴 `sources/`。
- **例外**：設定頁的源管理（安裝、倉庫、登入）直接操作 `sources/registry`。

## 模組劃分

```
index.tsx            應用入口：權限確認、初始化與全局全螢幕
app/                 外殼與領域聚合
  comic.ts           ComicLibrary：UI 與各核心子系統的統一邊界
  services.ts        Composition root
  hostUI.tsx         源呼叫之原生 UI（彈窗、輸入框、提示）
  theme.tsx          底色主題配置與持久化
engine/              源執行沙箱與媒體管線
  loader.ts          源檔案載入與沙箱執行
  globals.ts         Venera 運行時 Shim（Network / HtmlDocument / Convert / UI 等）
  dom.ts             同步 DOM 解析封裝（Cheerio）
  http.ts            統一 HTTP 請求、Cookie 管理與併發限制
  imageprocess.ts    modifyImage 幾何累積引擎
  imagecache.ts      縮圖磁碟快取與自動清理
  pageimages.ts      正文圖片管線（記憶體快取與預取）
  pagefiles.ts       正文頁面暫存檔（位元組落地、格式嗅探、session 生命週期）
  upscale.ts         ACNet ONNX 2x 超解析度引擎（WebViewController 沙箱 + LRU 位元組快取）
  offline.ts         離線章節下載與讀取
sources/             漫畫源管理
  runner.ts          SourceRunner：執行源邏輯的唯一中介
  store.ts           源腳本儲存
  repository.ts      源倉庫索引與訂閱
  registry.ts        運行時源註冊表
  webLogin.ts        WebView 登入與 Cloudflare 驗證代理
  downloads.ts       下載排程與狀態管理
  search.ts          跨源併發搜尋聚合
library/             使用者資料
  bookshelf.ts       收藏清單與閱讀進度
  readerSettings.ts  閱讀模式與方向設定
design/              設計庫（Token、版面、列元件、液態玻璃、狀態）
components/          共用元件（閱讀器圖片、縮放容器、圖片合成器）
screens/             各功能分頁（home / bookshelf / browse / search / settings / shared）
```

## 核心設計約定

1. **源腳本沙箱**：
   - 源腳本執行於受限環境，無法直接存取 `FileManager`、`Storage` 或宿主原生私有 API。
   - `modifyImage` 僅暴露同步幾何累積 API，實際影像渲染由 UI 離屏合成器處理。

2. **圖片與快取層級**：
   - **正文圖片**：預取走記憶體管線（前方 3 頁）；要顯示的那一頁才落地成暫存檔（`Canvas.drawImage` 需要檔案路徑），生命週期＝開啟的那一話，離開閱讀器即刪除，App 被殺掉留下的殘檔下次開場清掉。
   - **縮圖快取**：封面、頭像與留言圖片落地儲存，由 LRU 機制維持容量上限。
   - **超解析度快取**：ACNet ONNX 產生的超分圖限制最多保留 6 張（LRU，存的是 JPEG 位元組），切換章節時即時釋放。
   - **離線儲存**：下載內容獨立存於 `offline/`，不受快取清理影響。

3. **閱讀器生命週期**：
   - 換話採就地置換（原地變更 `currentEpId`），避免 Navigation 堆疊過深。
   - 末頁透過 Overscroll（過度捲動手勢）觸發進入下一話。

## 資料儲存路徑

- 漫畫源腳本：`文件/Vesper/sources/<key>.js`
- 倉庫設定：`文件/Vesper/sources/repositories.json`
- 書架與歷史：`文件/Vesper/library.json`
- 閱讀暫存頁面：`文件/Vesper/cache/reader/<一話一個目錄>/`（離開閱讀器即刪）
- 離線章節：`文件/Vesper/offline/<comicKey>/<epId>/`
