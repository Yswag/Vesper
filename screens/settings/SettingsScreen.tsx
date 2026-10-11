// 設定：外觀主題、源管理、縮圖快取、日誌，以及唯一的退出出口。

import { Button, Device, Divider, NavigationLink, useEffect, useState } from "scripting"

import { LeadingToolbar } from "../../components/LeadingToolbar"
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
import { useSubscription } from "../../app/useSubscription"
import { CardGroup, PageScroll } from "../../design/layout"
import { IconRow, SelectRow, rowSeparatorInset } from "../../design/rows"
import { palette } from "../../design/tokens"
import { clearImageCache, getCacheStats } from "../../engine/imagecache"
import { clearSourceIconCache } from "../../engine/sourceicons"
import { formatBytes } from "../../engine/format"
import { LOCALE_IDS, subscribe as subscribeLocale, t } from "../../i18n"
import { allSources, reloadRegistry, subscribeSources } from "../../sources/registry"
import { listDownloads, subscribeDownloads } from "../../sources/downloads"
import { totalBytes } from "../../engine/offline"
import { DownloadScreen } from "./DownloadScreen"
import { ImageCacheSettingsScreen } from "./ImageCacheSettingsScreen"
import { LogScreen } from "./LogScreen"
import { SourceListScreen } from "./SourceListScreen"
import { ThemeSettingsScreen } from "./ThemeSettingsScreen"

export function SettingsScreen() {
  // 源清單（匯入／刪除／啟用）與下載狀態變動都要重繪這一頁。
  // 語言也在這裡：`applyLocaleSetting` 走 i18n 自己的訂閱通知，這一頁要跟著重繪才看得到新文字。
  const refresh = useSubscription(subscribeSources, subscribeDownloads, subscribeLocale)
  const choice = useThemeChoice()
  const comp = findComposition(choice.composition)
  const pal = findPalette(choice.palette)
  const [cacheStats, setCacheStats] = useState<{ count: number; totalBytes: number } | null>(null)

  // 進這一頁先從盤上重載一次源，並非同步取得縮圖快取統計。
  useEffect(() => {
    reloadRegistry()
    refresh()
    void getCacheStats().then(setCacheStats)
  }, [])

  const installed = allSources().length
  const localeSetting = getLocaleSetting()

  // 下載進行中、取消、刪除都會讓「下載」那一列的數量與大小跟著動。
  const downloads = listDownloads()
  const downloadDetail =
    downloads.length > 0
      ? `${t("settings.shared.countChapters", { n: downloads.length })} · ${formatBytes(totalBytes())}`
      : undefined

  const cacheDetail =
    cacheStats === null
      ? undefined
      : t("settings.root.thumbCacheDetail", {
          files: t("settings.root.thumbCacheFiles", { n: cacheStats.count }),
          size: formatBytes(cacheStats.totalBytes),
        })

  return (
    <PageScroll title={t("settings.root.title")} leading={LeadingToolbar}>
      <CardGroup title={t("settings.root.groupSources")}>
        <NavigationLink destination={<SourceListScreen />}>
          <IconRow
            icon="square.stack.3d.up"
            title={t("settings.root.sourceManage")}
            detail={t("settings.root.installed", { n: installed })}
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
      </CardGroup>

      <CardGroup title={t("settings.root.groupStorage")} footnote={t("settings.root.storageFootnote")}>
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
            title={t("settings.root.thumbCache")}
            detail={cacheDetail}
            chevron
          />
        </NavigationLink>
      </CardGroup>

      <CardGroup title={t("settings.root.groupAbout")} footnote={t("settings.root.aboutFootnote")}>
        {/* 選項用語言自稱；「跟隨系統」跟著介面語言走，所以兩個字串都要在 render 時求值。 */}
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
        <IconRow icon="info.circle" title="Vesper" detail="v1.0.0" />
        <Divider padding={{ leading: rowSeparatorInset }} />
        <IconRow icon="cube.box" title={t("settings.root.sourceSpec")} detail={t("settings.root.sourceSpecDetail")} />
        <Divider padding={{ leading: rowSeparatorInset }} />
        <IconRow icon="tv" title={t("settings.root.homeData")} detail="Bangumi Open API" />
      </CardGroup>
    </PageScroll>
  )
}
