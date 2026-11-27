import {
  Button, Divider, HStack, Image, LazyVStack, Menu, Navigation, ProgressView, Spacer, Text, VStack, ZStack, useEffect, useState,
} from "scripting"

import { contentLanguageName, getContentLanguages, subscribeContentLanguages } from "../../app/contentLanguages"
import { ThemedNavigationStack, useTint } from "../../app/theme"
import { useSubscription } from "../../app/useSubscription"
import { Chip } from "../../design/chip"
import { CardGroup, PageScroll } from "../../design/layout"
import { IconBadge, InfoRow } from "../../design/rows"
import { EmptyState, NoticeBanner, statusTone, type StatusNotice } from "../../design/status"
import { SkeletonCardGroups } from "../../design/skeleton"
import { Tag } from "../../design/Tag"
import { radius, rect, rowPadding } from "../../design/tokens"
import { hasPro } from "../../engine/pro"
import { subscribe as subscribeLocale, t } from "../../i18n"
import type { CatalogEntry } from "../../sources/catalog"
import {
  entryUnsupportedReason,
  installRepositoryEntry,
  refreshRepository,
  repositoryEntries,
  subscribeSources,
  type RepositoryEntryStatus,
} from "../../sources/registry"
import {
  defaultRepositoryFilter,
  filterRepositoryEntries,
  isRepositoryFilterActive,
  type RepositoryFilter,
} from "../../sources/repositoryFilter"
import {
  getRepository,
  isFromRepository,
  kindOf,
  listRepositories,
  repositoryNameFor,
  subscribeRepositories,
  type RepositoryKind,
  type StoredRepository,
} from "../../sources/repository"
import { ContentLanguageScreen } from "./ContentLanguageScreen"

export function RepositoryDetailScreen({
  repositoryUrl,
  initialQuery = "",
  initialFilter,
}: {
  repositoryUrl: string
  initialQuery?: string
  initialFilter?: Partial<RepositoryFilter>
}) {
  useSubscription(subscribeLocale, subscribeContentLanguages)
  const tint = useTint()
  const [repository, setRepository] = useState<StoredRepository | undefined>(undefined)
  const [entries, setEntries] = useState<RepositoryEntryStatus[]>([])
  const [busy, setBusy] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null)
  const [status, setStatus] = useState<StatusNotice | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [searchText, setSearchText] = useState(initialQuery)
  const [query, setQuery] = useState(initialQuery)
  const [filter, setFilter] = useState<RepositoryFilter>(() => ({
    ...defaultRepositoryFilter(getContentLanguages()),
    ...initialFilter,
  }))

  function sync() {
    setRepository(getRepository(repositoryUrl))
    setEntries(repositoryEntries(repositoryUrl))
    setLoaded(true)
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

  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchText), 200)
    return () => clearTimeout(timer)
  }, [searchText])

  const defaults = getContentLanguages()
  const effective = { ...filter, languages: defaults, query }
  const active = isRepositoryFilterActive(effective, defaults)
  const result = filterRepositoryEntries(entries, effective, defaults)
  const visibleEntries = result.groups.flatMap(group => group.items)

  function patch(next: Partial<RepositoryFilter>) {
    setFilter(current => ({ ...current, ...next }))
  }

  function resetFilters() {
    setFilter(defaultRepositoryFilter(defaults))
    setSearchText("")
    setQuery("")
  }

  async function openLanguages() {
    await Navigation.present({
      element: (
        <ThemedNavigationStack>
          <ContentLanguageScreen />
        </ThemedNavigationStack>
      ),
      modalPresentationStyle: "pageSheet",
    })
  }

  async function install(item: RepositoryEntryStatus) {
    const { entry } = item
    if (entryUnsupportedReason(entry)) return
    if (!repository || !(await confirmInstall(repository, item))) return
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

  async function installAll() {
    if (visibleEntries.length === 0 || busy || busyKey !== null || batchProgress !== null) return
    if (!repository || (await blockedByPro(repository))) return

    const seenInRepo = new Set<string>()
    const uniqueEntries: RepositoryEntryStatus[] = []

    for (const item of visibleEntries) {
      if (seenInRepo.has(item.entry.key)) continue
      seenInRepo.add(item.entry.key)
      uniqueEntries.push(item)
    }

    const newOrUpdate: CatalogEntry[] = []
    const conflict: CatalogEntry[] = []

    for (const item of uniqueEntries) {
      if (entryUnsupportedReason(item.entry)) continue
      if (!item.installed || item.updateAvailable) {
        newOrUpdate.push(item.entry)
      } else if (!item.fromThisRepo) {
        conflict.push(item.entry)
      }
    }

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

      if (actionIndex !== 0 && actionIndex !== 1) return

      if (actionIndex === 0) {
        targetsToInstall = newOrUpdate
        if (targetsToInstall.length === 0) {
          setStatus({ kind: "ready", text: t("settings.repo.allInstalled") })
          return
        }
      } else {
        targetsToInstall = [...newOrUpdate, ...conflict]
      }

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

  if (!loaded) {
    return (
      <PageScroll title={t("settings.shared.repository")}>
        <SkeletonCardGroups />
      </PageScroll>
    )
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

  const hasUpdatable = visibleEntries.some(item => item.updateAvailable)
  const allInstalledFromThisRepo =
    visibleEntries.length > 0 && visibleEntries.every(item => item.fromThisRepo && !item.updateAvailable)
  const isActionDisabled = busy || busyKey !== null || batchProgress !== null || allInstalledFromThisRepo
  const installLabel = batchProgress
    ? t("settings.repo.batchProgress", { current: batchProgress.current, total: batchProgress.total })
    : hasUpdatable
      ? t("settings.repo.updateAll")
      : allInstalledFromThisRepo
        ? t("settings.repo.allInstalled")
        : t("settings.repo.installAllCount", { n: result.shown })
  const grouped = result.groups.length > 1

  function groupTitle(language: string, count: number): string {
    if (!grouped) return t("settings.repo.sourcesGroup", { n: result.shown })
    const name = language === "" ? t("settings.repo.otherLanguage") : contentLanguageName(language)
    return t("settings.repo.languageGroup", { language: name, n: count })
  }

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      toast={{
        message: t("common.copied"),
        isPresented: copied,
        onChanged: presented => setCopied(presented),
        duration: 1.5,
        position: "bottom",
      }}
    >
      <PageScroll
        title={repository.name}
        searchField={{
          placement: "navigationBarDrawer",
          prompt: t("settings.repo.searchPrompt"),
          value: searchText,
          onChanged: setSearchText,
        }}
        trailing={() => (
          <HStack spacing={14} alignment="center">
            {busy ? (
              <ProgressView controlSize="small" />
            ) : (
              <Button
                buttonStyle="plain"
                accessibilityLabel={t("settings.repo.refresh")}
                action={() => void refresh()}
              >
                <Image systemName="arrow.clockwise" font="body" fontWeight="medium" foregroundStyle="label" />
              </Button>
            )}
            <FilterMenu
              filter={filter}
              active={active}
              onToggle={(key, value) => patch({ [key]: value } as Partial<RepositoryFilter>)}
              onLanguages={() => void openLanguages()}
              onReset={resetFilters}
            />
          </HStack>
        )}
      >
        <CardGroup title={t("settings.repo.group")}>
          <VStack
            spacing={0}
            contextMenu={{
              menuItems: (
                <Button
                  title={t("common.copy")}
                  action={() => {
                    void Pasteboard.setString(repository.url)
                    setCopied(true)
                  }}
                />
              ),
            }}
          >
            <InfoRow label={t("settings.shared.url")} value={repository.url} />
          </VStack>
          <Divider padding={{ leading: 16 }} />
          <InfoRow label={t("settings.repo.kind")} value={repositoryKindLabel(kindOf(repository))} />
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

        {active ? (
          <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
            <Text font="caption" foregroundStyle="secondaryLabel">
              {t("settings.repo.resultCount", { shown: result.shown, total: result.total })}
            </Text>
            <Spacer />
            <Chip compact icon="arrow.counterclockwise" text={t("settings.repo.resetFilters")} onTap={resetFilters} />
          </HStack>
        ) : null}

        {result.shown === 0 ? (
          <VStack spacing={12} alignment="center" frame={{ maxWidth: "infinity" }}>
            <EmptyState
              variant="page"
              icon="line.3.horizontal.decrease.circle"
              title={t("settings.repo.noResults")}
              detail={t("settings.repo.noResultsDetail")}
            />
            {active ? <Chip icon="arrow.counterclockwise" text={t("settings.repo.resetFilters")} onTap={resetFilters} /> : null}
          </VStack>
        ) : (
          result.groups.map((group, groupIndex) => (
            <CardGroup
              key={group.language || "other"}
              title={groupTitle(group.language, group.items.length)}
              headerAccessory={
                groupIndex === 0 ? (
                  <Button
                    title={installLabel}
                    buttonStyle="bordered"
                    controlSize="regular"
                    tint={allInstalledFromThisRepo ? "secondaryLabel" : tint.tint}
                    disabled={isActionDisabled || result.shown === 0}
                    action={() => void installAll()}
                  />
                ) : undefined
              }
            >
              <LazyVStack spacing={0} frame={{ maxWidth: "infinity" }}>
                {group.items.map((item, index) => (
                  <VStack key={item.entry.key} spacing={0}>
                    {index > 0 ? <Divider padding={{ leading: 16 }} /> : null}
                    <EntryRow
                      status={item}
                      busy={busy || busyKey !== null}
                      hideLanguages={grouped}
                      label={busyKey === item.entry.key ? t("settings.repo.processing") : actionLabel(item)}
                      onInstall={() => {
                        if (busyKey === null && !busy) void install(item)
                      }}
                    />
                  </VStack>
                ))}
              </LazyVStack>
            </CardGroup>
          ))
        )}

        {status ? <NoticeBanner tone={statusTone(status.kind)} text={status.text} /> : null}
      </PageScroll>
    </ZStack>
  )
}

function FilterMenu({
  filter,
  active,
  onToggle,
  onLanguages,
  onReset,
}: {
  filter: RepositoryFilter
  active: boolean
  onToggle: (key: "installedOnly" | "updatableOnly" | "hideUnsupported" | "hideNsfw", value: boolean) => void
  onLanguages: () => void
  onReset: () => void
}) {
  const toggles = [
    { key: "installedOnly", title: t("settings.repo.filterInstalled") },
    { key: "updatableOnly", title: t("settings.repo.filterUpdatable") },
    { key: "hideUnsupported", title: t("settings.repo.filterHideUnsupported") },
    { key: "hideNsfw", title: t("settings.repo.filterHideNsfw") },
  ] as const

  return (
    <Menu
      label={
        <HStack spacing={4} alignment="center">
          <Image
            systemName={active ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"}
            font="body"
            fontWeight="medium"
            foregroundStyle="label"
            accessibilityLabel={t("settings.repo.filter")}
          />
        </HStack>
      }
    >
      <Button
        title={t("settings.repo.filterLanguage")}
        systemImage="globe"
        menuActionDismissBehavior="disabled"
        action={onLanguages}
      />
      {toggles.map(item => (
        <Button
          key={item.key}
          title={item.title}
          systemImage={filter[item.key] ? "checkmark" : undefined}
          menuActionDismissBehavior="disabled"
          action={() => onToggle(item.key, !filter[item.key])}
        />
      ))}
      <Button
        title={t("settings.repo.resetFilters")}
        systemImage="arrow.counterclockwise"
        disabled={!active}
        action={onReset}
      />
    </Menu>
  )
}

function repositoryKindLabel(kind: RepositoryKind): string {
  if (kind === "aidoku-index") return t("settings.shared.kindAidoku")
  if (kind === "mihon-index") return t("settings.shared.kindMihon")
  return t("settings.shared.kindVenera")
}

async function blockedByPro(repository: StoredRepository): Promise<boolean> {
  const kind = kindOf(repository)
  if (kind === "venera" || hasPro()) return false
  const isMihon = kind === "mihon-index"
  await Dialog.alert({
    title: t(isMihon ? "sources.mihon.requiresPro" : "sources.aidoku.requiresPro"),
    message: t(isMihon ? "sources.mihon.requiresProDetail" : "sources.aidoku.requiresProDetail"),
  })
  return true
}

export async function confirmInstall(repository: StoredRepository, item: RepositoryEntryStatus): Promise<boolean> {
  if (entryUnsupportedReason(item.entry)) return false
  if (await blockedByPro(repository)) return false
  if (!item.installed || item.fromThisRepo) return true
  return await Dialog.confirm({
    title: t("settings.repo.replaceTitle", { name: item.entry.name }),
    message: t("settings.repo.replaceMessage"),
    confirmLabel: t("settings.repo.replace"),
    cancelLabel: t("common.cancel"),
  })
}

export function actionLabel(status: RepositoryEntryStatus): string {
  if (!status.installed) return t("settings.shared.install")
  if (!status.fromThisRepo) return t("settings.repo.replace")
  if (status.updateAvailable) return t("settings.repo.updateAvailable", { version: status.entry.version })
  return t("settings.shared.reinstall")
}

function originName(origin: string | null): string {
  if (!origin) return t("settings.repo.manualOrigin")
  return listRepositories().find(repository => isFromRepository(origin, repository.url))?.name ?? repositoryNameFor(origin)
}

export function EntryRow({
  status,
  busy,
  label,
  hideLanguages = false,
  onInstall,
}: {
  status: RepositoryEntryStatus
  busy: boolean
  label: string
  hideLanguages?: boolean
  onInstall: () => void
}) {
  const tint = useTint()
  const installedVersion = status.installed?.meta?.version ?? status.installed?.stored.version
  const isInstalled = Boolean(status.installed) && !status.updateAvailable
  const languages = hideLanguages ? [] : (status.entry.languages?.filter(Boolean) ?? [])
  const unsupported = entryUnsupportedReason(status.entry)
  const languageLine =
    languages.length > 3 ? `${languages.slice(0, 3).join(" / ")} +${languages.length - 3}` : languages.join(" / ")
  const metaLine = [
    languageLine,
    status.entry.key,
    `v${status.entry.version}`,
    status.entry.extensionLib ? `ext-lib ${status.entry.extensionLib}` : "",
    installedVersion && status.fromThisRepo ? t("settings.repo.installedVersion", { version: installedVersion }) : "",
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
        {unsupported ? (
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
            {unsupported}
          </Text>
        ) : status.entry.description ? (
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
            {status.entry.description}
          </Text>
        ) : null}
        <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1}>
          {metaLine}
        </Text>
        {status.installed && !status.fromThisRepo ? (
          <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1}>
            {t("settings.repo.installedFrom", {
              version: installedVersion ?? "",
              origin: originName(status.installed.stored.origin),
            })}
          </Text>
        ) : null}
      </VStack>
      <Spacer />
      {unsupported ? (
        <Text font="caption" foregroundStyle="secondaryLabel">
          {t("settings.repo.unsupported")}
        </Text>
      ) : (
        <Button
          title={label}
          buttonStyle="bordered"
          controlSize="small"
          tint={isInstalled ? "secondaryLabel" : tint.tint}
          disabled={busy}
          action={onInstall}
        />
      )}
    </HStack>
  )
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
