import { Text } from "scripting"

export function Footnote({ children }: { children: string }) {
  return (
    <Text font="caption2" foregroundStyle="tertiaryLabel">
      {children}
    </Text>
  )
}

export function Caption({ children }: { children: string }) {
  return (
    <Text font="caption" foregroundStyle="secondaryLabel">
      {children}
    </Text>
  )
}
