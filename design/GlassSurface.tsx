import { VStack, type Color, type Shape, type VirtualNode } from "scripting"

import { radius, rect } from "./tokens"

export interface GlassSurfaceProps {
  children: VirtualNode | VirtualNode[]
  variant?: "regular" | "clear"
  shape?: Shape
  tint?: Color
  interactive?: boolean
}

/** 玻璃面。不加陰影：系統材質自帶邊緣與深度。 */
export function GlassSurface({
  children,
  variant = "regular",
  shape = rect(radius.lg),
  tint,
  interactive = false,
}: GlassSurfaceProps) {
  let glass = variant === "clear" ? UIGlass.clear() : UIGlass.regular()
  glass = glass.interactive(interactive)
  if (tint) glass = glass.tint(tint)
  return (
    <VStack spacing={0} glassEffect={{ glass, shape }}>
      {children}
    </VStack>
  )
}
