import { Device, VStack, type Color, type Material, type Shape, type ShapeStyle, type VirtualNode } from "scripting"

export const liquidGlass: boolean = Number.parseInt(Device.systemVersion, 10) >= 26

export interface GlassOptions {
  shape: Shape
  variant?: "regular" | "clear"
  tint?: Color
  interactive?: boolean
  fallback?: Material
}

export type GlassModifier =
  | { glassEffect: { glass: UIGlass; shape: Shape } }
  | { background: { style: ShapeStyle; shape: Shape } }

export function glass({ shape, variant = "regular", tint, interactive = false, fallback = "ultraThinMaterial" }: GlassOptions): GlassModifier {
  if (!liquidGlass) return { background: { style: tint ?? fallback, shape } }
  let material = variant === "clear" ? UIGlass.clear() : UIGlass.regular()
  if (interactive) material = material.interactive()
  if (tint) material = material.tint(tint)
  return { glassEffect: { glass: material, shape } }
}

export interface TopBarModifier {
  safeAreaBar?: { edge: "top"; content: VirtualNode }
  scrollEdgeEffectStyle?: { style: "soft"; edges: "top" }
  safeAreaInset?: { top: { content: VirtualNode } }
}

const softTop = { style: "soft", edges: "top" } as const

export function scrollTopBar(content: VirtualNode | null | undefined): TopBarModifier {
  if (liquidGlass) return content ? { safeAreaBar: { edge: "top", content }, scrollEdgeEffectStyle: softTop } : { scrollEdgeEffectStyle: softTop }
  if (!content) return {}
  return { safeAreaInset: { top: { content: <VStack spacing={0} background="barMaterial">{content}</VStack> } } }
}
