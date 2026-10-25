// Liquid Glass 的唯一入口：iOS 26+ 用 glassEffect，更舊的系統改鋪模糊材質（UIGlass 在那裡不能碰）。

import { Device, VStack, type Color, type Material, type Shape, type ShapeStyle, type VirtualNode } from "scripting"

/** 系統是否有 Liquid Glass（iOS 26+）。 */
export const liquidGlass: boolean = Number.parseInt(Device.systemVersion, 10) >= 26

export interface GlassOptions {
  shape: Shape
  variant?: "regular" | "clear"
  tint?: Color
  interactive?: boolean
  /** 舊系統的替代材質。 */
  fallback?: Material
}

export type GlassModifier =
  | { glassEffect: { glass: UIGlass; shape: Shape } }
  | { background: { style: ShapeStyle; shape: Shape } }

/** 展開到 view 上：`<VStack {...glass({ shape })} />`。放在原本 glassEffect 的位置，修飾符順序不變。 */
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

/** 捲動區頂部的 bar（展開到 ScrollView 上）：iOS 26+ 用 safeAreaBar＋柔和邊緣，舊系統用 safeAreaInset 鋪 bar 材質。 */
export function scrollTopBar(content: VirtualNode | null | undefined): TopBarModifier {
  if (liquidGlass) return content ? { safeAreaBar: { edge: "top", content }, scrollEdgeEffectStyle: softTop } : { scrollEdgeEffectStyle: softTop }
  if (!content) return {}
  return { safeAreaInset: { top: { content: <VStack spacing={0} background="barMaterial">{content}</VStack> } } }
}
