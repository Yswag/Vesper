// 單一倉庫：列出索引裡的源，逐筆安裝 / 更新；下拉可重新整理索引。
// 清單只讀本地快取，重新整理才會連網。

import { Button, Divider, HStack, Image, Spacer, Text, VStack, useEffect, useState } from "scripting"
import { CardGroup, PageScroll } from "../../design/layout"
import { ActionRow, IconBadge, InfoRow, rowSeparatorInset } from "../../design/rows"
import { EmptyState, NoticeBanner, statusTone, type StatusNotice } from "../../design/status"
import { Tag } from "../../design/Tag"
import { Chip } from "../../design/chip"
import { Caption, Footnote } from "../../design/text"
import { radius, rect, rowPadding } from "../../design/tokens"
import { useTint } from "../../app/theme"
import { t } from "../../i18n"
import type { CatalogEntry } from "../../sources/catalog"
import {
  installRepositoryEntry,
  refreshRepository,
  repositoryEntries,
  subscribeSources,
  type RepositoryEntryStatus,
} from "../../sources/registry"
import { getRepository, kindOf, subscribeRepositories, type StoredRepository } from "../../sources/repository"

export function RepositoryDetailScreen({ repositoryUrl }: { repositoryUrl: string }) {
  const tint = useTint()
  const [repository, setRepository] = useState<StoredRepository | undefined>(undefined)
  const [entries, setEntries] = useState<RepositoryEntryStatus[]>([])
  const [busy, setBusy] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null)
  const [status, setStatus] = useState<StatusNotice | null>(null)

  function sync() {
    setRepository(getRepository(repositoryUrl))
    setEntries(repositoryEntries(repositoryUrl))
  }

  useEffect(() => {
    sync()
    const offRepositories = subscribeRepositories(sync)
    const offSources = subscribeSources(sync)
    return () => {
      offRepositories()
      offSources()
    }
  }, [repositoryUrl])

  async function install(entry: CatalogEntry) {
    setBusyKey(entry.key)
    setStatus({ kind: "loading", text: t("settings.repo.installing", { name: entry.name }) })
    try {
      const result = await installRepositoryEntry(repositoryUrl, entry.key)
      setStatus({
        kind: "ready",
        text: result.updated
          ? t("settings.repo.updated", { name: result.name, version: result.version })
          : t("settings.repo.installed", { name: result.name, version: result.version }),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus({ kind: "error", text: t("common.failed", { message }) })
      await Dialog.alert({ title: entry.name, message })
    } finally {
      setBusyKey(null)
    }
  }

  async function refresh() {
    setBusy(true)
    setStatus({ kind: "loading", text: t("settings.repo.refreshing") })
    try {
      const repo = await refreshRepository(repositoryUrl)
      setStatus({ kind: "ready", text: t("settings.repo.refreshed", { n: repo.entries.length }) })
    } catch (error) {
      setStatus({
        kind: "error",
        text: t("common.failed", { message: error instanceof Error ? error.message : String(error) }),
      })
    } finally {
      setBusy(false)
    }
  }

  /** 一鍵安裝：掃描衝突、彈窗確認、循序/受控安裝 */
  async function installAll() {
    if (entries.length === 0 || busy || busyKey !== null || batchProgress !== null) return

    // 1. 同倉重複去重：同一倉庫內同 key 只保留第一筆
    const seenInRepo = new Set<string>()
    const uniqueEntries: RepositoryEntryStatus[] = []

    for (const item of entries) {
      if (seenInRepo.has(item.entry.key)) continue
      seenInRepo.add(item.entry.key)
      uniqueEntries.push(item)
    }

    // 2. 本地已安裝狀態分流
    // - newOrUpdate: 全新未安裝，或同倉庫來源且有新版
    // - conflict: 本地已安裝，但來源不是本倉庫（來自其他倉庫或手動匯入）
    const normRepoUrl = repositoryUrl.trim().replace(/\/+$/, "").toLowerCase()
    const newOrUpdate: CatalogEntry[] = []
    const conflict: CatalogEntry[] = []

    for (const item of uniqueEntries) {
      if (!item.installed) {
        newOrUpdate.push(item.entry)
      } else {
        const origin = (item.installed.stored.origin ?? "").trim().replace(/\/+$/, "").toLowerCase()
        const isFromThisRepo = origin === normRepoUrl
        if (isFromThisRepo) {
          if (item.updateAvailable) {
            newOrUpdate.push(item.entry)
          }
        } else {
          conflict.push(item.entry)
        }
      }
    }

    // 3. 衝突確認與使用者決策
    let targetsToInstall: CatalogEntry[] = []

    if (conflict.length > 0) {
      const actionIndex = await Dialog.actionSheet({
        title: t("settings.repo.conflictTitle", { n: conflict.length }),
        message: t("settings.repo.conflictMessage"),
        actions: [
          { label: t("settings.repo.skipConflict") },
          { label: t("settings.repo.overwriteConflict") },
        ],
      })

      // 嚴格判斷：非 0 且非 1 均視為取消
      if (actionIndex !== 0 && actionIndex !== 1) return

      if (actionIndex === 0) {
        // 跳過衝突：只裝全新與同倉更新
        targetsToInstall = newOrUpdate
        if (targetsToInstall.length === 0) {
          setStatus({ kind: "ready", text: t("settings.repo.allInstalled") })
          return
        }
      } else {
        // 全部覆蓋：全新 + 同倉更新 + 衝突源
        targetsToInstall = [...newOrUpdate, ...conflict]
      }

      // 二次確認：讓使用者確認最終要安裝/覆蓋的總數
      const confirmed = await Dialog.confirm({
        title: t("settings.repo.installAllConfirmTitle"),
        message: t("settings.repo.installAllConfirmMessage", { n: targetsToInstall.length }),
        confirmLabel: t("common.confirm"),
        cancelLabel: t("common.cancel"),
      })
      if (!confirmed) return
    } else {
      if (newOrUpdate.length === 0) {
        setStatus({ kind: "ready", text: t("settings.repo.allInstalled") })
        return
      }

      const confirmed = await Dialog.confirm({
        title: t("settings.repo.installAllConfirmTitle"),
        message: t("settings.repo.installAllConfirmMessage", { n: newOrUpdate.length }),
        confirmLabel: t("common.confirm"),
        cancelLabel: t("common.cancel"),
      })

      if (!confirmed) return
      targetsToInstall = newOrUpdate
    }

    if (targetsToInstall.length === 0) return

    // 4. 併發佇列安裝（最多 3 條併發，防 GitHub Rate Limit 與超時）
    setBusy(true)
    const totalCount = targetsToInstall.length
    setBatchProgress({ current: 0, total: totalCount })
    setStatus({
      kind: "loading",
      text: t("settings.repo.batchProgress", { current: 0, total: totalCount }),
    })

    let completedCount = 0
    let successCount = 0
    let failedCount = 0
    const concurrency = 3
    let nextIndex = 0

    async function worker() {
      while (nextIndex < targetsToInstall.length) {
        const idx = nextIndex++
        const entry = targetsToInstall[idx]
        try {
          await installRepositoryEntry(repositoryUrl, entry.key)
          successCount++
        } catch {
          failedCount++
        } finally {
          completedCount++
          setBatchProgress({ current: completedCount, total: totalCount })
          setStatus({
            kind: "loading",
            text: t("settings.repo.batchProgress", { current: completedCount, total: totalCount }),
          })
        }
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, targetsToInstall.length) }, () => worker())
    await Promise.all(workers)

    // 5. 結算反饋
    const skippedCount = uniqueEntries.length - targetsToInstall.length
    const failedPart = failedCount > 0 ? t("settings.repo.batchSummaryFailed", { failed: failedCount }) : ""
    setStatus({
      kind: failedCount > 0 ? "error" : "ready",
      text: t("settings.repo.batchSummary", {
        installed: successCount,
        skipped: skippedCount,
        failed: failedPart,
      }),
    })

    setBatchProgress(null)
    setBusy(false)
  }

  if (!repository) {
    return (
      <PageScroll title={t("settings.shared.repository")}>
        <EmptyState
          variant="page"
          icon="shippingbox"
          title={t("settings.repo.removed")}
          detail={t("settings.repo.removedDetail")}
        />
      </PageScroll>
    )
  }

  const normRepoUrl = repositoryUrl.trim().replace(/\/+$/, "").toLowerCase()
  const hasUpdatable = entries.some(item => item.updateAvailable)
  // 本倉已全安裝且無更新：每一筆都存在且來源為本倉，且無可更新版本
  const allInstalledFromThisRepo =
    entries.length > 0 &&
    entries.every(item => {
      if (!item.installed) return false
      const origin = (item.installed.stored.origin ?? "").trim().replace(/\/+$/, "").toLowerCase()
      return origin === normRepoUrl && !item.updateAvailable
    })
  const isActionDisabled = busy || busyKey !== null || batchProgress !== null || allInstalledFromThisRepo

  return (
    <PageScroll title={repository.name} onRefresh={refresh}>
      <CardGroup title={t("settings.repo.group")}>
        <InfoRow label={t("settings.shared.url")} value={repository.url} />
        <Divider padding={{ leading: 16 }} />
        <InfoRow
          label={t("settings.repo.kind")}
          value={t(kindOf(repository) === "aidoku-index" ? "settings.shared.kindAidoku" : "settings.shared.kindVenera")}
        />
        <Divider padding={{ leading: 16 }} />
        <InfoRow label={t("settings.repo.lastUpdated")} value={formatTime(repository.fetchedAt)} />
        <Divider padding={{ leading: 16 }} />
        <InfoRow
          label={t("settings.shared.source")}
          value={t("settings.shared.countSources", { n: repository.entries.length })}
        />
      </CardGroup>

      {repository.error ? (
        <VStack spacing={8} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <NoticeBanner tone="error" text={t("settings.shared.readFailed")} detail={repository.error} />
          <Chip icon="arrow.clockwise" text={t("common.retry")} onTap={() => void refresh()} />
        </VStack>
      ) : null}

      <CardGroup
        title={t("settings.repo.sourcesGroup", { n: entries.length })}
        headerAccessory={
          entries.length > 0 ? (
            <Button
              title={
                batchProgress
                  ? t("settings.repo.batchProgress", { current: batchProgress.current, total: batchProgress.total })
                  : hasUpdatable
                    ? t("settings.repo.updateAll")
                    : allInstalledFromThisRepo
                      ? t("settings.repo.allInstalled")
                      : t("settings.repo.installAll")
              }
              buttonStyle="bordered"
              controlSize="regular"
              tint={allInstalledFromThisRepo ? "secondaryLabel" : tint.tint}
              disabled={isActionDisabled}
              action={installAll}
            />
          ) : undefined
        }
      >
        {entries.map((item, index) => (
          <VStack key={`${item.entry.key}:${index}`} spacing={0}>
            {index > 0 ? <Divider padding={{ leading: 16 }} /> : null}
            <EntryRow
              status={item}
              busy={busy || busyKey !== null}
              label={busyKey === item.entry.key ? t("settings.repo.processing") : actionLabel(item)}
              onInstall={() => {
                if (busyKey === null && !busy) void install(item.entry)
              }}
            />
          </VStack>
        ))}
      </CardGroup>

      {status ? <NoticeBanner tone={statusTone(status.kind)} text={status.text} /> : null}
    </PageScroll>
  )
}

function actionLabel(status: RepositoryEntryStatus): string {
  if (!status.installed) return t("settings.shared.install")
  if (status.updateAvailable) return t("settings.repo.updateAvailable", { version: status.entry.version })
  return t("settings.shared.reinstall")
}

function EntryRow({
  status,
  busy,
  label,
  onInstall,
}: {
  status: RepositoryEntryStatus
  busy: boolean
  label: string
  onInstall: () => void
}) {
  const tint = useTint()
  const installedVersion = status.installed?.meta?.version ?? status.installed?.stored.version
  const isInstalled = Boolean(status.installed) && !status.updateAvailable
  const languages = status.entry.languages?.filter(Boolean) ?? []
  const metaLine = [
    languages.length > 0 ? languages.join(" / ") : "",
    status.entry.key,
    `v${status.entry.version}`,
    installedVersion ? t("settings.repo.installedVersion", { version: installedVersion }) : "",
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <HStack
      spacing={12}
      padding={rowPadding}
      alignment="center"
      frame={{ maxWidth: "infinity" }}
    >
      {status.entry.iconUrl ? (
        <Image
          imageUrl={status.entry.iconUrl}
          resizable={true}
          scaleToFill={true}
          frame={{ width: 36, height: 36 }}
          clipShape={rect(radius.md)}
        />
      ) : (
        <IconBadge icon="shippingbox" />
      )}
      <VStack alignment="leading" spacing={2}>
        <HStack spacing={6} alignment="center">
          <Text font="body" fontWeight="medium" lineLimit={1}>
            {status.entry.name}
          </Text>
          {status.entry.nsfw ? <Tag text={t("settings.repo.r18")} tone="danger" /> : null}
        </HStack>
        {status.entry.description ? (
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
            {status.entry.description}
          </Text>
        ) : null}
        <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1}>
          {metaLine}
        </Text>
      </VStack>
      <Spacer />
      <Button
        title={label}
        buttonStyle="bordered"
        controlSize="small"
        tint={isInstalled ? "secondaryLabel" : tint.tint}
        disabled={busy}
        action={onInstall}
      />
    </HStack>
  )
}

/** 這一頁的時間戳記目前是固定格式（`YYYY/MM/DD HH:MM`）；語言化的日期留給以後的票。 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
