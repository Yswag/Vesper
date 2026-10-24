// 版面骨架與卡片：頁面殼（背景 + 標題 + 捲動區）、卡片、分組。
//
// 全 App 的頁面都用同一套 padding 與間距，不然每一頁的內容邊界都會差幾點。

import { HStack, RoundedRectangle, ScrollView, Spacer, Text, VStack, ZStack, type Color, type DynamicShapeStyle, type VirtualNode } from "scripting"

import { PageBackground } from "../app/theme"
import { cardBackground, cardGap, cardShape, hairlineStroke, pageInsets, pageSpacing, radius, type StackChildren } from "./tokens"

/**
 * 頁面殼：極光背景 + inline 標題 + 內容捲動區。
 *
 * 要放導覽列按鈕請傳「元件」而不是節點（`leading={LeadingToolbar}`）：
 * 把 toolbar 這種 modifier prop 的 VirtualNode 傳過元件邊界，這個 runtime 會把裡面的 view render 兩次
 * （實測：設定頁左上角出現兩個 X；同一個節點寫在頁面自己的 JSX 裡就正常）。
 * dev/probe-toolbar-x.tsx 有 9 個變體可以重跑。
 */
export function PageScroll({
  title,
  leading,
  trailing,
  onRefresh,
  zoomFrom,
  children,
}: {
  title?: string
  /** 導覽列左側的元件（例如 LeadingToolbar）。目前沒有頁面需要右側按鈕，要再加。 */
  leading?: () => VirtualNode | null
  /** 導覽列右側的元件（例如加號動作按鈕）。 */
  trailing?: () => VirtualNode | null
  /** 下拉重整回呼。 */
  onRefresh?: () => Promise<void> | void
  /** 推入時從哪個 `matchedTransitionSource` zoom 出來。 */
  zoomFrom?: { sourceID: string; namespace: NamespaceID }
  children: StackChildren
}) {
  const Leading = leading
  const Trailing = trailing
  return (
    <ZStack navigationTransition={zoomFrom ? { type: "zoom", ...zoomFrom } : undefined}>
      <PageBackground />
      <VStack
        spacing={0}
        navigationTitle={title}
        navigationBarTitleDisplayMode="inline"
        toolbar={
          Leading || Trailing
            ? {
                topBarLeading: Leading ? <Leading /> : undefined,
                topBarTrailing: Trailing ? <Trailing /> : undefined,
              }
            : undefined
        }
      >
        <ScrollView axes="vertical" scrollContentBackground="hidden" refreshable={onRefresh ? () => Promise.resolve(onRefresh()) : undefined}>
          <VStack spacing={pageSpacing} padding={pageInsets}>
            {children}
          </VStack>
        </ScrollView>
      </VStack>
    </ZStack>
  )
}

/**
 * 一張圓角卡片。列與列之間自己放 `Divider`（縮排見 rows 的 `rowSeparatorInset`）。
 *
 * 一律帶 1px 高光邊（`hairlineStroke`）：淺色靠那條線跟底色分開，深色是 8% 白線。
 * 頁面不要再自己刻 `background` + `clipShape` + `stroke={hairlineStroke}`。
 */
export function Card({
  children,
  background = cardBackground,
  swipeActionsContainer,
}: {
  children: StackChildren
  background?: Color | DynamicShapeStyle
  swipeActionsContainer?: boolean
}) {
  return (
    <VStack
      spacing={0}
      background={background}
      clipShape={cardShape}
      frame={{ maxWidth: "infinity" }}
      overlay={<RoundedRectangle cornerRadius={radius.lg} stroke={hairlineStroke} />}
      swipeActionsContainer={swipeActionsContainer}
    >
      {children}
    </VStack>
  )
}

/** 分組小標題。清單如果是一疊獨立卡片（不是一張大卡），直接用它當標題。 */
export function GroupHeader({ title }: { title: string }) {
  return (
    <Text font="footnote" fontWeight="medium" foregroundStyle="secondaryLabel" padding={{ leading: 4 }}>
      {title}
    </Text>
  )
}

/** 一組設定：小標題 + 卡片 +（可選）卡下註腳。headerAccessory 可放右側操作按鈕。 */
export function CardGroup({
  title,
  headerAccessory,
  footnote,
  children,
  background,
  swipeActionsContainer,
}: {
  title?: string
  headerAccessory?: VirtualNode | (() => VirtualNode)
  footnote?: string
  children: StackChildren
  background?: Color
  swipeActionsContainer?: boolean
}) {
  const renderedAccessory = typeof headerAccessory === "function" ? headerAccessory() : headerAccessory

  return (
    <VStack spacing={cardGap} alignment="leading">
      {title || renderedAccessory ? (
        <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
          {title ? <GroupHeader title={title} /> : null}
          <Spacer />
          {renderedAccessory ?? null}
        </HStack>
      ) : null}
      <Card background={background} swipeActionsContainer={swipeActionsContainer}>
        {children}
      </Card>
      {footnote ? (
        <Text font="caption2" foregroundStyle="tertiaryLabel" padding={{ leading: 6, top: 2 }}>
          {footnote}
        </Text>
      ) : null}
    </VStack>
  )
}
