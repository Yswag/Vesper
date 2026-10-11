// Scripting 預設首頁入口 (Home Screen Tab UI)
// 當在 Scripting 設定中開啟「Show Home Tab」並選擇 Vesper 時，本組件將直接渲染於 Scripting 首頁分頁。
// 注意：
// 1. 不可呼叫 Navigation.present
// 2. 不可呼叫 Script.exit()
// 3. 實例長駐於記憶體，支援 Script.onHomeTabEvent 監聽 tab 切換事件
//
// 這一頁本身就是 Scripting 的一條 tab，所以 App 用 hideTabBar：不要 tab bar，
// 五個分類改由導覽列左上角的選單切換。

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
 * 授權結算後才把盤上的資料載進來。
 *
 * 源與書架都在盤上（`<documents>/Vesper`），而 store 在授權還沒結算時會退回 Storage KV
 * —— 那個 KV 是空的，畫面看起來就像「一個源都沒裝」，而且不會自己好（要等別頁再 reload 一次）。
 * index.tsx 是 `await ensureFileAccess()` 之後才 `reloadRegistry()`；這個入口不能 await
 *（身體要直接回傳畫面），所以改成載完補一次 reload。
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
  // 一定要在 render 就接好 composition root：子畫面（HomeScreen…）在 render 期間就會跟
  // ComicLibrary 要資料，而 effect 是等這一輪 build 完才跑 —— 放 effect 會直接炸
  // 「ComicLibrary 還沒建立」。index.tsx 也是同一個順序（先 install 再 present）。
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
