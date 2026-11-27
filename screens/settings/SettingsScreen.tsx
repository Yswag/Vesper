import { Button, Device, Divider, NavigationLink, useEffect, useState } from "scripting"

import { ExitToolbar } from "../../components/ExitToolbar"
import {
  LOCALE_SELF_NAMES,
  applyLocaleSetting,
  getLocaleSetting,
  isLocaleSetting,
} from "../../app/localeSetting"
import {
  findComposition,
  findPalette,
  useThemeChoice,
} from "../../app/theme"
import { sourceUpdateCount, subscribeSourceUpdates } from "../../app/sourceUpdates"
import { contentLanguagesDetail, subscribeContentLanguages } from "../../app/contentLanguages"
import { useSubscription } from "../../app/useSubscription"
import { comicLibrary } from "../../app/services"
import { CardGroup, PageScroll } from "../../design/layout"
import { IconRow, SelectRow, rowSeparatorInset } from "../../design/rows"
import { palette } from "../../design/tokens"
import { clearImageCache, getCacheStats } from "../../engine/imagecache"
import { pageCacheUsage } from "../../engine/pagecache"
import { clearSourceIconCache } from "../../engine/sourceicons"
import { formatBytes } from "../../engine/format"
import { LOCALE_IDS, subscribe as subscribeLocale, t } from "../../i18n"
import { allSources, reloadRegistry, subscribeSources } from "../../sources/registry"
import { listDownloads, subscribeDownloads } from "../../sources/downloads"
import { DownloadScreen } from "./DownloadScreen"
import { ImageCacheSettingsScreen } from "./ImageCacheSettingsScreen"
import { LogScreen } from "./LogScreen"
import { MiniHubSettingsScreen } from "./MiniHubSettingsScreen"
import { SourceListScreen } from "./SourceListScreen"
import { ThemeSettingsScreen } from "./ThemeSettingsScreen"
import { ContentLanguageScreen } from "./ContentLanguageScreen"
import scriptJson from "../../script.json"

export function SettingsScreen() {
  const refresh = useSubscription(subscribeSources, subscribeSourceUpdates, subscribeDownloads, subscribeLocale, subscribeContentLanguages)
  const choice = useThemeChoice()
  const comp = findComposition(choice.composition)
  const pal = findPalette(choice.palette)
  const [cacheStats, setCacheStats] = useState<{ count: number; totalBytes: number } | null>(null)
  const [pageStats, setPageStats] = useState<{ chapters: number; bytes: number } | null>(null)

  useEffect(() => {
    reloadRegistry()
    refresh()
    void getCacheStats().then(setCacheStats)
    void pageCacheUsage().then(setPageStats)
  }, [])

  const installed = allSources().length
  const localeSetting = getLocaleSetting()

  const downloads = listDownloads()
  const downloadDetail =
    downloads.length > 0
      ? `${t("settings.shared.countChapters", { n: downloads.length })} · ${formatBytes(comicLibrary().offline.totalBytes())}`
      : undefined

  const cacheDetail =
    cacheStats === null || pageStats === null
      ? undefined
      : formatBytes(cacheStats.totalBytes + pageStats.bytes)

  return (
    <PageScroll title={t("settings.root.title")} leading={ExitToolbar}>
      <CardGroup title={t("settings.root.groupSources")}>
        <NavigationLink destination={<SourceListScreen />}>
          <IconRow
            icon="square.stack.3d.up"
            title={t("settings.root.sourceManage")}
            detail={t("settings.root.installed", { n: installed })}
            badge={sourceUpdateCount()}
            chevron
          />
        </NavigationLink>
        <Divider padding={{ leading: rowSeparatorInset }} />
        <NavigationLink destination={<ContentLanguageScreen />}>
          <IconRow
            icon="globe"
            title={t("settings.contentLanguage.title")}
            detail={contentLanguagesDetail()}
            chevron
          />
        </NavigationLink>
      </CardGroup>

      <CardGroup title={t("settings.root.groupAppearance")}>
        <NavigationLink destination={<ThemeSettingsScreen />}>
          <IconRow
            icon="paintpalette"
            title={t("settings.root.appearance")}
            detail={`${t(comp.nameKey)} · ${t(pal.nameKey)}`}
            chevron
          />
        </NavigationLink>
        <Divider padding={{ leading: rowSeparatorInset }} />
        <NavigationLink destination={<MiniHubSettingsScreen />}>
          <IconRow icon="rectangle.grid.1x2" title={t("settings.root.miniHub")} chevron />
        </NavigationLink>
      </CardGroup>

      <CardGroup title={t("settings.root.groupStorage")}>
        <NavigationLink destination={<DownloadScreen />}>
          <IconRow
            icon="arrow.down.circle"
            title={t("settings.root.downloads")}
            detail={downloadDetail}
            chevron
          />
        </NavigationLink>
        <Divider padding={{ leading: rowSeparatorInset }} />
        <NavigationLink destination={<ImageCacheSettingsScreen />}>
          <IconRow
            icon="internaldrive"
            title={t("settings.root.cache")}
            detail={cacheDetail}
            chevron
          />
        </NavigationLink>
      </CardGroup>

      <CardGroup title={t("settings.root.groupAbout")}>
        {}
        <SelectRow
          icon="globe"
          title={t("settings.language")}
          value={localeSetting}
          options={[
            { value: "system", text: t("settings.followSystem") },
            ...LOCALE_IDS.map(id => ({ value: id, text: LOCALE_SELF_NAMES[id] })),
          ]}
          onChanged={next => {
            if (isLocaleSetting(next)) applyLocaleSetting(next, Device.systemLocales)
          }}
        />
        <Divider padding={{ leading: rowSeparatorInset }} />
        <NavigationLink destination={<LogScreen />}>
          <IconRow icon="doc.text" title={t("settings.root.logs")} chevron />
        </NavigationLink>
        <Divider padding={{ leading: rowSeparatorInset }} />
        <IconRow icon="info.circle" title="Vesper" detail={`v${scriptJson.version}`} />
        <Divider padding={{ leading: rowSeparatorInset }} />
        <IconRow icon="cube.box" title={t("settings.root.sourceSpec")} detail={t("settings.root.sourceSpecDetail")} />
        <Divider padding={{ leading: rowSeparatorInset }} />
        <IconRow icon="tv" title={t("settings.root.homeData")} detail="Bangumi Open API" />
      </CardGroup>
    </PageScroll>
  )
}
