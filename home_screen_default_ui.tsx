// Scripting 預設首頁入口（Home Screen Tab UI）。
// 長駐於 Scripting 首頁分頁，不可調用 Navigation.present 與 Script.exit()。
// 採 hideTabBar 模式，導覽透過左上角選單切換。

import { Device, ProgressView, Script, ZStack, useEffect, useState } from "scripting"

import { App } from "./app/App"
import { createComicLibrary } from "./app/comic"
import { onBeforeExit } from "./app/lifecycle"
import { installLocaleSetting } from "./app/localeSetting"
import { installComicLibrary } from "./app/services"
import { PageBackground } from "./app/theme"
import { composeImage } from "./components/ModifyImageRenderer"
import { ensureFileAccess, fileAccess } from "./engine/fs"
import { setImageCompositor } from "./engine/imagecache"
import { flushLibrary, reloadLibraryFromDisk } from "./library/bookshelf"
import { reloadRegistry } from "./sources/registry"

let isInitialized = false

function initVesperForHomeScreen() {
  if (isInitialized) return
  isInitialized = true

  // 語言要在 render 期同步注入（讀 KV 是同步的，不需要授權也不用 await）：
  // 這個入口不能 await，第一輪 render 就該是對的語言。
  installLocaleSetting(Device.systemLocales)

  // 註冊退出/銷毀時落盤
  onBeforeExit(() => flushLibrary())

  // 圖片離屏合成器
  setImageCompositor(composeImage)

  // 畫面都透過 ComicLibrary 取資料，這個入口也是 composition root。
  installComicLibrary(createComicLibrary())
}

/**
 * 檔案授權確認後加載本機資料（若尚未授權則退守 KV 備援）。
 */
async function loadVesperData() {
  const granted = await ensureFileAccess()
  // 沒授權時 source 走 KV 備援，仍然是「現在該載的那份」，所以兩種情況都要 reload。
  reloadRegistry()
  if (granted) {
    reloadLibraryFromDisk()
  }
}

export default function HomeScreenDefaultUI() {
  // 於 render 階段建立服務實例（子畫面在 render 期間即依賴 ComicLibrary）
  initVesperForHomeScreen()

  const [dataReady, setDataReady] = useState(() => fileAccess() !== null)
  const [, setEventTick] = useState(0)

  useEffect(() => {
    // 授權結算後才載得到源與書架。在載入完成前不渲染 App，
    // 避免首頁（HomeScreen）在源尚未進入記憶體時就建構卡片，導致繼續閱讀等區塊誤判「源失效」。
    void loadVesperData().finally(() => {
      setDataReady(true)
    })

    // 監聽 Scripting 首頁分頁事件
    const unsubscribeTab = Script.onHomeTabEvent(event => {
      switch (event) {
        case "selected":
          // 從其他分頁切換回首頁
          reloadRegistry()
          setEventTick(t => t + 1)
          break
        case "reselected":
          // 已經在首頁時再次點擊首頁 icon
          break
        case "deselected":
          // 切換至其他分頁，將資料落盤
          void flushLibrary()
          break
      }
    })

    return () => {
      unsubscribeTab()
      void flushLibrary()
    }
  }, [])

  if (!dataReady) {
    return (
      <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <PageBackground />
        <ProgressView />
      </ZStack>
    )
  }

  return <App hideTabBar />
}
