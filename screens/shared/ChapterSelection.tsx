// 詳情頁章節區的頭部與選取模式底部操作列。
// 進出選取不插拔元件：都常駐、只改字與 opacity／offset，才演得出位移（插入會讓兄弟元件被當成新的而瞬移）。

import { Button, HStack, Image, Menu, Spacer, Text, VStack } from "scripting"

import { useTint } from "../../app/theme"
import { Chip } from "../../design/chip"
import { GlassSurface } from "../../design/GlassSurface"
import { capsule } from "../../design/tokens"
import { t } from "../../i18n"

/** 進出選取模式的動畫（頭部、圓點、底部列共用）。 */
export const selectionAnimation = Animation.snappy({ duration: 0.3 })

/** 底部列收起時往下推的距離：略大於列高，太大前段會耗在畫面外。 */
const barHiddenOffset = 96

/** 選取模式時列表尾端要讓出的高度，最後一話才不會被底部列蓋住。 */
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
  /** 一般模式標題旁的章節數。 */
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
      <HStack spacing={6}>
        <HStack spacing={6} opacity={selecting ? 0 : 1} allowsHitTesting={!selecting}>
          <Chip
            compact
            icon="arrow.up.arrow.down"
            selected={reverseOrder}
            accessibilityLabel={reverseOrder ? t("detail.sortAscending") : t("detail.sortDescending")}
            onTap={onToggleSort}
          />
          <Menu label={<Chip compact icon="ellipsis.circle" accessibilityLabel={t("detail.moreActions")} />}>
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
      </HStack>
    </HStack>
  )
}

/** 選取模式的底部浮動列：常駐，收起時往下推＋透明，並擋掉點擊。 */
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
  /** 勾選中還沒下載的話數（已下載的不重送）。 */
  downloadCount: number
  readCount: number
  onToggleAll: () => void
  onDownload: () => void
  onMarkRead: () => void
}) {
  return (
    <VStack
      padding={{ horizontal: 16, bottom: 8 }}
      offset={{ x: 0, y: visible ? 0 : barHiddenOffset }}
      opacity={visible ? 1 : 0}
      allowsHitTesting={visible}
    >
      <GlassSurface shape={capsule("continuous")}>
        <HStack spacing={0} padding={{ horizontal: 8, vertical: 4 }}>
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
    <Button buttonStyle="plain" disabled={disabled} action={onTap} frame={{ maxWidth: "infinity" }}>
      <VStack spacing={3} padding={{ vertical: 8 }} frame={{ maxWidth: "infinity" }} contentShape="rect">
        <Image systemName={icon} font="body" fontWeight="semibold" foregroundStyle={color} />
        <Text font="caption2" fontWeight="medium" foregroundStyle={color} lineLimit={1}>
          {title}
        </Text>
      </VStack>
    </Button>
  )
}
