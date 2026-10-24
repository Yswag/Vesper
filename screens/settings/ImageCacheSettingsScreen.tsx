// 縮圖快取設定子頁：即時容量統計、手動清除確認，以及自動淘汰規則（天數與容量上限）。

import { Divider, useEffect, useState } from "scripting"

import {
  MAX_AGE_DAYS_OPTIONS,
  MAX_SIZE_MB_OPTIONS,
  getMaxAgeDays,
  getMaxSizeBytes,
  setMaxAgeDays,
  setMaxSizeBytes,
} from "../../app/cacheSetting"
import { CardGroup, PageScroll } from "../../design/layout"
import { IconRow, SelectRow, rowSeparatorInset } from "../../design/rows"
import { toneText } from "../../design/tokens"
import { formatBytes } from "../../engine/format"
import { clearImageCache, getCacheStats } from "../../engine/imagecache"
import { t } from "../../i18n"

export function ImageCacheSettingsScreen() {
  const [stats, setStats] = useState<{ count: number; totalBytes: number } | null>(null)
  const [maxAgeDays, setDays] = useState<number>(() => getMaxAgeDays())
  const [maxSizeBytes, setBytes] = useState<number>(() => getMaxSizeBytes())

  async function refreshStats() {
    const next = await getCacheStats()
    setStats(next)
  }

  useEffect(() => {
    void refreshStats()
  }, [])

  async function handleClearCache() {
    const confirmed = await Dialog.confirm({
      title: t("settings.root.clearCacheTitle"),
      message: t("settings.root.clearCacheMessage"),
      confirmLabel: t("common.clear"),
    })
    if (confirmed) {
      clearImageCache()
      await refreshStats()
    }
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

  const statsDetail =
    stats === null
      ? t("settings.cache.calculating")
      : t("settings.cache.statsDetail", {
          files: t("settings.root.thumbCacheFiles", { n: stats.count }),
          size: formatBytes(stats.totalBytes),
        })

  return (
    <PageScroll title={t("settings.cache.title")}>
      {/* 1. 狀態與手動操作 */}
      <CardGroup title={t("settings.cache.statusGroup")}>
        <IconRow
          icon="internaldrive"
          title={t("settings.root.thumbCache")}
          detail={statsDetail}
        />
        <Divider padding={{ leading: rowSeparatorInset }} />
        <IconRow
          icon="trash"
          iconColor={toneText.danger}
          title={t("settings.root.clearThumbCache")}
          titleColor={toneText.danger}
          onTap={() => void handleClearCache()}
        />
      </CardGroup>

      {/* 2. 自動清理規則 */}
      <CardGroup title={t("settings.cache.rulesGroup")}>
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
      </CardGroup>
    </PageScroll>
  )
}
