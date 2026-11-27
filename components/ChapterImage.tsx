import { Button, Canvas, HStack, Image, ProgressView, Text, VStack, useEffect, useState } from "scripting"

import type { ChapterSession, PageRender } from "../app/comic"
import { t } from "../i18n"
import { isAbortError } from "../engine/http"
import { log } from "../engine/log"
import { fitBox, type PageFrame } from "../engine/pagefiles"
import { slotAspect, type SlotHalf } from "../engine/pageslots"

const DEFAULT_ASPECT = 0.7

export interface ChapterImageProps {
  session: ChapterSession
  index: number
  size: PageFrame
  half?: SlotHalf
}

function estimateAspect(session: ChapterSession, index: number): number {
  return session.aspectOf(index - 1) ?? session.aspectOf(index + 1) ?? DEFAULT_ASPECT
}

export function ChapterImage({ session, index, size, half }: ChapterImageProps) {
  const [render, setRender] = useState<PageRender | null>(() => session.renderOf(index, half))
  const [error, setError] = useState("")
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let alive = true
    const started = Date.now()
    const cached = session.renderOf(index, half)
    if (cached) setRender(cached)
    setError("")

    void (async () => {
      try {
        const initial = await session.loadPage(
          index,
          sharpened => {
            if (alive) setRender(sharpened)
          },
          () => !alive,
          size,
          half
        )

        if (!alive) return
        if (!initial) {
          setError(t("common.undecodable"))
          return
        }

        log("debug", "reader", `第 ${index + 1} 頁 mount→圖 ${Date.now() - started}ms`)
        setRender(initial)
      } catch (error) {
        if (isAbortError(error)) return
        log("warning", "reader", `第 ${index + 1} 頁載入失敗`, error)
        if (alive) setError(error instanceof Error ? error.message : String(error))
      }
    })()

    return () => {
      alive = false
    }
  }, [session, index, half, retryKey, size.width, size.height, size.zoom])

  const aspect = render?.aspect ?? session.aspectOf(index) ?? estimateAspect(session, index)
  const box = fitBox(size, slotAspect(aspect, half))

  if (render) {
    return (
      <Canvas
        key={render.path}
        opaque={true}
        frame={{ width: box.width, height: box.height }}
        draw={(ctx, canvas) => {
          if (!half || render.half) {
            ctx.drawImage({ filePath: render.path }, 0, 0, canvas.width, canvas.height)
            return
          }
          ctx.save()
          ctx.beginPath()
          ctx.rect(0, 0, canvas.width, canvas.height)
          ctx.clip()
          const dx = half === "left" ? 0 : -canvas.width
          ctx.drawImage({ filePath: render.path }, dx, 0, canvas.width * 2, canvas.height)
          ctx.restore()
        }}
      />
    )
  }

  return (
    <VStack alignment="center" spacing={12} frame={box}>
      {error ? (
        <VStack alignment="center" spacing={10}>
          <Text foregroundStyle="systemRed" font="caption">
            {t("common.loadFailed", { message: error })}
          </Text>
          <Button
            action={() => setRetryKey(k => k + 1)}
            buttonStyle="bordered"
          >
            <HStack spacing={6}>
              <Image systemName="arrow.clockwise" font="caption2" />
              <Text font="caption2" fontWeight="medium">
                {t("common.retry")}
              </Text>
            </HStack>
          </Button>
        </VStack>
      ) : (
        <ProgressView />
      )}
    </VStack>
  )
}
