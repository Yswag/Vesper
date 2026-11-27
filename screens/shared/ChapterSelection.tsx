import { Button, HStack, Image, Menu, Spacer, Text, VStack, useEffect, useState } from "scripting"

import { useTint } from "../../app/theme"
import { Chip } from "../../design/chip"
import { GlassSurface } from "../../design/GlassSurface"
import { GlassToolbar } from "../../design/GlassToolbar"
import { capsule } from "../../design/tokens"
import { t } from "../../i18n"

export const selectionAnimation = Animation.snappy({ duration: 0.3 })

export const selectionBarExitMs = 100

const barEnterAnimation = Animation.snappy({ duration: 0.3 }).delay(0.1)

const headerCollapseStep = 39

const headerCollapseAnimation = Animation.bouncy({ duration: 0.6 })

const barEdgeInset = 21

export const selectionBarClearance = 72

export function ChapterListHeader({
  selecting,
  selectedCount,
  countText,
  reverseOrder,
  canMarkAllRead,
  canDownloadAll,
  onToggleSort,
  onToggleSelecting,
  onMarkAllRead,
  onDownloadAll,
}: {
  selecting: boolean
  selectedCount: number
  countText: string
  reverseOrder: boolean
  canMarkAllRead: boolean
  canDownloadAll: boolean
  onToggleSort: () => void
  onToggleSelecting: () => void
  onMarkAllRead: () => void
  onDownloadAll: () => void
}) {
  return (
    <HStack alignment="center" spacing={6}>
      <HStack spacing={6} alignment="firstTextBaseline">
        <Text font="title3" fontWeight="bold" lineLimit={1}>
          {selecting ? t("detail.selectedCount", { n: selectedCount }) : t("detail.chaptersTitle")}
        </Text>
        <Text
          font="subheadline"
          fontWeight="medium"
          foregroundStyle="tertiaryLabel"
          opacity={selecting ? 0 : 1}
        >
          {countText}
        </Text>
      </HStack>
      <Spacer />
      <GlassToolbar spacing={6} fusionDistance={4}>
        <HStack
          offset={{ x: selecting ? headerCollapseStep * 2 : 0, y: 0 }}
          animation={{ animation: headerCollapseAnimation, value: selecting }}
          allowsHitTesting={!selecting}
          accessibilityHidden={selecting}
        >
          <Chip
            compact
            icon="arrow.up.arrow.down"
            selected={reverseOrder}
            contentOpacity={selecting ? 0 : 1}
            accessibilityLabel={reverseOrder ? t("detail.sortAscending") : t("detail.sortDescending")}
            onTap={onToggleSort}
          />
        </HStack>
        <HStack
          offset={{ x: selecting ? headerCollapseStep : 0, y: 0 }}
          animation={{ animation: headerCollapseAnimation, value: selecting }}
          allowsHitTesting={!selecting}
          accessibilityHidden={selecting}
        >
          <Menu
            label={
              <Chip
                compact
                icon="ellipsis.circle"
                contentOpacity={selecting ? 0 : 1}
                accessibilityLabel={t("detail.moreActions")}
              />
            }
          >
            <Button
              title={t("detail.markAllRead")}
              systemImage="checkmark.circle"
              disabled={!canMarkAllRead}
              action={onMarkAllRead}
            />
            <Button
              title={t("detail.downloadAll")}
              systemImage="arrow.down.circle"
              disabled={!canDownloadAll}
              action={onDownloadAll}
            />
          </Menu>
        </HStack>
        <Chip
          compact
          text={selecting ? t("detail.selectDone") : t("detail.select")}
          selected={selecting}
          onTap={onToggleSelecting}
        />
      </GlassToolbar>
    </HStack>
  )
}

export function SelectionTabBarHider({ selecting }: { selecting: boolean }) {
  const [hidden, setHidden] = useState(selecting)
  useEffect(() => {
    if (selecting) {
      void withAnimation(selectionAnimation, () => setHidden(true))
      return
    }
    const timer = setTimeout(() => {
      void withAnimation(selectionAnimation, () => setHidden(false))
    }, selectionBarExitMs)
    return () => clearTimeout(timer)
  }, [selecting])
  return <VStack frame={{ width: 0, height: 0 }} tabBarVisibility={hidden ? "hidden" : "automatic"} />
}

export function ChapterSelectionBar({
  visible,
  allSelected,
  downloadCount,
  readCount,
  onToggleAll,
  onDownload,
  onMarkRead,
}: {
  visible: boolean
  allSelected: boolean
  downloadCount: number
  readCount: number
  onToggleAll: () => void
  onDownload: () => void
  onMarkRead: () => void
}) {
  return (
    <VStack spacing={0} ignoresSafeArea={{ regions: "container", edges: "bottom" }}>
      <VStack
        padding={{ horizontal: barEdgeInset, bottom: barEdgeInset }}
        opacity={visible ? 1 : 0}
        allowsHitTesting={visible}
        animation={{ animation: visible ? barEnterAnimation : selectionAnimation, value: visible }}
      >
        {}
        <VStack animation={{ animation: selectionAnimation, value: `${allSelected}|${downloadCount}` }}>
          <GlassSurface shape={capsule("continuous")}>
            <HStack spacing={0} padding={{ horizontal: 6 }}>
              <BarButton
                icon={allSelected ? "checklist.unchecked" : "checklist.checked"}
                title={allSelected ? t("detail.deselectAll") : t("detail.selectAll")}
                onTap={onToggleAll}
              />
              <BarButton
                icon="arrow.down.circle"
                title={downloadCount > 0 ? t("detail.downloadSelected", { n: downloadCount }) : t("detail.download")}
                disabled={downloadCount === 0}
                onTap={onDownload}
              />
              <BarButton
                icon="checkmark.circle"
                title={t("detail.markRead")}
                disabled={readCount === 0}
                onTap={onMarkRead}
              />
            </HStack>
          </GlassSurface>
        </VStack>
      </VStack>
    </VStack>
  )
}

function BarButton({
  icon,
  title,
  disabled = false,
  onTap,
}: {
  icon: string
  title: string
  disabled?: boolean
  onTap: () => void
}) {
  const tint = useTint()
  const color = disabled ? "tertiaryLabel" : tint.tint
  return (
    <Button buttonStyle="plain" disabled={disabled} action={onTap}>
      <HStack spacing={6} padding={{ horizontal: 12, vertical: 15 }} contentShape="rect">
        <Image systemName={icon} font="subheadline" fontWeight="semibold" foregroundStyle={color} />
        <Text font="subheadline" fontWeight="medium" foregroundStyle={color} lineLimit={1}>
          {title}
        </Text>
      </HStack>
    </Button>
  )
}
