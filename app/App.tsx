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
  pendingInstall?: string | null
}) {
  const selection = useObservable<number>(0)
  const tint = useTint()
  const scheme = useAppearanceOverride()
  const [toastMessage, setToastMessage] = useState("")
  const [toastShown, setToastShown] = useState(false)
  const [installTarget, setInstallTarget] = useState<string | null>(pendingInstall)
  const [installBusy, setInstallBusy] = useState(false)

  useEffect(() => {
    setInstallListener(url => setInstallTarget(url))
    return () => setInstallListener(null)
  }, [])

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

  const titles = SECTIONS.map(entry => t(entry.titleKey))
  useSubscription(subscribeLocale, subscribeSourceUpdates)
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

  useEffect(() => {
    if (installTarget === null || installBusy) return
    const target = installTarget
    setInstallTarget(null)
    setInstallBusy(true)
    void installRepository(target).finally(() => setInstallBusy(false))
  }, [installTarget, installBusy])

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
      {}
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
