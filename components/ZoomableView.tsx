// 可縮放內容容器：支援捏合縮放（1–maxZoom）、雙擊錨點縮放與放大後平移拖曳。
//
// 手勢實作防護原則：
// 1. 手勢物件以 useMemo 保持單一實例，回調透過 useRef 讀取最新狀態，防範重複宣告引發崩潰。
// 2. 縮放與平移採累積量絕對值計算，提升跟手流暢度。
// 3. onZoomChange 僅在手勢結束（onEnded）時觸發，防範進行中改變父層捲動屬性導致手勢中斷。
// 4. 未放大狀態不掛載拖曳手勢，避免阻斷外層 ScrollView 滑動與翻頁。

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
  // 拖曳手勢掛載狀態：僅在手勢結束時更新；未放大時不掛載以保留外層 ScrollView 捲動能力
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
  /** 將平移量限制在溢出邊界內，防止拖出內容空白區域。 */
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
