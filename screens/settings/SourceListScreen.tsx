// 源管理：倉庫入口、手動加入源，以及已安裝的源清單。點一筆源進詳情（啟用/移除），長按拖曳排序，左滑移除。

import {
  Button, ForEach, HStack, Image, List, NavigationLink, Rectangle, Section, Spacer, Text, VStack, ZStack,
  useEffect, useObservable, useState,
} from "scripting"

import { PageBackground } from "../../app/theme"
import { scrollTopBar } from "../../design/glass"
import { GroupHeader } from "../../design/layout"
import { IconRow } from "../../design/rows"
import { EmptyState, NoticeBanner } from "../../design/status"
import { cardBackground, pageSpacing, palette, sourceIconSize, toneText } from "../../design/tokens"
import { SourceAvatar } from "../../components/SourceAvatar"
import { appDataRoot, hasFileAccess } from "../../engine/fs"
import { t } from "../../i18n"
import { allSources, reloadRegistry, reorderSources, subscribeSources, uninstallSource, type InstalledSource } from "../../sources/registry"
import { listRepositories, subscribeRepositories } from "../../sources/repository"
import { RepositoryListScreen } from "./RepositoryListScreen"
import { SourceDetailScreen } from "./SourceDetailScreen"

/** `ForEach` 要求每筆都有 `id`，源的身分就是它的 key。 */
export type SourceRow = { id: string; source: InstalledSource }

function toRows(sources: InstalledSource[]): SourceRow[] {
  return sources.map(source => ({ id: source.stored.key, source }))
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index])
}

export function SourceListScreen() {
  const rows = useObservable<SourceRow[]>(() => toRows(allSources()))
  const [repositoryCount, setRepositoryCount] = useState(0)

  useEffect(() => {
    const refreshSources = () => rows.setValue(toRows(allSources()))
    const refreshRepositories = () => setRepositoryCount(listRepositories().length)
    // 系統拖曳放手後 ForEach 直接改寫 rows；順序跟 registry 不同才寫回，寫失敗就退回原順序。
    const persistOrder = (next: SourceRow[]) => {
      const keys = next.map(row => row.id)
      if (sameOrder(keys, allSources().map(source => source.stored.key))) return
      if (!reorderSources(keys)) refreshSources()
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

  return (
    <SourceListView
      rows={rows}
      repositoryCount={repositoryCount}
      fileAccess={hasFileAccess()}
      onRemove={source => uninstallSource(source.stored.key)}
    />
  )
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
}: {
  rows: Observable<SourceRow[]>
  repositoryCount: number
  fileAccess: boolean
  onRemove: (source: InstalledSource) => void
}) {
  const count = rows.value.length
  /** 正在確認移除的源 key；確認選單掛在那一列上，iOS 26 起會從那一列彈出。 */
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

        <Section
          header={
            <VStack padding={{ leading: -16 }}>
              <GroupHeader title={t("settings.sources.installedGroup", { n: count })} />
            </VStack>
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
                  destination={<SourceDetailScreen sourceKey={row.id} />}
                  listRowBackground={cardRowBackground}
                  confirmationDialog={{
                    title: t("settings.sourceDetail.removeTitle", { name: row.source.meta?.name ?? row.source.stored.name }),
                    titleVisibility: "visible",
                    isPresented: pendingKey === row.id,
                    onChanged: (shown: boolean) => { if (!shown) setPendingKey(null) },
                    message: <Text>{t("settings.sourceDetail.removeMessage")}</Text>,
                    actions: (
                      <Button
                        title={t("common.remove")}
                        role="destructive"
                        action={() => onRemove(row.source)}
                      />
                    ),
                  }}
                  // 別給 role="destructive"：它搭 Dialog.confirm 事後才刪列會閃退（dev/probe-swipe-remove-crash.tsx）。
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
                  <SourceCardRow source={row.source} />
                </NavigationLink>
              )}
            />
          )}
        </Section>
      </List>
    </ZStack>
  )
}

/**
 * 一筆已安裝的源。首字圓形徽章是這頁特有的（源沒有封面），其他樣式都走設計庫。
 * 箭頭由 List 的 NavigationLink 自己畫。
 */
function SourceCardRow({ source }: { source: InstalledSource }) {
  const meta = source.meta
  const name = meta?.name ?? source.stored.name

  return (
    <HStack spacing={14} alignment="center" frame={{ maxWidth: "infinity" }}>
      <SourceAvatar
        sourceKey={source.stored.key}
        name={name}
        size={sourceIconSize}
        instance={source.instance}
        iconUrl={source.stored.iconUrl}
      />

      <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="body" fontWeight="medium" foregroundStyle="label" lineLimit={1}>
          {name}
        </Text>
        <Text
          font="caption2"
          foregroundStyle={source.error ? toneText.danger : "secondaryLabel"}
          lineLimit={1}
        >
          {source.error ?? `${source.stored.key} · v${meta?.version ?? source.stored.version}`}
        </Text>
      </VStack>

      <Spacer />

      {source.error ? (
        <HStack spacing={4} alignment="center">
          <Image systemName="exclamationmark.triangle.fill" font="caption" foregroundStyle={toneText.danger} />
          <Text foregroundStyle={toneText.danger} font="caption2" fontWeight="medium">
            {t("settings.sources.failed")}
          </Text>
        </HStack>
      ) : !source.enabled ? (
        <Text foregroundStyle="tertiaryLabel" font="caption2">
          {t("settings.sources.disabled")}
        </Text>
      ) : null}
    </HStack>
  )
}
