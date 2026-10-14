// 源管理：倉庫入口、手動加入源，以及已安裝的源清單。點一筆源進詳情（啟用/移除）。

import { Divider, HStack, Image, NavigationLink, ReorderableForEach, Spacer, Text, VStack, useObservable, useEffect, useRef, useState } from "scripting"

import { Card, CardGroup, GroupHeader, PageScroll } from "../../design/layout"
import { Chevron, IconRow } from "../../design/rows"
import { EmptyState, NoticeBanner } from "../../design/status"
import { avatarSize, cardBackground, cardShape, dangerBadge, palette, rowPadding } from "../../design/tokens"
import { SourceAvatar } from "../../components/SourceAvatar"
import { appDataRoot, hasFileAccess } from "../../engine/fs"
import { t } from "../../i18n"
import { allSources, reloadRegistry, reorderSources, subscribeSources, type InstalledSource } from "../../sources/registry"
import { listRepositories, subscribeRepositories } from "../../sources/repository"
import { RepositoryListScreen } from "./RepositoryListScreen"
import { SourceDetailScreen } from "./SourceDetailScreen"

/** 拖曳排序的列：`ReorderableForEach` 要求每筆都有 `id`，源的身分就是它的 key。 */
type SourceRow = { id: string; source: InstalledSource }

/** 列滑動的動畫（跟閱讀器翻頁同一套：`withAnimation` + 一個 `Animation` 常數）。 */
const REORDER_ANIM = Animation.smooth({ duration: 0.25 })

/** 一列的預估總高度（垂直 padding 14*2 + 頭像/內容高 36 + 分隔線 0.5 ≈ 64.5pt）。用於拖曳時其他列滑開讓位。 */
const ROW_HEIGHT = 65

export function SourceListScreen() {
  const [sources, setSources] = useState<InstalledSource[]>([])
  const [repositoryCount, setRepositoryCount] = useState(0)
  /** 拖曳中：目標插入點索引（在該點騰出一個空位），null 代表沒有在拖曳。 */
  const [targetIndex, setTargetIndex] = useState<number | null>(null)
  /** 正在被拿起的卡片 key（由我們自己完全掌控生命週期，不依賴引擎殘留的 dragging.value）。 */
  const [activeDraggingKey, setActiveDraggingKey] = useState<string | null>(null)
  /**
   * 引擎的地盤：`ReorderableForEach` 自己寫「目前拿起來的那一列」（實測拖一次寫十幾次）。
   * **只讀不寫**（寫了會把「正在拖哪一列」蓋掉），拿它來畫空格與判輪次。
   */
  const dragging = useObservable<SourceRow | null>(null)

  useEffect(() => {
    const refreshSources = () => setSources(allSources())
    const refreshRepositories = () => setRepositoryCount(listRepositories().length)
    reloadRegistry()
    refreshSources()
    refreshRepositories()
    const offSources = subscribeSources(refreshSources)
    const offRepositories = subscribeRepositories(refreshRepositories)
    return () => {
      offSources()
      offRepositories()
    }
  }, [])

  const rows: SourceRow[] = sources.map(source => ({ id: source.stored.key, source }))

  /**
   * 拖曳排序機制：拖曳過程中僅以 Y 軸 offset 模擬位置挪動，
   * 待使用者放手後才以動畫將最終順序持久化寫入 store。
   */
  const dragSnapshot = useRef<SourceRow[] | null>(null)
  const lastActiveId = useRef<string | null>(null)
  const lockedLiftedKey = useRef<string | null>(null)
  const pendingKeys = useRef<string[] | null>(null)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 這輪拖曳收尾：把算好的順序寫進 store（包動畫）。只在真正放手時執行。 */
  function settle() {
    if (settleTimer.current !== null) {
      clearTimeout(settleTimer.current)
      settleTimer.current = null
    }
    lastActiveId.current = null
    lockedLiftedKey.current = null
    dragSnapshot.current = null
    setTargetIndex(null)
    setActiveDraggingKey(null)
    const pending = pendingKeys.current
    pendingKeys.current = null
    if (pending !== null && pending.join(",") !== rows.map(row => row.id).join(",")) {
      void withAnimation(REORDER_ANIM, () => reorderSources(pending))
    }
  }

  function handleMove(indices: number[], newOffset: number) {
    const activeId = dragging.value?.id ?? null
    const newRound = activeId !== null && activeId !== lastActiveId.current
    if (dragSnapshot.current === null || newRound) {
      dragSnapshot.current = rows.slice()
      if (activeId !== null) lockedLiftedKey.current = activeId
    }
    lastActiveId.current = activeId
    const currentLifted = lockedLiftedKey.current ?? activeId
    if (lockedLiftedKey.current === null && activeId !== null) {
      lockedLiftedKey.current = activeId
    }
    if (currentLifted !== null && activeDraggingKey !== currentLifted) {
      setActiveDraggingKey(currentLifted)
    }

    const base = dragSnapshot.current
    const moving = indices.map(index => base[index])
    if (moving.some(row => row === undefined)) return
    const rest = base.filter((_, index) => !indices.includes(index))
    const removedBefore = indices.filter(index => index < newOffset).length
    const at = newOffset - removedBefore
    rest.splice(at, 0, ...moving)
    pendingKeys.current = rest.map(row => row.id)

    // 目標插入位置：其他列藉由 Y 軸 offset 動態滑開讓位
    setTargetIndex(at)

    // 只要有移動事件就重設收尾定時器；手放開後 350ms 無新事件即自動結算
    if (settleTimer.current !== null) clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(settle, 350)
  }

  // 引擎把 dragging 清掉＝放手了 → 馬上收尾。
  if (dragging.value?.id == null && pendingKeys.current !== null) settle()

  return (
    <PageScroll title={t("settings.sources.title")}>
      {!hasFileAccess() ? (
        <NoticeBanner
          tone="error"
          text={t("settings.sources.noFileAccess")}
          detail={t("settings.sources.noFileAccessDetail", { path: appDataRoot() })}
        />
      ) : null}

      {/* 1. 快捷入口 */}
      <CardGroup>
        <NavigationLink destination={<RepositoryListScreen />}>
          <IconRow
            icon="shippingbox"
            title={t("settings.shared.repository")}
            detail={t("settings.sources.repositoryCount", { n: repositoryCount })}
            chevron
          />
        </NavigationLink>
      </CardGroup>

      {/* 2. 已安裝源清單（長按可拖曳排序） */}
      <VStack spacing={8} alignment="leading">
        <GroupHeader title={t("settings.sources.installedGroup", { n: sources.length })} />
        {sources.length === 0 ? (
          <EmptyState
            icon="books.vertical"
            title={t("settings.sources.empty")}
            detail={t("settings.sources.emptyDetail")}
          />
        ) : (
          <Card>
            <ReorderableForEach
              data={rows}
              active={dragging}
              onMove={handleMove}
              builder={(row, index) => {
                const isLifted = activeDraggingKey !== null && row.id === activeDraggingKey
                // 計算視覺位移：將中間項目往上或往下挪出一個空位
                const fromIndex = activeDraggingKey !== null ? rows.findIndex(r => r.id === activeDraggingKey) : -1
                let offsetY = 0
                if (targetIndex !== null && fromIndex >= 0) {
                  if (isLifted) {
                    offsetY = (targetIndex - fromIndex) * ROW_HEIGHT
                  } else if (fromIndex < targetIndex) {
                    if (index > fromIndex && index <= targetIndex) {
                      offsetY = -ROW_HEIGHT
                    }
                  } else if (fromIndex > targetIndex) {
                    if (index >= targetIndex && index < fromIndex) {
                      offsetY = ROW_HEIGHT
                    }
                  }
                }

                return (
                  <VStack
                    key={row.id}
                    spacing={0}
                    frame={{ maxWidth: "infinity" }}
                    offset={{ x: 0, y: offsetY }}
                    animation={{ animation: Animation.smooth({ duration: 0.2 }), value: offsetY }}
                  >
                    {index > 0 ? <Divider padding={{ leading: 66 }} /> : null}
                    <VStack
                      spacing={0}
                      frame={{ maxWidth: "infinity" }}
                      opacity={isLifted ? 0 : 1}
                    >
                      <NavigationLink destination={<SourceDetailScreen sourceKey={row.id} />}>
                        <SourceCardRow source={row.source} />
                      </NavigationLink>
                    </VStack>
                  </VStack>
                )
              }}
            />
          </Card>
        )}
      </VStack>
    </PageScroll>
  )
}

/**
 * 一筆已安裝的源。首字圓形徽章是這頁特有的（源沒有封面），其他樣式都走設計庫。
 */
function SourceCardRow({ source }: { source: InstalledSource }) {
  const meta = source.meta
  const name = meta?.name ?? source.stored.name

  return (
    <HStack
      spacing={14}
      padding={rowPadding}
      alignment="center"
      frame={{ maxWidth: "infinity" }}
    >
      <SourceAvatar sourceKey={source.stored.key} name={name} size={avatarSize} instance={source.instance} />

      <VStack alignment="leading" spacing={2}>
        <Text font="body" fontWeight="medium" foregroundStyle="label">
          {name}
        </Text>
        <Text font="caption2" foregroundStyle="secondaryLabel">
          {source.stored.key} · v{meta?.version ?? source.stored.version}
        </Text>
      </VStack>

      <Spacer />

      {source.error ? (
        <HStack spacing={4} alignment="center">
          <Image systemName="exclamationmark.triangle.fill" font="caption" foregroundStyle="systemRed" />
          <Text foregroundStyle="systemRed" font="caption2" fontWeight="medium">
            {t("settings.sources.failed")}
          </Text>
        </HStack>
      ) : !source.enabled ? (
        <Text foregroundStyle="tertiaryLabel" font="caption2">
          {t("settings.sources.disabled")}
        </Text>
      ) : (
        <Chevron />
      )}
    </HStack>
  )
}
