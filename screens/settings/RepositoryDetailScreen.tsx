// 單一倉庫：列出索引裡的源，逐筆安裝 / 更新；下拉可重新整理索引。
// 清單只讀本地快取，重新整理才會連網。

import { Button, Divider, HStack, Spacer, Text, VStack, useEffect, useState } from "scripting"
import { CardGroup, PageScroll } from "../../design/layout"
import { ActionRow, IconBadge, InfoRow, rowSeparatorInset } from "../../design/rows"
import { EmptyState, NoticeBanner, statusTone, type StatusNotice } from "../../design/status"
import { Caption, Footnote } from "../../design/text"
import { palette, rowPadding } from "../../design/tokens"
import { t } from "../../i18n"
import type { CatalogEntry } from "../../sources/catalog"
import {
  installRepositoryEntry,
  refreshRepository,
  repositoryEntries,
  subscribeSources,
  type RepositoryEntryStatus,
} from "../../sources/registry"
import { getRepository, subscribeRepositories, type StoredRepository } from "../../sources/repository"

export function RepositoryDetailScreen({ repositoryUrl }: { repositoryUrl: string }) {
  const [repository, setRepository] = useState<StoredRepository | undefined>(undefined)
  const [entries, setEntries] = useState<RepositoryEntryStatus[]>([])
  const [busy, setBusy] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
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

  if (!repository) {
    return (
      <PageScroll title={t("settings.shared.repository")}>
        <EmptyState
          icon="shippingbox"
          title={t("settings.repo.removed")}
          detail={t("settings.repo.removedDetail")}
        />
      </PageScroll>
    )
  }

  return (
    <PageScroll title={repository.name} onRefresh={refresh}>
      <CardGroup title={t("settings.repo.group")}>
        <InfoRow label={t("settings.shared.url")} value={repository.url} />
        <Divider padding={{ leading: 16 }} />
        <InfoRow label={t("settings.repo.lastUpdated")} value={formatTime(repository.fetchedAt)} />
        <Divider padding={{ leading: 16 }} />
        <InfoRow
          label={t("settings.shared.source")}
          value={t("settings.shared.countSources", { n: repository.entries.length })}
        />
      </CardGroup>

      {repository.error ? (
        <NoticeBanner tone="error" text={t("settings.shared.readFailed")} detail={repository.error} />
      ) : null}

      <CardGroup title={t("settings.repo.sourcesGroup", { n: entries.length })}>
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
  const installedVersion = status.installed?.meta?.version ?? status.installed?.stored.version
  const isInstalled = Boolean(status.installed) && !status.updateAvailable

  return (
    <HStack
      spacing={12}
      padding={rowPadding}
      alignment="center"
      frame={{ maxWidth: "infinity" }}
    >
      <IconBadge icon="shippingbox" />
      <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="body" fontWeight="medium">
          {status.entry.name}
        </Text>
        {status.entry.description ? <Caption>{status.entry.description}</Caption> : null}
        <Footnote>
          {`${status.entry.key} · v${status.entry.version}${
            installedVersion ? ` · ${t("settings.repo.installedVersion", { version: installedVersion })}` : ""
          }`}
        </Footnote>
      </VStack>
      <Spacer />
      <Button
        title={label}
        buttonStyle="bordered"
        controlSize="small"
        tint={isInstalled ? "secondaryLabel" : "accentColor"}
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
