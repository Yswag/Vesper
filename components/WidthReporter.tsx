import { VStack, useEffect } from "scripting"

export function WidthReporter({ width, onWidth }: { width: number; onWidth: (width: number) => void }) {
  useEffect(() => {
    if (width > 0) onWidth(width)
  }, [width])
  return <VStack spacing={0} frame={{ width: 0, height: 0 }} />
}
