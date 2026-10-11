// 量測父容器「實際給的寬度」：掛在 `background` 的 `GeometryReader` 需要一個子節點，
// 這顆 0×0 的節點就把寬度回報出去（寬度真的變了才回報一次）。
//
// 用法：
//   <Row background={<GeometryReader>{g => <WidthReporter width={g.size.width} onWidth={setWidth} />}</GeometryReader>} />

import { VStack, useEffect } from "scripting"

export function WidthReporter({ width, onWidth }: { width: number; onWidth: (width: number) => void }) {
  useEffect(() => {
    onWidth(width)
  }, [width])
  return <VStack spacing={0} frame={{ width: 0, height: 0 }} />
}
