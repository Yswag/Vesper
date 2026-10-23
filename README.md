# Vesper

在 [Scripting](https://scripting.fun) 上執行的漫畫閱讀器，相容 [Venera](https://github.com/venera-app/venera) 與 [Aidoku](https://github.com/Aidoku/Aidoku) 漫畫源規範。

## 功能

- **漫畫源生態**：支援 Venera 與 Aidoku 雙格式漫畫源與倉庫索引，可直接安裝、更新與搜尋篩選。
- **瀏覽與檢索**：支援各源的探索、分類標籤、排行榜與跨源聚合搜尋。
- **閱讀器體驗**：
  - 支援畫廊分頁與平滑連續捲動（左至右、右至左、縱向）。
  - 末頁邊緣拉動（Overscroll）無縫進入下一話。
  - 整合式目錄抽屜、閱讀進度記憶與分頁預取。
  - 內建 ACNet ONNX 超解析度畫面增強（具備 LRU 記憶體控制）。
- **書架與歷史**：收藏清單、續讀卡片、閱讀歷史精確記錄至章節與頁碼。
- **離線閱讀**：支援章節批量下載、離線閱讀與儲存空間管理。
- **社群與帳號**：支援源端留言瀏覽，提供帳密、Cookie 與網頁登入方式（憑證安全存於 Keychain）。
- **介面客製**：支援繁體中文、簡體中文與英文多語系，多款自訂頁面底色主題。

## 快速開始

1. 於 Scripting App 內執行專案，首次啟動請授予**檔案存取**權限（資料存於 `文件/Vesper/`）。
2. 至 **設定 → 漫畫源 → 源倉庫** 新增索引並安裝漫畫源：
   - 社群索引：`https://raw.githubusercontent.com/venera-app/venera-configs/main/index.json`
3. 安裝完成後即可在**瀏覽**或**搜尋**中開始閱讀。

## 感謝

介面設計與源生態規格靈感來自 [venera-app/venera](https://github.com/venera-app/venera)、[CyrilPeng/Venera-Next](https://github.com/CyrilPeng/Venera-Next) 與 [Aidoku/Aidoku](https://github.com/Aidoku/Aidoku)。
