import { Device, Navigation, Script } from "scripting"

import { App } from "./app/App"
import { createComicLibrary } from "./app/comic"
import { listenForInstallLinks, readInstallTarget } from "./app/installLink"
import { onBeforeExit } from "./app/lifecycle"
import { installLocaleSetting } from "./app/localeSetting"
import { installOfflineSession } from "./app/offlineSession"
import { installComicLibrary } from "./app/services"
import { composeImage } from "./components/ModifyImageRenderer"
import { ensureFileAccess } from "./engine/fs"
import { autoCleanImageCache, purgeLegacyImageCacheOnce, setImageCompositor } from "./engine/imagecache"
import { flushLibrary, reloadLibraryFromDisk } from "./library/bookshelf"
import { reloadRegistry } from "./sources/registry"

async function run() {
  // 書架/進度是去抖寫入的，退出前一定要落盤。
  onBeforeExit(() => flushLibrary())

  // 連結帶進來的安裝請求：冷啟動看 queryParameters，實例活著時再點則走 onResume。
  // 畫面還沒起來，所以只把目標傳給 App，由它在掛載後確認、加入、跳轉。
  const pendingInstall = readInstallTarget(Script.queryParameters)
  listenForInstallLinks()

  // 源的存放需要檔案存取；在呈現 UI 之前先問一次，系統會記住使用者的選擇。
  // 被拒絕也照常啟動，只是退回 Storage 儲存並在源管理頁顯示警告。
  await ensureFileAccess()

  // 語言要在畫面之前注入：`t()` 任何時刻都安全（硬寫預設繁中），但第一輪 render 就該是對的語言。
  // 「跟隨系統」在這裡結算一次（清單由我們注入，i18n 自己維持零依賴）；之後使用者在設定頁
  // 切語言走 `applyLocaleSetting`，不需要再經過這個入口。
  installLocaleSetting(Device.systemLocales)

  reloadLibraryFromDisk()

  // 舊版的圖片快取（正文與縮圖混在同一個目錄）整個清掉一次；縮圖會自己重建。
  purgeLegacyImageCacheOnce()
  // 啟動時非同步觸發一次縮圖快取策略清理（過期天數與容量上限淘汰）。
  void autoCleanImageCache()

  // 圖片管線的 modifyImage 需要離屏渲染，engine 不碰 UI，所以由這裡把合成器接上去。
  setImageCompositor(composeImage)

  // 只把源載進記憶體（純本地、很快）。**不在這裡跑源的 init()**：
  // 那是按需的 —— 用到哪個源才初始化哪個，開場不該被最慢的源（或壞掉的源）綁住。
  reloadRegistry()

  // ComicLibrary 的 production instance（Phase 0：先建好放著，UI 仍走舊入口）。
  installComicLibrary(createComicLibrary())

  // 下載的背景時間與「下載中按退出＝縮小」都由它接手（會註冊退出關卡）。
  installOfflineSession()

  await Navigation.present({
    element: <App pendingInstall={pendingInstall} />,
    modalPresentationStyle: "overFullScreen",
  })
  // present 的 promise 在畫面被關閉後才 resolve；不 exit 會留下殭屍實例。
  Script.exit()
}

void run()
