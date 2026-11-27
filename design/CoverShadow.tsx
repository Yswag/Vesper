import { RoundedRectangle, ZStack } from "scripting"
import { coverShadowAmbient, coverShadowKey, coverShadowPenumbra, fill, radius, type StackChildren } from "./tokens"

export function CoverShadow({ children, cornerRadius = radius.md }: { children: StackChildren; cornerRadius?: number }) {
  return (
    <ZStack
      background={
        <ZStack padding={1}>
          <RoundedRectangle cornerRadius={cornerRadius} fill={fill.surface} shadow={coverShadowAmbient} />
          <RoundedRectangle cornerRadius={cornerRadius} fill={fill.surface} shadow={coverShadowPenumbra} />
          <RoundedRectangle cornerRadius={cornerRadius} fill={fill.surface} shadow={coverShadowKey} />
        </ZStack>
      }
    >
      {children}
    </ZStack>
  )
}
