// 頁面上的資訊標籤：章數、來源、連載狀態、分級、評分、喜愛數。
//
// 不在圖片上，所以不是 `CoverBadge`（那是給封面角標的玻璃膠囊）。
// 底色與字色一色一個意思：中性讀起來像附註，有色 tone 只在狀態需要被看見時用。

import { HStack, Image, Text, type Color, type DynamicShapeStyle } from "scripting"

import { badgePadding, fill, radius, rect, tagText, tagTone } from "./tokens"

export type TagTone = "neutral" | "danger" | "warning" | "love"

export interface TagProps {
  text: string
  /** 左側的 SF Symbol。 */
  icon?: string
  tone?: TagTone
  /** 讀屏用的說法（數字被縮寫時才需要，例如 1.2k）。 */
  accessibilityLabel?: string
}

/** 有色 tone 的底色與字色；中性不進來（它用 `fill.tag` 與 `secondaryLabel`）。 */
const TONES: Record<Exclude<TagTone, "neutral">, { background: Color; text: DynamicShapeStyle }> = {
  danger: { background: tagTone.danger, text: tagText.danger },
  warning: { background: tagTone.warning, text: tagText.warning },
  love: { background: tagTone.love, text: tagText.love },
}

export function Tag({ text, icon, tone = "neutral", accessibilityLabel }: TagProps) {
  const accent = tone === "neutral" ? undefined : TONES[tone]
  const textColor: Color | DynamicShapeStyle = accent ? accent.text : "secondaryLabel"

  return (
    <HStack
      spacing={4}
      padding={badgePadding}
      background={accent ? accent.background : fill.tag}
      clipShape={rect(radius.sm)}
      accessibilityLabel={accessibilityLabel}
    >
      {icon ? <Image systemName={icon} font="caption2" foregroundStyle={textColor} /> : null}
      <Text font="caption2" fontWeight={accent ? "bold" : "medium"} foregroundStyle={textColor} lineLimit={1}>
        {text}
      </Text>
    </HStack>
  )
}
