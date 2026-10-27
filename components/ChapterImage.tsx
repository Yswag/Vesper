// 章節正文圖片渲染元件：透過 ChapterSession 加載原圖與漸進式超分替換。
// 採用 Canvas.drawImage 配合暫存路徑繪製，避免 Image 組件常駐累積 UIImage 點陣記憶體。
// 尺寸先由「這一頁的寬高比」算好才排版：比例存在 session 上，解碼過的頁重掛時不必再等一次。

import { Button, Canvas, HStack, Image, ProgressView, Text, VStack, useEffect, useState } from "scripting"

import type { ChapterSession, PageRender } from "../app/comic"
import { t } from "../i18n"
import { isAbortError } from "../engine/http"
import { log } from "../engine/log"

/** 連鄰頁都還沒量到比例時的估計值（直式漫畫常見比例）。 */
const DEFAULT_ASPECT = 0.7

export interface ChapterImageProps {
  session: ChapterSession
  /** 這一張在章節裡的頁索引（＝閱讀器的頁碼）。 */
  index: number
  /**
   * 可用的顯示框（點）。只給 `width`＝以寬為準（條漫）；只給 `height`＝以高為準（橫向）；
   * 兩者都給＝contain 置中。圖實際佔的框由 `fitBox` 依比例算出。
   */
  size: { width?: number; height?: number }
}

/** 在框裡以 contain 放入 `aspect`（寬/高）的圖；只約束一邊時，另一邊按比例長。 */
export function fitBox(size: { width?: number; height?: number }, aspect: number): { width: number; height: number } {
  if (size.width !== undefined && size.height !== undefined) {
    const width = Math.min(size.width, size.height * aspect)
    return { width, height: width / aspect }
  }
  if (size.width !== undefined) return { width: size.width, height: size.width / aspect }
  if (size.height !== undefined) return { width: size.height * aspect, height: size.height }
  return { width: 0, height: 0 }
}

/**
 * 還沒量到這一頁時的比例：先借前後頁（同一話通常同尺寸），再退預設值。
 * 這比給一個固定高度準得多——估計誤差從「幾百點」縮到「幾十點」。
 */
function estimateAspect(session: ChapterSession, index: number): number {
  return session.aspectOf(index - 1) ?? session.aspectOf(index + 1) ?? DEFAULT_ASPECT
}

export function ChapterImage({ session, index, size }: ChapterImageProps) {
  const [render, setRender] = useState<PageRender | null>(null)
  const [error, setError] = useState("")
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let alive = true
    const started = Date.now()
    setRender(null)
    setError("")

    void (async () => {
      try {
        const initial = await session.loadPage(
          index,
          sharpened => {
            if (alive) setRender(sharpened)
          },
          () => !alive
        )

        if (!alive) return
        if (!initial) {
          setError(t("common.undecodable"))
          return
        }

        log("debug", "reader", `第 ${index + 1} 頁 mount→圖 ${Date.now() - started}ms`)
        setRender(initial)
      } catch (error) {
        // 換話／離開閱讀器造成的取消是正常結束，不要顯示成「載入失敗：AbortError」。
        if (isAbortError(error)) return
        // 顯示路徑失敗要看得見（LogScreen）：這是使用者當下真的要的那一頁。
        log("warning", "reader", `第 ${index + 1} 頁載入失敗`, error)
        if (alive) setError(error instanceof Error ? error.message : String(error))
      }
    })()

    return () => {
      alive = false
    }
  }, [session, index, retryKey])

  // 比例：這一頁解碼過就用真值，否則借鄰頁。整個框在 render 期間就決定，不等圖到。
  const aspect = render?.aspect ?? session.aspectOf(index) ?? estimateAspect(session, index)
  const box = fitBox(size, aspect)

  if (render) {
    return (
      <Canvas
        // 每次換圖（原圖→超分圖）路徑都不同，key 讓 Canvas 真的重畫。
        key={render.path}
        opaque={true}
        frame={{ width: box.width, height: box.height }}
        draw={(ctx, canvas) => {
          // 框本身已經是 contain 後的形狀，這裡只負責填滿。
          ctx.drawImage({ filePath: render.path }, 0, 0, canvas.width, canvas.height)
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
