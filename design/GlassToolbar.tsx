import { GlassEffectContainer, HStack, type VirtualNode } from "scripting"

export function GlassToolbar({ children, spacing = 8, fusionDistance = 8 }: { children: VirtualNode | VirtualNode[]; spacing?: number; fusionDistance?: number }) {
  return (
    <GlassEffectContainer spacing={fusionDistance}>
      <HStack spacing={spacing}>{children}</HStack>
    </GlassEffectContainer>
  )
}
