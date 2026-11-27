import { Button, HStack, Image, ScrollView, Text } from "scripting"

import { useTint } from "../app/theme"
import { GlassSurface } from "./GlassSurface"
import { capsule, chipCompactPadding, chipPadding, chipRowPadding, type StackChildren } from "./tokens"

export interface ChipProps {
  text?: string
  icon?: string
  detail?: string
  chevron?: boolean
  selected?: boolean
  compact?: boolean
  disabled?: boolean
  onTap?: () => void
  interactive?: boolean
  accessibilityLabel?: string
  contentOpacity?: number
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
  contentOpacity = 1,
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
        opacity={contentOpacity}
        background={selected ? tint.selected : undefined}
        clipShape={capsule("circular")}
        accessibilityLabel={onTap ? undefined : accessibilityLabel}
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

export function ChipRow({ children }: { children: StackChildren }) {
  return (
    <ScrollView axes="horizontal">
      <HStack spacing={8} padding={chipRowPadding}>
        {children}
      </HStack>
    </ScrollView>
  )
}
