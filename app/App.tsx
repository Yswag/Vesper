// 應用外殼。兩種殼，差在「分頁怎麼切」：
//
// 1. 預設（index.tsx）：五個 tab 的 TabView，每個 tab 一棵自己的 NavigationStack（切 tab 不丟導航歷史）。
//    搜尋是最後一個 tab 且標記 role="search"：iOS 會把它放在最右，並提供「展開成輸入框、
//    同時收起其他 tab」的原生行為。
//    tabViewSearchActivation="searchTabSelection" 是那個展開行為的開關（沒有它就不會展開）。
//    它同時也會自動聚焦、彈鍵盤——所以 SearchScreen 把 searchable 的 presented 綁起來，
//    讓系統回報展開狀態；但**不要**把它設成 false（那是「取消搜尋」，會把 tab 切回上一個）。
//
// 2. hideTabBar（沒有分頁列）：單一 NavigationStack + 導覽列左上角的切換分類選單
//    （components/SectionMenu）。代價：切分類會重建畫面，各分類的導航歷史與頁面狀態不留。
//    Scripting 首頁分頁現在是自己的 Mini Hub（home_screen_default_ui.tsx），不再走這個殼。
//
// 啟動 2.5 秒後靜默查一次追更（TTL 與讓路都在 app/updates.ts）。
//
// toast 掛在殼上：源的 UI.showMessage 需要一個全域出口（見 app/toast.ts）。
// 載入指示同樣掛殼的 overlay：源的 UI.showLoading 要一張浮動小卡片，不是 modal（見 app/loadingState.ts）。

import { Navigation, NavigationStack, Tab, TabView, ZStack, useEffect, useObservable, useState, type VirtualNode } from "scripting"

import {
  InstallFailedView,
  PreparingView,
  areDependenciesInstalled,
  installMissingDependencies,
} from "./dependencies"
import { PageBackground, useTint } from "./theme"
import { liquidGlass } from "../design/glass"
import { SECTIONS } from "./sections"
import { useSubscription } from "./useSubscription"
import { subscribe as subscribeLocale, t } from "../i18n"
import { CustomDialogOverlay } from "./CustomDialogOverlay"
import { LoadingHUD } from "./LoadingHUD"
import { setToastListener } from "./toast"
import { setTabBarHidden, setTabChangeListener, switchToTab } from "./navigation"
import { setInstallListener } from "./installLink"
import { updatesScheduler } from "./updates"
import { addRepository } from "../sources/registry"
import { BookshelfScreen } from "../screens/bookshelf/BookshelfScreen"
import { RepositoryDetailScreen } from "../screens/settings/RepositoryDetailScreen"
import { BrowseScreen } from "../screens/browse/BrowseScreen"
import { HomeScreen } from "../screens/home/HomeScreen"
import { SearchScreen } from "../screens/search/SearchScreen"
import { SettingsScreen } from "../screens/settings/SettingsScreen"

/** 依賴狀態。 */
type DepsState = "installing" | "failed" | "ready"

/** 啟動後多久才背景查追更：先讓首屏與依賴安頓下來。 */
const STARTUP_UPDATE_DELAY = 2500

/** 分頁編號 → 畫面。順序要跟 app/sections.ts 的 SECTIONS 一致（切換分類的選單照它畫）。 */
function sectionScreen(index: number): VirtualNode {
  switch (index) {
    case 1:
      return <BookshelfScreen />
    case 2:
      return <BrowseScreen />
    case 3:
      return <SettingsScreen />
    case 4:
      return <SearchScreen />
    default:
      return <HomeScreen />
  }
}

export function App({ hideTabBar = false, pendingInstall = null }: {
  hideTabBar?: boolean
  /** 冷啟動時由入口從 URL scheme 帶進來的倉庫網址。 */
  pendingInstall?: string | null
}) {
  // 安裝失敗不放行：沒有依賴的話每個源、每張圖都會爆。
  const [depsState, setDepsState] = useState<DepsState>(() => (areDependenciesInstalled() ? "ready" : "installing"))
  const selection = useObservable<number>(0)
  // 根層 tint：會繼承的控制項（Toggle、borderless Button、menu Picker）跟主題；字面值與 segmented Picker 不跟，
  // 那些地方一律用 useTint() 的明確顏色（見 design/ 與 screens/）。中性盤（石墨）照樣套：tint 是近白，
  // 文字型控制項剛好；Toggle 的圓鈕會淹在軌道裡，所以 ToggleRow 自己用 `toggleTint()` 換回系統綠。
  const tint = useTint()
  const [section, setSection] = useState(0)
  const [toastMessage, setToastMessage] = useState("")
  const [toastShown, setToastShown] = useState(false)
  // 熱啟動的請求（onResume）與冷啟動的參數都先排進同一個位置，依序處理。
  const [installTarget, setInstallTarget] = useState<string | null>(pendingInstall)
  const [installBusy, setInstallBusy] = useState(false)

  useEffect(() => {
    if (depsState !== "installing") return
    let cancelled = false
    void installMissingDependencies().then(ok => {
      if (!cancelled) setDepsState(ok ? "ready" : "failed")
    })
    return () => {
      cancelled = true
    }
  }, [depsState])

  // 實例活著時再被 run scheme 觸發：入口不會重跑，只能從這裡收。
  useEffect(() => {
    setInstallListener(url => setInstallTarget(url))
    return () => setInstallListener(null)
  }, [])

  // 啟動延遲 2.5 秒後背景查一次追更：不跟首屏搶資源；TTL 沒到期就零連線，
  // 前台正在讀時排程器自己讓路（見 app/updates.ts）。依賴沒好就不查——那只會換來一小時退避。
  useEffect(() => {
    if (depsState !== "ready") return
    const timer = setTimeout(() => {
      void updatesScheduler().checkUpdates({ background: true })
    }, STARTUP_UPDATE_DELAY)
    return () => {
      if (timer !== null) clearTimeout(timer)
    }
  }, [depsState])

  // 畫面自己的導覽列在畫面裡建，拿不到這裡的 prop，所以用這個旗標告訴它們自己在哪種殼裡。
  // 一定要在 render 期間設定：子畫面的 toolBar 節點就是這一輪 render 建的。
  setTabBarHidden(hideTabBar)

  // 分頁標題的唯一來源是 app/sections.ts（索引＝分頁編號）；這裡不再抄一份中文。
  const titles = SECTIONS.map(entry => t(entry.titleKey))
  // 換語言要重繪整個殼，不然五個 Tab 的標題會留在舊語言（子畫面自己也有訂閱，但殼不在它們裡面）。
  useSubscription(subscribeLocale)

  useEffect(() => {
    setToastListener(message => {
      setToastMessage(message)
      setToastShown(true)
    })
    setTabChangeListener(tabIndex => {
      selection.setValue(tabIndex)
      setSection(tabIndex)
    })
    return () => {
      setToastListener(null)
      setTabChangeListener(null)
    }
  }, [])

  // 依賴就緒才處理：加入完要切到設定頁、開倉庫詳情，不該蓋在「準備中」上面。
  // 放在分頁監聽之後：冷啟動時 switchToTab 才有 listener 可接。
  useEffect(() => {
    if (depsState !== "ready" || installTarget === null || installBusy) return
    const target = installTarget
    setInstallTarget(null)
    setInstallBusy(true)
    void installRepository(target).finally(() => setInstallBusy(false))
  }, [depsState, installTarget, installBusy])

  /** 連結只是「請求」，內容由外人決定，一律先確認再抓索引。 */
  async function installRepository(url: string) {
    const ok = await Dialog.confirm({
      title: t("settings.repos.linkTitle"),
      message: url,
      confirmLabel: t("common.add"),
      cancelLabel: t("common.cancel"),
    })
    if (!ok) return

    try {
      const repository = await addRepository(url)
      setToastMessage(
        t("settings.repos.addDone", {
          label: t("common.add"),
          name: repository.name,
          count: repository.entries.length,
        })
      )
      setToastShown(true)
      switchToTab(3)
      // 首頁分頁殼不能 present；那裡切到設定頁就夠了。
      if (hideTabBar) return
      // 加入只快取索引，裝哪個源要在詳情頁挑。
      await Navigation.present({
        element: (
          <NavigationStack>
            <RepositoryDetailScreen repositoryUrl={repository.url} />
          </NavigationStack>
        ),
        modalPresentationStyle: "pageSheet",
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await Dialog.alert({ title: t("settings.repos.linkTitle"), message })
    }
  }

  const toast = {
    message: toastMessage,
    isPresented: toastShown,
    onChanged: setToastShown,
    position: "bottom" as const,
  }
  const overlay = {
    alignment: "center" as const,
    content: (
      <>
        <LoadingHUD />
        <CustomDialogOverlay />
      </>
    ),
  }

  if (depsState !== "ready") {
    return (
      <ZStack tint={tint.tint} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <PageBackground />
        {depsState === "installing" ? (
          <PreparingView />
        ) : (
          <InstallFailedView onRetry={() => setDepsState("installing")} />
        )}
      </ZStack>
    )
  }

  if (hideTabBar) {
    return (
      <ZStack toast={toast} overlay={overlay} tint={tint.tint} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <PageBackground />
        <NavigationStack>{sectionScreen(section)}</NavigationStack>
      </ZStack>
    )
  }

  return (
    <ZStack tint={tint.tint}>
      <PageBackground />
      {/* tab bar 收起行為（iOS 26+ 的膠囊）。這個 API 只有 automatic／never／onScrollDown／onScrollUp
          四個值，**沒有展開門檻可調**。實測（2026-10-09）：
            onScrollDown：往下捲會收起，但要滑回頂端才會展開（「上滑一點就展開」做不到）。
            automatic  ：在這個 App 完全不收起（等於 never）。
          所以實際只有兩個端點可選：onScrollDown（收起、回頂端才展開）或 never（永不收起）。 */}
      <TabView
        selection={selection}
        {...(liquidGlass ? { tabViewSearchActivation: "searchTabSelection", tabBarMinimizeBehavior: "onScrollDown" } as const : {})}
        tabViewStyle="sidebarAdaptable"
        toast={toast}
        overlay={overlay}
      >
        <Tab title={titles[0]} systemImage="house" value={0}>
          <NavigationStack>
            <HomeScreen />
          </NavigationStack>
        </Tab>
        <Tab title={titles[1]} systemImage="books.vertical" value={1}>
          <NavigationStack>
            <BookshelfScreen />
          </NavigationStack>
        </Tab>
        <Tab title={titles[2]} systemImage="square.grid.2x2" value={2}>
          <NavigationStack>
            <BrowseScreen />
          </NavigationStack>
        </Tab>
        <Tab title={titles[3]} systemImage="gearshape" value={3}>
          <NavigationStack>
            <SettingsScreen />
          </NavigationStack>
        </Tab>
        <Tab title={titles[4]} systemImage="magnifyingglass" value={4} role="search">
          <NavigationStack>
            <SearchScreen />
          </NavigationStack>
        </Tab>
      </TabView>
    </ZStack>
  )
}
