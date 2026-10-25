import { GlassEffectContainer, HStack, type VirtualNode } from "scripting"

import { liquidGlass } from "./glass"

export function GlassToolbar({ children, spacing = 8, fusionDistance = 8 }: { children: VirtualNode | VirtualNode[]; spacing?: number; fusionDistance?: number }) {
  const row = <HStack spacing={spacing}>{children}</HStack>
  if (!liquidGlass) return row
  return <GlassEffectContainer spacing={fusionDistance}>{row}</GlassEffectContainer>
}
