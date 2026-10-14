// 章節正文圖片渲染元件：透過 ChapterSession 加載原圖與漸進式超分替換。
// 採用 Canvas.drawImage 配合暫存路徑繪製，避免 Image 組件常駐累積 UIImage 點陣記憶體。
// 排版支援畫廊/橫向 contain 模式與縱向自適應模式。

import { Button, Canvas, HStack, Image, ProgressView, Text, VStack, useEffect, useState } from "scripting"

import type { ChapterSession, PageRender } from "../app/comic"
import { t } from "../i18n"
import { isAbortError } from "../engine/http"
import { log } from "../engine/log"

export interface ChapterImageProps {
  session: ChapterSession
  /** 這一張在章節裡的頁索引（＝閱讀器的頁碼）。 */
  index: number
  /**
   * 指定圖片的顯示框（點）。給了就以 `contain` 方式置中塞進這個框（只給 height 就是「以高度為準」）；
   * 不給＝撐滿可用寬度、高度按比例（webtoon）。
   */
  size?: { width?: number; height?: number }
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

  if (render) {
    return (
      <Canvas
        // 每次換圖（原圖→超分圖）路徑都不同，key 讓 Canvas 真的重畫。
        key={render.path}
        opaque={true}
        draw={(ctx, canvas) => {
          // contain：等比塞進 Canvas 的框並置中。
          const fitWidth = Math.min(canvas.width, canvas.height * render.aspect)
          const fitHeight = fitWidth / render.aspect
          ctx.drawImage(
            { filePath: render.path },
            (canvas.width - fitWidth) / 2,
            (canvas.height - fitHeight) / 2,
            fitWidth,
            fitHeight
          )
        }}
        aspectRatio={{ value: render.aspect, contentMode: "fit" }}
        frame={size ? { width: size.width, height: size.height } : undefined}
      />
    )
  }

  // 未載入時的佔位尺寸：依畫廊、橫向連續（預設 0.7 比例）或縱向模式（預設 560pt）設定合適外框，防範骨架過小引發排版抖動
  const placeholderHeight = size?.height ?? 560
  const placeholderWidth = size?.width ?? (size?.height ? Math.round(size.height * 0.7) : undefined)

  return (
    <VStack
      alignment="center"
      spacing={12}
      frame={{
        height: placeholderHeight,
        width: placeholderWidth,
      }}
    >
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
