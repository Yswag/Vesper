// 分區 chip（玻璃膠囊）：供探索、分類、排行等場景切換分區。

import { Button, HStack, ScrollView, Text } from "scripting"

import { GlassSurface } from "./GlassSurface"
import { capsule, chipPadding, chipRowPadding, fill, palette, type StackChildren } from "./tokens"

export interface ChipProps {
  text: string
  /** 選中＝藍底＋藍字粗體。 */
  selected?: boolean
  /** 給了就整顆可點（內部包 Button）；導覽用的 chip 交給外層 NavigationLink，不用給。 */
  onTap?: () => void
  /** 玻璃的按壓回饋。導覽用的 chip 由外層 link 負責按下效果，這裡就不用再開。 */
  interactive?: boolean
}

export function Chip({ text, selected = false, onTap, interactive }: ChipProps) {
  const pill = (
    <GlassSurface variant="regular" shape={capsule("circular")} interactive={interactive ?? onTap !== undefined}>
      <HStack
        spacing={6}
        padding={chipPadding}
        background={selected ? fill.selected : undefined}
        clipShape={capsule("circular")}
      >
        <Text
          font="subheadline"
          fontWeight={selected ? "bold" : "medium"}
          foregroundStyle={selected ? palette.blue : "label"}
        >
          {text}
        </Text>
      </HStack>
    </GlassSurface>
  )

  if (!onTap) return pill

  return (
    <Button
      buttonStyle="plain"
      action={onTap}
      accessibilityLabel={text}
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
