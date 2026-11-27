import { Divider, useEffect, useState } from "scripting"

import {
  MAX_AGE_DAYS_OPTIONS,
  MAX_SIZE_MB_OPTIONS,
  PAGE_CACHE_CHAPTER_OPTIONS,
  PAGE_CACHE_MB_OPTIONS,
  getMaxAgeDays,
  getMaxSizeBytes,
  getPageCacheChapters,
  getPageCacheMb,
  setMaxAgeDays,
  setMaxSizeBytes,
  setPageCacheChapters,
  setPageCacheMb,
} from "../../app/cacheSetting"
import { CardGroup, PageScroll } from "../../design/layout"
import { IconRow, SelectRow, rowSeparatorInset } from "../../design/rows"
import { toneText } from "../../design/tokens"
import { formatBytes } from "../../engine/format"
import { clearImageCache, getCacheStats } from "../../engine/imagecache"
import { clearPageCache, pageCacheUsage, sweepPageCache } from "../../engine/pagecache"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"

export function ImageCacheSettingsScreen() {
  useSubscription(subscribeLocale)
  const [stats, setStats] = useState<{ count: number; totalBytes: number } | null>(null)
  const [pages, setPages] = useState<{ chapters: number; bytes: number } | null>(null)
  const [maxAgeDays, setDays] = useState<number>(() => getMaxAgeDays())
  const [maxSizeBytes, setBytes] = useState<number>(() => getMaxSizeBytes())
  const [pageMb, setPageMb] = useState<number>(() => getPageCacheMb())
  const [pageChapters, setChapters] = useState<number>(() => getPageCacheChapters())

  async function refreshStats() {
    const [nextStats, nextPages] = await Promise.all([getCacheStats(), pageCacheUsage()])
    setStats(nextStats)
    setPages(nextPages)
  }

  useEffect(() => {
    void refreshStats()
  }, [])

  function applyPageLimits() {
    void sweepPageCache(null, { chapters: getPageCacheChapters(), bytes: getPageCacheMb() * 1024 * 1024 }).then(
      refreshStats
    )
  }

  async function handleClearThumbs() {
    const confirmed = await Dialog.confirm({
      title: t("settings.root.clearCacheTitle"),
      message: t("settings.root.clearCacheMessage"),
      confirmLabel: t("common.clear"),
    })
    if (!confirmed) return
    clearImageCache()
    await refreshStats()
  }

  async function handleClearPages() {
    const confirmed = await Dialog.confirm({
      title: t("settings.cache.clearPageTitle"),
      message: t("settings.cache.clearPageMessage"),
      confirmLabel: t("common.clear"),
    })
    if (!confirmed) return
    clearPageCache()
    await refreshStats()
  }

  const ageOptions = MAX_AGE_DAYS_OPTIONS.map(days => ({
    value: String(days),
    text: days === 0 ? t("settings.cache.unlimited") : t("settings.cache.days", { n: days }),
  }))

  const sizeOptions = MAX_SIZE_MB_OPTIONS.map(mb => {
    const bytes = mb * 1024 * 1024
    return {
      value: String(bytes),
      text: mb === 0 ? t("settings.cache.unlimited") : formatBytes(bytes),
    }
  })

  const pageSizeOptions = PAGE_CACHE_MB_OPTIONS.map(mb => ({
    value: String(mb),
    text: mb === 0 ? t("settings.cache.unlimited") : formatBytes(mb * 1024 * 1024),
  }))

  const pageChapterOptions = PAGE_CACHE_CHAPTER_OPTIONS.map(count => ({
    value: String(count),
    text: t("settings.cache.pageChapters", { n: count }),
  }))

  const thumbDetail =
    stats === null
      ? t("settings.cache.calculating")
      : t("settings.cache.statsDetail", {
          files: t("settings.root.thumbCacheFiles", { n: stats.count }),
          size: formatBytes(stats.totalBytes),
        })

  const pageDetail =
    pages === null
      ? t("settings.cache.calculating")
      : t("settings.cache.pageUsage", {
          chapters: t("settings.cache.pageChapters", { n: pages.chapters }),
          size: formatBytes(pages.bytes),
        })

  return (
    <PageScroll title={t("settings.root.cache")}>
      {}
      <CardGroup title={t("settings.cache.thumbsGroup")}>
        <IconRow icon="photo" title={t("settings.cache.thumbsUsageTitle")} detail={thumbDetail} />
        <Divider padding={{ leading: rowSeparatorInset }} />
        <SelectRow
          icon="clock"
          title={t("settings.cache.maxAge")}
          value={String(maxAgeDays)}
          options={ageOptions}
          onChanged={next => {
            const nextDays = Number(next)
            setMaxAgeDays(nextDays)
            setDays(nextDays)
          }}
        />
        <Divider padding={{ leading: rowSeparatorInset }} />
        <SelectRow
          icon="chart.pie"
          title={t("settings.cache.maxSize")}
          value={String(maxSizeBytes)}
          options={sizeOptions}
          onChanged={next => {
            const nextBytes = Number(next)
            setMaxSizeBytes(nextBytes)
            setBytes(nextBytes)
          }}
        />
        <Divider padding={{ leading: rowSeparatorInset }} />
        <IconRow
          icon="trash"
          iconColor={toneText.danger}
          title={t("settings.root.clearThumbCache")}
          titleColor={toneText.danger}
          onTap={() => void handleClearThumbs()}
        />
      </CardGroup>

      {}
      <CardGroup title={t("settings.cache.pageGroup")}>
        <IconRow icon="book" title={t("settings.cache.pageUsageTitle")} detail={pageDetail} />
        <Divider padding={{ leading: rowSeparatorInset }} />
        <SelectRow
          icon="rectangle.stack"
          title={t("settings.cache.pageKeep")}
          value={String(pageChapters)}
          options={pageChapterOptions}
          onChanged={next => {
            const count = Number(next)
            setPageCacheChapters(count)
            setChapters(count)
            applyPageLimits()
          }}
        />
        <Divider padding={{ leading: rowSeparatorInset }} />
        <SelectRow
          icon="chart.pie"
          title={t("settings.cache.pageMaxSize")}
          value={String(pageMb)}
          options={pageSizeOptions}
          onChanged={next => {
            const mb = Number(next)
            setPageCacheMb(mb)
            setPageMb(mb)
            applyPageLimits()
          }}
        />
        <Divider padding={{ leading: rowSeparatorInset }} />
        <IconRow
          icon="trash"
          iconColor={toneText.danger}
          title={t("settings.cache.clearPage")}
          titleColor={toneText.danger}
          onTap={() => void handleClearPages()}
        />
      </CardGroup>
    </PageScroll>
  )
}
