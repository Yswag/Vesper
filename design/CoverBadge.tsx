// 圖片上的短角標（頁數、更新時間、「來源已移除」）。只貼在不透明內容上，
// 所以吃得到超薄材質；頁面上的狀態一律用實底徽章，不要拿這個代替。
//
// `maxWidth` 是給「源自己給的長字串」用的：夾在封面寬度內，超出的截斷不換行。

import { HStack, Image, Text, type Color } from "scripting"
import { palette, radius, rect } from "./tokens"

export interface CoverBadgeProps {
  text: string
  icon?: string
  /** danger＝紅字，給「來源已移除」這類狀態；其餘維持 label。 */
  tone?: "default" | "danger"
  /** 夾寬（pt）：短字仍抱內容寬，只有超過才截斷。 */
  maxWidth?: number
  /** 夾寬時膠囊靠哪邊（跟角標所在的角一致）。 */
  alignment?: "leading" | "trailing"
}

export function CoverBadge({ text, icon, tone = "default", maxWidth, alignment = "trailing" }: CoverBadgeProps) {
  const color: Color = tone === "danger" ? palette.red : "label"

  const badge = (
    <HStack
      spacing={3}
      alignment="center"
      padding={{ horizontal: 6, vertical: 3 }}
      background="ultraThinMaterial"
      clipShape={rect(radius.sm)}
    >
      {icon ? <Image systemName={icon} font="caption2" foregroundStyle={color} /> : null}
      <Text font="caption2" fontWeight="semibold" foregroundStyle={color} lineLimit={1}>
        {text}
      </Text>
    </HStack>
  )

  // 夾寬放在外層透明框：材質底只蓋字的寬度，不會被撐成整條。
  if (!maxWidth) return badge
  return <HStack frame={{ maxWidth, alignment }}>{badge}</HStack>
}
