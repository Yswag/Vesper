import { HStack, Text, VStack, ZStack, type Color, type DynamicShapeStyle, type VirtualNode } from "scripting"

import { CoverImage } from "./CoverImage"
import { Chevron } from "../design/rows"
import { radius, rowPadding } from "../design/tokens"

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
  footer?: VirtualNode
  coverOverlay?: VirtualNode
  trailing?: VirtualNode
  onTap?: () => void
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
