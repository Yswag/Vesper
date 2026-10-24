import { HStack, Image, Text, type Color, type VirtualNode } from "scripting"
import { GlassSurface } from "./GlassSurface"
import { radius, rect } from "./tokens"

export interface GlassBadgeProps {
  text?: string
  icon?: string
  iconColor?: Color
  children?: VirtualNode | VirtualNode[]
}

// Only for short status overlays on media, not ordinary list metadata.
export function GlassBadge({ text, icon, iconColor, children }: GlassBadgeProps) {
  return (
    <GlassSurface variant="clear" shape={rect(radius.sm)}>
      <HStack spacing={3} padding={{ horizontal: 6, vertical: 2.5 }} alignment="center">
        {icon ? (
          <Image
            systemName={icon}
            font="caption2"
            foregroundStyle={iconColor || "white"}
          />
        ) : null}
        {text ? (
          <Text font="caption2" fontWeight="medium" foregroundStyle="white" lineLimit={1}>
            {text}
          </Text>
        ) : null}
        {children}
      </HStack>
    </GlassSurface>
  )
}
