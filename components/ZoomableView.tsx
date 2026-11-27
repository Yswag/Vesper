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
  type Point,
  type VirtualNode,
} from "scripting"

export const MAX_ZOOM = 5

const DOUBLE_TAP_WINDOW = 330

const DOUBLE_TAP_ANIMATION = Animation.snappy({ duration: 0.3 })

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
  contentSize?: { width: number; height: number }
  box?: { width: number; height: number }
  onZoomChange?: (zoomed: boolean) => void
  resetToken?: string | number
  maxZoom?: number
  doubleTapZoom?: number
  clampPan?: boolean
  onSingleTap?: (location: Point) => void
}

export function ZoomableView({
  children,
  contentSize,
  box,
  onZoomChange,
  resetToken,
  maxZoom = MAX_ZOOM,
  doubleTapZoom = 2.5,
  clampPan: shouldClamp = true,
  onSingleTap,
}: ZoomableViewProps) {
  const [measuredContent, setMeasuredContent] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
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

  const zoomChangeRef = useRef(onZoomChange)
  zoomChangeRef.current = onZoomChange
  const notify = () => {
    const next = latest.current.zoom > 1.001
    setDragEnabled(next)
    zoomChangeRef.current?.(next)
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

  const singleTapRef = useRef(onSingleTap)
  singleTapRef.current = onSingleTap
  const pendingTap = useRef<number | null>(null)
  const cancelPendingTap = () => {
    if (pendingTap.current === null) return
    clearTimeout(pendingTap.current)
    pendingTap.current = null
  }

  useEffect(() => {
    cancelPendingTap()
    const wasZoomed = latest.current.zoom > 1.001
    clearStart()
    commit(1, { x: 0, y: 0 })
    if (wasZoomed) notify()
  }, [resetToken])

  useEffect(() => () => {
    cancelPendingTap()
    if (latest.current.zoom > 1.001) zoomChangeRef.current?.(false)
  }, [])

  const gestures = useMemo(
    () => ({
      magnify: MagnifyGesture()
        .onChanged(value => {
          if (latest.current.startZoom <= 0) {
            latest.current.startZoom = latest.current.zoom
            latest.current.startPan = latest.current.pan
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

  const animateTo = (nextZoom: number, nextPan: { x: number; y: number }) => {
    latest.current.zoom = nextZoom
    latest.current.pan = nextPan
    void withAnimation(DOUBLE_TAP_ANIMATION, () => {
      setZoom(nextZoom)
      setPan(nextPan)
    })
    notify()
  }

  const toggleAt = (location: { x: number; y: number }) => {
    if (latest.current.zoom > 1.001) {
      clearStart()
      animateTo(1, { x: 0, y: 0 })
      return
    }
    const qx = location.x - latest.current.box.width / 2
    const qy = location.y - latest.current.box.height / 2
    const target = doubleTapZoom
    clearStart()
    animateTo(target, clampPan({ x: qx * (1 - target), y: qy * (1 - target) }, target))
  }

  const handleTap = (location: Point) => {
    if (pendingTap.current !== null) {
      cancelPendingTap()
      toggleAt(location)
      return
    }
    pendingTap.current = setTimeout(() => {
      pendingTap.current = null
      singleTapRef.current?.(location)
    }, DOUBLE_TAP_WINDOW)
  }

  const zoomed = zoom > 1.001
  return (
    <ZStack
      alignment="center"
      gesture={gestures.magnify}
      simultaneousGesture={dragEnabled ? gestures.drag : undefined}
      contentShape={onSingleTap ? "rect" : undefined}
      onTapGesture={
        onSingleTap
          ? { count: 1, coordinateSpace: "local", perform: handleTap }
          : { count: 2, coordinateSpace: "local", perform: toggleAt }
      }
    >
      <VStack
        alignment="center"
        spacing={0}
        frame={contentSize ? { width: contentSize.width, height: contentSize.height } : undefined}
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
        scaleEffect={zoom}
        offset={pan}
      >
        {children}
      </VStack>
    </ZStack>
  )
}
