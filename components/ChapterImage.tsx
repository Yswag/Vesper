// 章節內文圖片展示元件（純 View）。取圖走 ComicLibrary 的 chapter session（包含漸進式解碼與 AI 超解析度）；
// 畫面只負責把 session 給的「可顯示頁面」（檔案路徑＋比例）畫出來，並在超分完成時透過 onSharpened 回調原地無縫替換。
// 正文圖需要 Referer / Cookie 與解密，且正文不落地（快取在記憶體），皆在 session 內處理完成。
//
// 離線命中時不會問源的圖片解析，所以在飛航模式下（源根本解析不出 URL）也讀得到。
//
// ⚠️ 為什麼用 `Canvas` 而不是 `Image`：`Image` 每顯示一個新的 `UIImage` 就**永久留一份點陣**
// （成本 ∝ 像素：一頁 850×1206 約 4MB，超分後 1700×2412 約 15.6MB），而且卸載不還——
// 連續讀 20 分鐘會爬到 3GB 被系統殺。`Canvas.drawImage({ filePath })` 不會累積
// （實測：`Image` +4.13MB/張 vs Canvas +0.02MB/張，見 dev/probe-display-via.tsx）。
//
// 排版：Canvas 自己算 contain 置中；給了 `size`（畫廊／橫向模式）就塞進那個框，
// 不給就靠 `aspectRatio` 撐出高度（webtoon）。

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

  // 未載入時的佔位尺寸：
  // 1. 若給了完整寬高（畫廊模式）直接吃指定尺寸；
  // 2. 若只給了 height（橫向連續模式）：預設佔位寬度給「高度 × 0.7」或「螢幕寬度的 80%」，
  //    避免 ProgressView 天然 20~30pt 導致 LazyHStack 開場瞬間塞滿幾十頁、狂發並行請求且載完後排版劇烈跳躍；
  // 3. 沒給 size（縱向條漫模式）：預設給 560pt（約螢幕 70% 高），寬度自適應撐滿。
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
