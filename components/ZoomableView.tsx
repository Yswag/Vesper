// 可縮放的內容容器：捏合縮放（1–maxZoom）、放大後拖曳平移（夾在圖片邊緣）、
// 雙擊以「點到的位置」為錨點縮放。
//
// 給兩種地方用：封面的原圖檢視器（`CoverViewerScreen`）與閱讀器的漫畫頁。
//
// 四個關鍵設計（都是踩過坑才定下來的）：
// ① **手勢物件只建一次**（`useMemo(..., [])`），callback 讀 `useRef` 的最新值。
//    在 render 裡重建 GestureInfo 會讓引擎重新接管手勢、`onChanged` 反覆進來，
//    值被反覆相乘（輕輕捏就爆大）並把 App 卡死閃退。
// ② 手勢值當**累積量**：手勢開始時記下 `startZoom`/`startPan`，之後一律用
//    `start * value` 算絕對值（不是累加增量）——這樣第一個取樣就生效、跟手不延遲。
// ③ **`onZoomChange` 只在手勢結束時通知**：如果每次縮放都通知，父層會在捏合進行中
//    改 `scrollDisabled` → 外層 ScrollView 重建 → 手勢被打斷（症狀：第一次捏合卡在一半，
//    第二次才正常）。
// ④ **沒放大時不掛拖曳手勢**（`simultaneousGesture` 給 undefined）：外層 ScrollView
//    才能正常捲動／翻頁；放大後才接管拖曳做平移（父層同時 `scrollDisabled`）。
//
// `contentSize` 給了就用（例：畫廊＝整個 viewport）；沒給就自己量（hug 內容，
// 用 background 的 GeometryReader）——縱向連續的頁高量不到，就是靠這個拿到真實尺寸。

import {
  DragGesture,
  GeometryReader,
  MagnifyGesture,
  VStack,
  ZStack,
  useEffect,
  useMemo,
  useRef,
  useState,
  type VirtualNode,
} from "scripting"

/** 量到尺寸就回報。 */
function SizeReporter({
  size,
  onSize,
}: {
  size: { width: number; height: number }
  onSize: (size: { width: number; height: number }) => void
}) {
  useEffect(() => {
    onSize({ width: size.width, height: size.height })
  }, [size.width, size.height])
  return null
}

export interface ZoomableViewProps {
  children: VirtualNode
  /** 內容在 1× 時的顯示尺寸；不給就自己量（適合高度／寬度由圖片決定的情況）。 */
  contentSize?: { width: number; height: number }
  /** 可用區域（viewport），**只用來算平移夾範圍**，不影響版面；建議都傳。 */
  box?: { width: number; height: number }
  /** 縮放狀態變化（父層用它停用外層捲動）；只會在**手勢結束**時呼叫。 */
  onZoomChange?: (zoomed: boolean) => void
  /** 換頁時把縮放歸零（值變了就重置）。 */
  resetToken?: string | number
  maxZoom?: number
  /** 雙擊放大的倍率（再雙擊一次還原）。 */
  doubleTapZoom?: number
  /** 平移要不要夾在「內容範圍」內；false ＝自由平移（Lazy 畫布量不到真實尺寸時用）。 */
  clampPan?: boolean
}

export function ZoomableView({
  children,
  contentSize,
  box,
  onZoomChange,
  resetToken,
  maxZoom = 5,
  doubleTapZoom = 2.5,
  clampPan: shouldClamp = true,
}: ZoomableViewProps) {
  const [measuredContent, setMeasuredContent] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  // 拖曳手勢要不要掛上：**只在手勢結束時更新**（捏合期間接法必須固定，否則會被引擎重新接管）。
  // 未放大時不掛 → 外層 ScrollView 的捲動／翻頁才不會被擋掉。
  const [dragEnabled, setDragEnabled] = useState(false)
  const latest = useRef({
    zoom: 1,
    pan: { x: 0, y: 0 },
    box: { width: 0, height: 0 },
    content: { width: 0, height: 0 },
    startZoom: 0,
    startPan: { x: 0, y: 0 },
    anchorVector: { x: 0, y: 0 },
    dragging: false,
  })

  const viewport = box ?? { width: 0, height: 0 }
  const content = contentSize ?? measuredContent
  latest.current.box = viewport
  latest.current.content = content

  const clampZoom = (value: number) => Math.min(maxZoom, Math.max(1, value))
  /** 平移夾在「放大後多出來的部分」之內 → 圖片邊緣最多貼齊畫面邊緣，不會拖出空白。 */
  const clampPan = (value: { x: number; y: number }, atZoom: number) => {
    if (!shouldClamp) return value
    const maxX = Math.max(0, (content.width * atZoom - viewport.width) / 2)
    const maxY = Math.max(0, (content.height * atZoom - viewport.height) / 2)
    return { x: Math.min(maxX, Math.max(-maxX, value.x)), y: Math.min(maxY, Math.max(-maxY, value.y)) }
  }

  const commit = (nextZoom: number, nextPan: { x: number; y: number }) => {
    if (Math.abs(nextZoom - latest.current.zoom) > 0.005) {
      latest.current.zoom = nextZoom
      setZoom(nextZoom)
    }
    if (Math.abs(nextPan.x - latest.current.pan.x) > 0.5 || Math.abs(nextPan.y - latest.current.pan.y) > 0.5) {
      latest.current.pan = nextPan
      setPan(nextPan)
    }
  }

  /** 手勢結束／雙擊／重置後才通知父層（見檔頭 ③），順便決定要不要掛拖曳手勢。 */
  const notify = () => {
    const next = latest.current.zoom > 1.001
    setDragEnabled(next)
    onZoomChange?.(next)
  }

  const clearStart = () => {
    latest.current.startZoom = 0
    latest.current.startPan = { x: 0, y: 0 }
    latest.current.anchorVector = { x: 0, y: 0 }
  }

  const reset = () => {
    clearStart()
    commit(1, { x: 0, y: 0 })
    notify()
  }

  useEffect(() => {
    clearStart()
    commit(1, { x: 0, y: 0 })
  }, [resetToken])

  const gestures = useMemo(
    () => ({
      magnify: MagnifyGesture()
        .onChanged(value => {
          // 手勢開始：記下起點與雙指中心錨點向量，之後一律算絕對值（跟手、不漏第一個取樣）。
          if (latest.current.startZoom <= 0) {
            latest.current.startZoom = latest.current.zoom
            latest.current.startPan = latest.current.pan
            // 雙指中心相對於內容正中心的偏移向量（考慮當前已有的平移）
            const cx = (latest.current.box.width || latest.current.content.width) / 2
            const cy = (latest.current.box.height || latest.current.content.height) / 2
            const loc = value.startLocation ?? { x: cx, y: cy }
            latest.current.anchorVector = {
              x: loc.x - cx - latest.current.pan.x,
              y: loc.y - cy - latest.current.pan.y,
            }
          }
          const magnitude = value.magnification > 0 ? value.magnification : 1
          const next = clampZoom(latest.current.startZoom * magnitude)
          const scaleDelta = next / latest.current.startZoom
          // 內容以中心縮放，若要讓雙指中心在放大過程中留在雙指正下方，位移補償為 anchorVector * (1 - scaleDelta)
          const nextPan = clampPan(
            {
              x: latest.current.startPan.x + latest.current.anchorVector.x * (1 - scaleDelta),
              y: latest.current.startPan.y + latest.current.anchorVector.y * (1 - scaleDelta),
            },
            next
          )
          commit(next, nextPan)
        })
        .onEnded(() => {
          clearStart()
          notify()
        }),
      drag: DragGesture()
        .onChanged(value => {
          // 未放大時不平移（手勢仍然掛著：接法固定不變，才不會在捏合途中被引擎重新接管）。
          if (latest.current.zoom <= 1.001) return
          if (!latest.current.dragging) {
            latest.current.dragging = true
            latest.current.startPan = latest.current.pan
          }
          const next = clampPan(
            {
              x: latest.current.startPan.x + value.translation.width,
              y: latest.current.startPan.y + value.translation.height,
            },
            latest.current.zoom
          )
          commit(latest.current.zoom, next)
        })
        .onEnded(() => {
          latest.current.dragging = false
          clearStart()
        }),
    }),
    []
  )

  /** 雙擊：以點到的位置為錨點放大／還原。 */
  const toggleAt = (location: { x: number; y: number }) => {
    if (latest.current.zoom > 1.001) {
      clearStart()
      commit(1, { x: 0, y: 0 })
      notify()
      return
    }
    // 內容置中、以中心縮放。想讓局部點 q（相對中心的位移）留在原地，偏移取 q * (1 - 倍率)。
    const qx = location.x - latest.current.box.width / 2
    const qy = location.y - latest.current.box.height / 2
    const target = doubleTapZoom
    clearStart()
    commit(target, clampPan({ x: qx * (1 - target), y: qy * (1 - target) }, target))
    notify()
  }

  const zoomed = zoom > 1.001
  return (
    <ZStack
      alignment="center"
      gesture={gestures.magnify}
      // 放大時才掛拖曳（dragEnabled 只在手勢結束時翻，捏合途中不會中斷）。
      // 放大時外層捲動已由閱讀器 scrollDisabled 停用，所以用 simultaneous 就夠。
      simultaneousGesture={dragEnabled ? gestures.drag : undefined}
      onTapGesture={{ count: 2, coordinateSpace: "local", perform: toggleAt }}
    >
      <VStack
        alignment="center"
        spacing={0}
        frame={contentSize ? { width: contentSize.width, height: contentSize.height } : undefined}
        // 量不到內容尺寸時（例：頁高由圖片決定）用背景量自己；background 不影響版面。
        background={
          contentSize
            ? undefined
            : <GeometryReader>
                {geometry => (
                  <SizeReporter
                    size={{ width: geometry.size.width, height: geometry.size.height }}
                    onSize={setMeasuredContent}
                  />
                )}
              </GeometryReader>
        }
        // 縮放／平移走繪製層（不改佈局）：捏合時不用每幀重排版。
        scaleEffect={zoom}
        offset={pan}
      >
        {children}
      </VStack>
    </ZStack>
  )
}
