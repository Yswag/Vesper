// 應用外殼（index.tsx）：五個 tab 的 TabView，每個 tab 一棵自己的 NavigationStack（切 tab 不丟導航歷史）。
// 搜尋是最後一個 tab 且標記 role="search"：iOS 會把它放在最右，並提供「展開成輸入框、
// 同時收起其他 tab」的原生行為。
// tabViewSearchActivation="searchTabSelection" 是那個展開行為的開關（沒有它就不會展開）。
// 它同時也會自動聚焦、彈鍵盤——所以 SearchScreen 把 searchable 的 presented 綁起來，
// 讓系統回報展開狀態；但**不要**把它設成 false（那是「取消搜尋」，會把 tab 切回上一個）。
//
// Scripting 首頁分頁是另一個入口（home_screen_default_ui.tsx 的 Mini Hub），不走這個殼。
//
// 掛載後在背景依序查：先漫畫源更新（app/sourceUpdates.ts，有可更新就在設定 tab 掛紅色數字角標），
// 查完再查追更（TTL 與讓路都在 app/updates.ts）。
//
// toast 掛在殼上：源的 UI.showMessage 需要一個全域出口（見 app/toast.ts）。
// 載入指示同樣掛殼的 overlay：源的 UI.showLoading 要一張浮動小卡片，不是 modal（見 app/loadingState.ts）。

import { Navigation, NavigationStack, Tab, TabView, ZStack, useEffect, useObservable, useState } from "scripting"

import { PageBackground, ThemedNavigationStack, useAppearanceOverride, useTint } from "./theme"
import { liquidGlass } from "../design/glass"
import { SECTIONS } from "./sections"
import { useSubscription } from "./useSubscription"
import { subscribe as subscribeLocale, t } from "../i18n"
import { CustomDialogOverlay } from "./CustomDialogOverlay"
import { LoadingHUD } from "./LoadingHUD"
import { setToastListener } from "./toast"
import { setTabChangeListener, switchToTab } from "./navigation"
import { setInstallListener } from "./installLink"
import { checkSourceUpdates, sourceUpdateCount, subscribeSourceUpdates } from "./sourceUpdates"
import { updatesScheduler } from "./updates"
import { addRepository } from "../sources/registry"
import { BookshelfScreen } from "../screens/bookshelf/BookshelfScreen"
import { RepositoryDetailScreen } from "../screens/settings/RepositoryDetailScreen"
import { BrowseScreen } from "../screens/browse/BrowseScreen"
import { HomeScreen } from "../screens/home/HomeScreen"
import { SearchScreen } from "../screens/search/SearchScreen"
import { SettingsScreen } from "../screens/settings/SettingsScreen"

export function App({ pendingInstall = null }: {
  /** 冷啟動時由入口從 URL scheme 帶進來的倉庫網址。 */
  pendingInstall?: string | null
}) {
  const selection = useObservable<number>(0)
  // 根層 tint：會繼承的控制項（Toggle、borderless Button、menu Picker）跟主題；字面值與 segmented Picker 不跟，
  // 那些地方一律用 useTint() 的明確顏色（見 design/ 與 screens/）。中性盤（石墨）照樣套：tint 是近白，
  // 文字型控制項剛好；Toggle 的圓鈕會淹在軌道裡，所以 ToggleRow 自己用 `toggleTint()` 換回系統綠。
  const tint = useTint()
  // 深淺模式掛在這一層呈現上（`undefined`＝跟隨系統）。
  const scheme = useAppearanceOverride()
  const [toastMessage, setToastMessage] = useState("")
  const [toastShown, setToastShown] = useState(false)
  // 熱啟動的請求（onResume）與冷啟動的參數都先排進同一個位置，依序處理。
  const [installTarget, setInstallTarget] = useState<string | null>(pendingInstall)
  const [installBusy, setInstallBusy] = useState(false)

  // 実例活著時再被 run scheme 觸發：入口不會重跑，只能從這裡收。
  useEffect(() => {
    setInstallListener(url => setInstallTarget(url))
    return () => setInstallListener(null)
  }, [])

  // 入口在 present 前就把授權、源、書架都裝好了，掛載就是啟動完成。先查源更新再查追更：
  // 兩者都有 TTL，沒到期就零連線；源那一步不論成敗都接著跑追更。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await checkSourceUpdates()
      } finally {
        if (!cancelled) void updatesScheduler().checkUpdates({ background: true })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 分頁標題與圖示的唯一來源是 app/sections.ts（索引＝分頁編號）。
  const titles = SECTIONS.map(entry => t(entry.titleKey))
  // 換語言要重繪整個殼，不然五個 Tab 的標題會留在舊語言（子畫面自己也有訂閱，但殼不在它們裡面）。
  useSubscription(subscribeLocale, subscribeSourceUpdates)
  // Tab 的型別沒有 badge，但底層認（實測會畫系統紅色數字；0 時不顯示）。
  const settingsBadge = { badge: sourceUpdateCount() } as {}

  useEffect(() => {
    setToastListener(message => {
      setToastMessage(message)
      setToastShown(true)
    })
    setTabChangeListener(tabIndex => selection.setValue(tabIndex))
    return () => {
      setToastListener(null)
      setTabChangeListener(null)
    }
  }, [])

  // 放入新倉庫後要切到設定頁、開倉庫詳情。
  // 放在分頁監聽之後：冷啟動時 switchToTab 才有 listener 可接。
  useEffect(() => {
    if (installTarget === null || installBusy) return
    const target = installTarget
    setInstallTarget(null)
    setInstallBusy(true)
    void installRepository(target).finally(() => setInstallBusy(false))
  }, [installTarget, installBusy])

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
      // 加入只快取索引，裝哪個源要在詳情頁挑。
      await Navigation.present({
        element: (
          <ThemedNavigationStack>
            <RepositoryDetailScreen repositoryUrl={repository.url} />
          </ThemedNavigationStack>
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

  return (
    <ZStack tint={tint.tint} preferredColorScheme={scheme}>
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
        <Tab title={titles[0]} systemImage={SECTIONS[0].systemImage} value={0}>
          <NavigationStack>
            <HomeScreen />
          </NavigationStack>
        </Tab>
        <Tab title={titles[1]} systemImage={SECTIONS[1].systemImage} value={1}>
          <NavigationStack>
            <BookshelfScreen />
          </NavigationStack>
        </Tab>
        <Tab title={titles[2]} systemImage={SECTIONS[2].systemImage} value={2}>
          <NavigationStack>
            <BrowseScreen />
          </NavigationStack>
        </Tab>
        <Tab title={titles[3]} systemImage={SECTIONS[3].systemImage} value={3} {...settingsBadge}>
          <NavigationStack>
            <SettingsScreen />
          </NavigationStack>
        </Tab>
        <Tab title={titles[4]} systemImage={SECTIONS[4].systemImage} value={4} role="search">
          <NavigationStack>
            <SearchScreen />
          </NavigationStack>
        </Tab>
      </TabView>
    </ZStack>
  )
}
