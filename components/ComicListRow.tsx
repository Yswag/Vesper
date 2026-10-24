// 卡片裡的一本書：小封面＋書名／副標／細節，右側箭頭。閱讀歷史與離線書庫共用，版面才會一致。

import { HStack, Text, VStack, ZStack, type Color, type DynamicShapeStyle, type VirtualNode } from "scripting"

import { CoverImage } from "./CoverImage"
import { Chevron } from "../design/rows"
import { radius, rowPadding } from "../design/tokens"

/** 列裡的小封面尺寸（寬高比跟網格封面一樣）。 */
export const LIST_COVER = { width: 56, height: 80 } as const

export function ComicListRow({
  sourceKey,
  cover,
  title,
  subtitle,
  subtitleColor = "secondaryLabel",
  detail,
  footer,
  coverOverlay,
  trailing,
  onTap,
  coverTransition,
}: {
  sourceKey: string
  cover?: string
  title: string
  subtitle?: string | null
  subtitleColor?: Color | DynamicShapeStyle
  detail?: string | null
  /** 文字下面再一行（例如閱讀進度條）。 */
  footer?: VirtualNode
  /** 疊在封面上（例如開啟中的暗化轉圈），尺寸用 `LIST_COVER`。 */
  coverOverlay?: VirtualNode
  /** 預設是向右箭頭。 */
  trailing?: VirtualNode
  /** 整列可點時給；外面包了 Button／NavigationLink 就不要給。 */
  onTap?: () => void
  /** 封面當 zoom 轉場的來源（推入的詳情頁用同一組 id／namespace）。 */
  coverTransition?: { id: string; namespace: NamespaceID }
}) {
  return (
    <HStack
      spacing={14}
      padding={rowPadding}
      alignment="center"
      frame={{ maxWidth: "infinity" }}
      contentShape={onTap ? "rect" : undefined}
      onTapGesture={onTap}
    >
      <ZStack frame={LIST_COVER} matchedTransitionSource={coverTransition}>
        <CoverImage
          sourceKey={sourceKey}
          url={cover}
          title={title}
          width={LIST_COVER.width}
          height={LIST_COVER.height}
          cornerRadius={radius.md}
          lifted
        />
        {coverOverlay ?? null}
      </ZStack>

      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity" }}>
        <Text
          font="subheadline"
          fontWeight="semibold"
          foregroundStyle="label"
          lineLimit={1}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text font="caption" foregroundStyle={subtitleColor} lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            {subtitle}
          </Text>
        ) : null}
        {detail ? (
          <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            {detail}
          </Text>
        ) : null}
        {footer ?? null}
      </VStack>

      {trailing ?? <Chevron />}
    </HStack>
  )
}
