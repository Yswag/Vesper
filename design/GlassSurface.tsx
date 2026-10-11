import { VStack, type Color, type Shape, type VirtualNode } from "scripting"

import { radius, rect, shadow } from "./tokens"

export interface GlassSurfaceProps {
  children: VirtualNode | VirtualNode[]
  variant?: "regular" | "clear"
  shape?: Shape
  tint?: Color
  interactive?: boolean
  /** 是否加上卡片陰影（預設 true）。浮動元素（HUD、sheet）通常需要；平鋪卡片可關掉避免過重。 */
  shadow?: boolean
}

export function GlassSurface({ 
  children, 
  variant = "regular", 
  shape = rect(radius.card), 
  tint, 
  interactive = false,
  shadow: enableShadow = true 
}: GlassSurfaceProps) {
  let glass = variant === "clear" ? UIGlass.clear() : UIGlass.regular()
  glass = glass.interactive(interactive)
  if (tint) glass = glass.tint(tint)
  return (
    <VStack 
      spacing={0} 
      glassEffect={{ glass, shape }}
      shadow={enableShadow ? shadow.card : undefined}
    >
      {children}
    </VStack>
  )
}
