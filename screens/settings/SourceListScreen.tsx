// 源管理：倉庫入口、可更新的源、已安裝的源清單。
// Mihon 一個擴充一列（拖曳排序、左滑移除、更新都以擴充為單位），Aidoku／Venera 照舊一源一列。

import {
  Button, ForEach, HStack, Image, List, NavigationLink, ProgressView, Rectangle, Section, Spacer, Text, VStack, ZStack,
  useEffect, useObservable, useState,
} from "scripting"

import { availableSourceUpdates, checkSourceUpdates, subscribeSourceUpdates, updateSources } from "../../app/sourceUpdates"
import { PageBackground, useTint } from "../../app/theme"
import { useSubscription } from "../../app/useSubscription"
import { Chip } from "../../design/chip"
import { scrollTopBar } from "../../design/glass"
import { GroupHeader } from "../../design/layout"
import { IconRow } from "../../design/rows"
import { EmptyState, NoticeBanner } from "../../design/status"
import { cardBackground, pageSpacing, palette, sourceIconSize, toneText } from "../../design/tokens"
import { SourceAvatar } from "../../components/SourceAvatar"
import { appDataRoot, hasFileAccess } from "../../engine/fs"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { allSources, reloadRegistry, reorderSourceGroups, subscribeSources, uninstallSource } from "../../sources/registry"
import { groupIdOf, groupSources, type SourceGroup } from "../../sources/groups"
import { listRepositories, subscribeRepositories } from "../../sources/repository"
import { ExtensionDetailScreen } from "./ExtensionDetailScreen"
import { RepositoryListScreen } from "./RepositoryListScreen"
import { SourceDetailScreen } from "./SourceDetailScreen"

/** `ForEach` 要求每筆都有 `id`：Mihon 是擴充，其餘是源。 */
export type SourceRow = { id: string; group: SourceGroup }

function toRows(sources = allSources()): SourceRow[] {
  return groupSources(sources).map(group => ({ id: group.id, group }))
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index])
}

/** 一筆可更新的擴充（畫面只排版，資料由 app/sourceUpdates 算好）。 */
export interface UpdateRow {
  key: string
  group: SourceGroup
  from: string
  to: string
  repositoryName: string
  busy: boolean
  error?: string
}

export interface SourceUpdatesPanel {
  rows: UpdateRow[]
  /** 有更新正在跑（單筆或全部）。 */
  updating: boolean
  checking: boolean
  /** 上一次手動檢查失敗的倉庫數。 */
  checkFailed: number
  onUpdate: (key: string) => void
  onUpdateAll: () => void
  onCheck: () => void
}

export function SourceListScreen() {
  const rows = useObservable<SourceRow[]>(() => toRows())
  const [repositoryCount, setRepositoryCount] = useState(0)
  const [runningKey, setRunningKey] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [checking, setChecking] = useState(false)
  const [checkFailed, setCheckFailed] = useState(0)
  // 更新成功那一列會從清單消失：包在 withAnimation 裡才會淡出。
  useSubscription(notify => subscribeSourceUpdates(() => void withAnimation(notify)), subscribeLocale)
  const updates = updateRowsOf(availableSourceUpdates())

  useEffect(() => {
    const refreshSources = () => rows.setValue(toRows())
    const refreshRepositories = () => setRepositoryCount(listRepositories().length)
    // 系統拖曳放手後 ForEach 直接改寫 rows；順序跟 registry 不同才寫回，寫失敗就退回原順序。
    const persistOrder = (next: SourceRow[]) => {
      const keys = next.map(row => row.id)
      if (sameOrder(keys, toRows().map(row => row.id))) return
      if (!reorderSourceGroups(keys)) refreshSources()
    }
    reloadRegistry()
    refreshSources()
    refreshRepositories()
    rows.subscribe(persistOrder)
    const offSources = subscribeSources(refreshSources)
    const offRepositories = subscribeRepositories(refreshRepositories)
    return () => {
      rows.unsubscribe(persistOrder)
      offSources()
      offRepositories()
    }
  }, [])

  async function run(keys: string[]) {
    if (runningKey !== null) return
    const targets = availableSourceUpdates().filter(update => keys.includes(groupIdOf(update.source.stored.key)))
    if (targets.length === 0) return
    setErrors(current => omit(current, keys))
    const failed = await updateSources(targets, key => setRunningKey(groupIdOf(key)))
    setRunningKey(null)
    if (failed.size > 0) {
      setErrors(current => ({
        ...current,
        ...Object.fromEntries([...failed].map(([key, message]) => [groupIdOf(key), message])),
      }))
    }
  }

  async function check() {
    if (checking) return
    setChecking(true)
    const result = await checkSourceUpdates({ force: true })
    setCheckFailed(result.failed.length)
    setChecking(false)
  }

  return (
    <SourceListView
      rows={rows}
      repositoryCount={repositoryCount}
      fileAccess={hasFileAccess()}
      onRemove={row => uninstallSource(row.id)}
      updates={{
        rows: updates,
        updating: runningKey !== null,
        checking,
        checkFailed,
        onUpdate: key => void run([key]),
        onUpdateAll: () => void run(updates.map(row => row.key)),
        onCheck: () => void check(),
      }}
    />
  )
}

/** 一個擴充只報一次更新（子源共用同一個 apk）。 */
function updateRowsOf(updates: ReturnType<typeof availableSourceUpdates>): UpdateRow[] {
  const groups = new Map(toRows().map(row => [row.id, row.group]))
  const rows = new Map<string, UpdateRow>()
  for (const update of updates) {
    const key = groupIdOf(update.source.stored.key)
    const group = groups.get(key)
    if (!group || rows.has(key)) continue
    rows.set(key, {
      key,
      group,
      from: update.from,
      to: update.to,
      repositoryName: update.repository.name,
      busy: false,
    })
  }
  return [...rows.values()]
}

function omit(record: Record<string, string>, keys: string[]): Record<string, string> {
  const next = { ...record }
  for (const key of keys) delete next[key]
  return next
}

/** 卡片底色：List 的列各自鋪一塊，整個 Section 由系統裁成圓角卡片。 */
const cardRowBackground = <Rectangle fill={cardBackground} />

/** 不是卡片的列（提示、空狀態）：去掉列底與內距，照原樣畫。 */
const bareRow = {
  listRowBackground: <Rectangle fill="clear" />,
  listRowInsets: 0,
  listRowSeparator: "hidden",
} as const

export function SourceListView({
  rows,
  repositoryCount,
  fileAccess,
  onRemove,
  updates,
}: {
  rows: Observable<SourceRow[]>
  repositoryCount: number
  fileAccess: boolean
  onRemove: (row: SourceRow) => void
  updates?: SourceUpdatesPanel
}) {
  const count = rows.value.length
  const updateRows = updates?.rows ?? []
  /** 正在確認移除的列 id；確認選單掛在那一列上，iOS 26 起會從那一列彈出。 */
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  return (
    <ZStack>
      <PageBackground />
      <List
        navigationTitle={t("settings.sources.title")}
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        listSectionSpacing={pageSpacing}
        scrollContentBackground="hidden"
        {...scrollTopBar(null)}
      >
        {!fileAccess ? (
          <Section>
            <VStack {...bareRow}>
              <NoticeBanner
                tone="error"
                text={t("settings.sources.noFileAccess")}
                detail={t("settings.sources.noFileAccessDetail", { path: appDataRoot() })}
              />
            </VStack>
          </Section>
        ) : null}

        {updates && updates.checkFailed > 0 && !updates.checking ? (
          <Section>
            <VStack {...bareRow} spacing={8} alignment="leading">
              <NoticeBanner tone="error" text={t("settings.sources.checkFailed", { n: updates.checkFailed })} />
              <Chip icon="arrow.clockwise" text={t("common.retry")} onTap={updates.onCheck} />
            </VStack>
          </Section>
        ) : null}

        <Section>
          <NavigationLink
            destination={<RepositoryListScreen />}
            listRowBackground={cardRowBackground}
            listRowInsets={{ top: 0, bottom: 0, leading: 0, trailing: 16 }}
          >
            <IconRow
              icon="shippingbox"
              title={t("settings.shared.repository")}
              detail={t("settings.sources.repositoryCount", { n: repositoryCount })}
            />
          </NavigationLink>
        </Section>

        {updates && updateRows.length > 0 ? (
          <Section
            header={
              <SectionHeader
                title={t("settings.sources.updatesGroup", { n: updateRows.length })}
                action={t("settings.sources.updateAll")}
                disabled={updates.updating}
                onAction={updates.onUpdateAll}
              />
            }
          >
            {updateRows.map(row => (
              <VStack key={row.key} listRowBackground={cardRowBackground}>
                <SourceUpdateRow row={row} disabled={updates.updating} onUpdate={() => updates.onUpdate(row.key)} />
              </VStack>
            ))}
          </Section>
        ) : null}

        <Section
          header={
            <SectionHeader
              title={t("settings.sources.installedGroup", { n: count })}
              action={updates && count > 0 ? t("settings.sources.checkUpdates") : undefined}
              busy={updates?.checking}
              onAction={updates?.onCheck}
            />
          }
        >
          {count === 0 ? (
            <VStack {...bareRow}>
              <EmptyState
                variant="page"
                icon="books.vertical"
                title={t("settings.sources.empty")}
                detail={t("settings.sources.emptyDetail")}
              />
            </VStack>
          ) : (
            <ForEach
              data={rows}
              editActions="move"
              builder={row => (
                <NavigationLink
                  key={row.id}
                  destination={
                    row.group.kind === "mihon" ? (
                      <ExtensionDetailScreen packageKey={row.id} />
                    ) : (
                      <SourceDetailScreen sourceKey={row.group.sources[0].stored.key} />
                    )
                  }
                  listRowBackground={cardRowBackground}
                  confirmationDialog={{
                    title:
                      row.group.kind === "mihon"
                        ? t("settings.sources.removeExtensionTitle", { name: row.group.name })
                        : t("settings.sourceDetail.removeTitle", { name: row.group.name }),
                    titleVisibility: "visible",
                    isPresented: pendingKey === row.id,
                    onChanged: (shown: boolean) => { if (!shown) setPendingKey(null) },
                    message: (
                      <Text>
                        {row.group.kind === "mihon"
                          ? t("settings.sources.removeExtensionMessage", { n: row.group.total })
                          : t("settings.sourceDetail.removeMessage")}
                      </Text>
                    ),
                    actions: (
                      <Button
                        title={t("common.remove")}
                        role="destructive"
                        action={() => onRemove(row)}
                      />
                    ),
                  }}
                  // 別給 role="destructive"：它搭 Dialog.confirm 事後才刪列會閃退。
                  trailingSwipeActions={{
                    allowsFullSwipe: false,
                    actions: [
                      <Button
                        key="remove"
                        title={t("common.remove")}
                        systemImage="trash"
                        tint={palette.red}
                        action={() => setPendingKey(row.id)}
                      />,
                    ],
                  }}
                >
                  <SourceCardRow group={row.group} />
                </NavigationLink>
              )}
            />
          )}
        </Section>
      </List>
    </ZStack>
  )
}

/** List 的 Section 標題：左邊小標題，右邊可選一個文字按鈕（執行中換成轉圈）。 */
function SectionHeader({
  title,
  action,
  busy = false,
  disabled = false,
  onAction,
}: {
  title: string
  action?: string
  busy?: boolean
  disabled?: boolean
  onAction?: () => void
}) {
  const tint = useTint()
  return (
    <HStack alignment="center" padding={{ leading: -16, trailing: -12 }}>
      <GroupHeader title={title} />
      <Spacer />
      {busy ? (
        <ProgressView controlSize="small" />
      ) : action && onAction ? (
        <Button buttonStyle="plain" disabled={disabled} action={onAction}>
          <Text font="footnote" fontWeight="semibold" foregroundStyle={disabled ? "tertiaryLabel" : tint.tint}>
            {action}
          </Text>
        </Button>
      ) : null}
    </HStack>
  )
}

/** 一筆可更新的擴充：整列唯一的動作是尾端的更新鈕，不進詳情（下方已安裝那一列才進）。 */
function SourceUpdateRow({ row, disabled, onUpdate }: { row: UpdateRow; disabled: boolean; onUpdate: () => void }) {
  const tint = useTint()

  return (
    <HStack spacing={14} alignment="center" frame={{ maxWidth: "infinity" }}>
      <SourceAvatar
        sourceKey={row.key}
        name={row.group.name}
        size={sourceIconSize}
        instance={row.group.sources[0]?.instance}
        iconUrl={row.group.iconUrl}
      />

      <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="body" fontWeight="medium" foregroundStyle="label" lineLimit={1}>
          {row.group.name}
        </Text>
        <Text font="caption2" foregroundStyle={row.error ? toneText.danger : "secondaryLabel"} lineLimit={1}>
          {row.error ?? t("settings.sources.versionChange", { from: row.from, to: row.to, repository: row.repositoryName })}
        </Text>
      </VStack>

      {row.busy ? (
        <ProgressView controlSize="small" />
      ) : (
        <Button
          title={row.error ? t("common.retry") : t("settings.sources.update")}
          buttonStyle="bordered"
          controlSize="small"
          tint={tint.tint}
          disabled={disabled}
          action={onUpdate}
        />
      )}
    </HStack>
  )
}

/**
 * 一筆已安裝的源（Mihon 是一個擴充）。首字圓形徽章是這頁特有的，其他樣式都走設計庫。
 * 箭頭由 List 的 NavigationLink 自己畫。
 */
function SourceCardRow({ group }: { group: SourceGroup }) {
  const isMihon = group.kind === "mihon"
  const detail = isMihon
    ? [`v${group.version}`, group.total > 1 ? t("settings.sources.languageCount", { on: group.enabledCount, total: group.total }) : ""]
        .filter(Boolean)
        .join(" · ")
    : `${group.sources[0]?.stored.key ?? group.id} · v${group.version}`

  return (
    <HStack spacing={14} alignment="center" frame={{ maxWidth: "infinity" }}>
      <SourceAvatar
        sourceKey={group.id}
        name={group.name}
        size={sourceIconSize}
        instance={group.sources[0]?.instance}
        iconUrl={group.iconUrl}
      />

      <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="body" fontWeight="medium" foregroundStyle="label" lineLimit={1}>
          {group.name}
        </Text>
        <Text font="caption2" foregroundStyle={group.error ? toneText.danger : "secondaryLabel"} lineLimit={1}>
          {group.error ?? detail}
        </Text>
      </VStack>

      <Spacer />

      {group.error ? (
        <HStack spacing={4} alignment="center">
          <Image systemName="exclamationmark.triangle.fill" font="caption" foregroundStyle={toneText.danger} />
          <Text foregroundStyle={toneText.danger} font="caption2" fontWeight="medium">
            {t("settings.sources.failed")}
          </Text>
        </HStack>
      ) : group.disabled ? (
        <Text foregroundStyle="tertiaryLabel" font="caption2">
          {t("settings.sources.disabled")}
        </Text>
      ) : null}
    </HStack>
  )
}
