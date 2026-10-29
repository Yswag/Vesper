// 詳情頁章節區的頭部與選取模式底部操作列。
// 進出選取不插拔元件：都常駐、只改字與 opacity／offset，才演得出位移（插入會讓兄弟元件被當成新的而瞬移）。

import { Button, HStack, Image, Menu, Spacer, Text, VStack, useEffect, useState } from "scripting"

import { useTint } from "../../app/theme"
import { Chip } from "../../design/chip"
import { GlassSurface } from "../../design/GlassSurface"
import { GlassToolbar } from "../../design/GlassToolbar"
import { capsule } from "../../design/tokens"
import { t } from "../../i18n"

/** 進出選取模式的動畫（頭部、圓點、底部列共用）。 */
export const selectionAnimation = Animation.snappy({ duration: 0.3 })

/** 退出選取後等多久（毫秒）放 tab bar 回來：底部列收到一半就接上，兩段動畫重疊才無縫。 */
export const selectionBarExitMs = 150

/** 底部列收起時往下推的距離：略大於列高，太大前段會耗在畫面外。 */
const barHiddenOffset = 96

/** 頭部圖示膠囊收起時每顆往右推的距離：一顆 compact 圖示 Chip 寬＋間距，收到選取鈕底下。 */
const headerCollapseStep = 39

/** 頭部膠囊收合的動畫：比 `selectionAnimation` 慢，玻璃融合只發生在最後幾 pt，太快看不到。 */
const headerCollapseAnimation = Animation.bouncy({ duration: 0.6 })

/** 底部列離螢幕左右與底緣的距離：對齊浮動 tab bar（實機量約 21pt）。不跟安全區走，tab bar 藏起／回來時才不會被頂著跳。 */
const barEdgeInset = 21

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

/**
 * 選取時藏起 tab bar，退出時等底部列收到一半再放回來。
 * 做成獨立的零尺寸元件：計時到時只重繪它自己，不會在動畫中途重算整頁詳情。
 */
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
    // 外層無視底部安全區、內層自己留距：兩層分開寫，不靠修飾的套用順序。
    <VStack spacing={0} ignoresSafeArea={{ regions: "container", edges: "bottom" }}>
      <VStack
        padding={{ horizontal: barEdgeInset, bottom: barEdgeInset }}
        offset={{ x: 0, y: visible ? 0 : barHiddenOffset }}
        opacity={visible ? 1 : 0}
        allowsHitTesting={visible}
      >
        <GlassSurface shape={capsule("continuous")}>
          <HStack spacing={0} padding={{ horizontal: 8, vertical: 5 }}>
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
