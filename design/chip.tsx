// 分區 chip（玻璃膠囊）：探索、分類、排行的分區切換，以及詳情頁的章節工具列。

import { Button, HStack, Image, ScrollView, Text } from "scripting"

import { useTint } from "../app/theme"
import { GlassSurface } from "./GlassSurface"
import { capsule, chipCompactPadding, chipPadding, chipRowPadding, type StackChildren } from "./tokens"

export interface ChipProps {
  /** 文字。只有圖示的 chip（排序那種）可以不給。 */
  text?: string
  /** 左側的 SF Symbol。 */
  icon?: string
  /** 文字右側的次要數字（分組的章節數）。 */
  detail?: string
  /** 右側再一個收合箭號：這顆膠囊會開選單（Menu）時用，告訴使用者按下去有東西。 */
  chevron?: boolean
  /** 選中＝ tint 階梯的底＋ tint 字。 */
  selected?: boolean
  /** 緊湊版：章節工具列用（caption2 + `chipCompactPadding`）。 */
  compact?: boolean
  /** 不能按（例如沒東西可下載）；文字轉成 tertiaryLabel。 */
  disabled?: boolean
  /** 給了就整顆可點（內部包 Button）；導覽用的 chip 交給外層 NavigationLink，不用給。 */
  onTap?: () => void
  /** 玻璃的按壓回饋。導覽用的 chip 由外層 link 負責按下效果，這裡就不用再開。 */
  interactive?: boolean
  /** 讀屏用的說法（沒有文字時必填）。 */
  accessibilityLabel?: string
}

export function Chip({
  text,
  icon,
  detail,
  chevron = false,
  selected = false,
  compact = false,
  disabled = false,
  onTap,
  interactive,
  accessibilityLabel,
}: ChipProps) {
  const tint = useTint()
  const textColor = selected ? tint.tint : disabled ? "tertiaryLabel" : "label"
  const glyphColor = selected ? tint.tint : disabled ? "tertiaryLabel" : "secondaryLabel"
  const pill = (
    <GlassSurface
      variant="regular"
      shape={capsule("circular")}
      interactive={interactive ?? (onTap !== undefined && !disabled)}
    >
      <HStack
        spacing={compact ? 4 : 6}
        padding={compact ? chipCompactPadding : chipPadding}
        background={selected ? tint.selected : undefined}
        clipShape={capsule("circular")}
      >
        {icon ? (
          <Image
            systemName={icon}
            font={compact ? "caption2" : "subheadline"}
            fontWeight="semibold"
            foregroundStyle={glyphColor}
          />
        ) : null}
        {text ? (
          <Text
            font={compact ? "caption2" : "subheadline"}
            fontWeight={selected ? "bold" : "medium"}
            foregroundStyle={textColor}
            lineLimit={1}
          >
            {text}
          </Text>
        ) : null}
        {detail ? (
          <Text font="caption2" fontWeight="medium" foregroundStyle={selected ? tint.tint : "tertiaryLabel"}>
            {detail}
          </Text>
        ) : null}
        {chevron ? (
          <Image systemName="chevron.down" font="caption2" foregroundStyle={disabled ? "tertiaryLabel" : "secondaryLabel"} />
        ) : null}
      </HStack>
    </GlassSurface>
  )

  if (!onTap) return pill

  return (
    <Button
      buttonStyle="plain"
      disabled={disabled}
      action={onTap}
      accessibilityLabel={accessibilityLabel ?? text}
      accessibilityAddTraits={selected ? "isSelected" : undefined}
    >
      {pill}
    </Button>
  )
}

/** 橫向捲動的 chip 列（自帶兩側留白）。 */
export function ChipRow({ children }: { children: StackChildren }) {
  return (
    <ScrollView axes="horizontal">
      <HStack spacing={8} padding={chipRowPadding}>
        {children}
      </HStack>
    </ScrollView>
  )
}
