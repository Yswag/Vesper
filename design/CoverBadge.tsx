import { HStack, Image, Text, type Color } from "scripting"

import { useTint } from "../app/theme"
import { capsule, palette, radius, rect } from "./tokens"

export interface CoverBadgeProps {
  text: string
  icon?: string
  tone?: "default" | "danger"
  maxWidth?: number
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

  if (!maxWidth) return badge
  return <HStack frame={{ maxWidth, alignment }}>{badge}</HStack>
}

export function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : String(count)
}

export interface UnreadBadgeProps {
  count: number
  prefix?: string
  accessibilityLabel?: string
}

export function UnreadBadge({ count, prefix = "", accessibilityLabel }: UnreadBadgeProps) {
  const tint = useTint()
  return (
    <HStack
      padding={{ horizontal: 5, vertical: 2 }}
      background={tint.tint}
      clipShape={capsule("circular")}
      accessibilityLabel={accessibilityLabel}
    >
      <Text font="caption2" fontWeight="bold" foregroundStyle={tint.onTint} monospacedDigit lineLimit={1}>
        {`${prefix}${formatUnreadCount(count)}`}
      </Text>
    </HStack>
  )
}
