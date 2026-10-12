// 章節內文圖片。取圖走 ComicLibrary 的 chapter session（離線 → 記憶體 LRU → 網路）；
// session 已經把源與離線鍵收在裡面，畫面只認「第幾頁」與回來的位元組。
// 正文圖幾乎都需要 Referer / Cookie，而且 onResponse 的解密也在這條路上，所以不能走 <Image imageUrl>；
// 正文也不落地（記憶體快取），所以是 fromData 而不是 fromFile。
//
// 離線命中時不會問源的圖片解析，所以在飛航模式下（源根本解析不出 URL）也讀得到。
//
// 排版：讀出 UIImage 的真實長寬，用 aspectRatio 讓它「撐滿寬度、高度按比例」——
// 長條型的跨頁圖才不會被壓扁，也不會用原始像素爆版。
// 給了 `size`（閱讀器的畫廊／橫向模式）就以 `fit` 置中塞進那個框。

import { Image, ProgressView, Text, VStack, useEffect, useState } from "scripting"

import type { ChapterSession } from "../app/comic"
import { t } from "../i18n"
import { isAbortError } from "../engine/http"
import { log } from "../engine/log"
import { sharpenImage } from "../engine/upscale"
import { getReaderSettings } from "../library/readerSettings"

export interface ChapterImageProps {
  session: ChapterSession
  /** 章節識別碼（避免跨章節換話時快取或狀態串音）。 */
  chapterId?: string
  /** 這一張在章節裡的頁索引（＝閱讀器的頁碼）。 */
  index: number
  /**
   * 指定圖片的顯示框（點）。給了就以 `fit` 方式置中塞進這個框（只給 height 就是「以高度為準」）；
   * 不給＝撐滿可用寬度、高度按比例（webtoon）。
   */
  size?: { width?: number; height?: number }
}

export function ChapterImage({ session, chapterId = "default", index, size }: ChapterImageProps) {
  const [image, setImage] = useState<UIImage | null>(null)
  const [aspect, setAspect] = useState<number | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let alive = true
    // 量測：mount → 圖交出去（debug，不落地；連翻 10 頁時在 LogScreen 看這一行）。
    // **這個數字不含光柵化**：`UIImage.fromData` 與 `fromFile` 一樣是惰性的，真正的解碼（實測 5–42ms）
    // 落在第一次繪製。所以 0ms ＝「位元組早就備好、元件沒在等網路」，不是「眼睛看到圖的時間」。
    const started = Date.now()
    setImage(null)
    setAspect(null)
    setError("")

    void (async () => {
      try {
        const bytes = await session.pageImage(index)
        if (!alive) return
        const data = Data.fromUint8Array(bytes)
        const decoded = data ? UIImage.fromData(data) : null
        if (!decoded) {
          setError(t("common.undecodable"))
          return
        }
        log("debug", "reader", `第 ${index + 1} 頁 mount→圖 ${Date.now() - started}ms`)
        setAspect(decoded.width / decoded.height)
        setImage(decoded)

        // 漸進式增強：若使用者開啟硬體加速超分，原圖先見，背後執行 ACNet ONNX 超分後原地替換
        // 注意：絕對不能改變 aspect（寬高比），否則 LazyVStack 在重新排版時會導致捲動位置跳躍錯位！
        const settings = getReaderSettings()
        if (settings.hardwareSharpen && data) {
          // 若原始圖片已經很大（寬度或高度大於 1920），再 2x 放大將產出超過 4K 的巨型紋理，
          // 會迅速耗盡 iOS GPU 顯存配額導致黑圖崩潰；此時保持原圖高清輸出即可
          const isTooLargeForUpscale = decoded.width >= 1920 || decoded.height >= 2560
          if (!isTooLargeForUpscale) {
            const pageKey = `${chapterId}_p${index}`
            const t0 = Date.now()
            void sharpenImage(pageKey, data).then(result => {
              if (alive && result) {
                const costMs = Date.now() - t0
                setImage(result.image)
                if (result.fromCache) {
                  log("debug", "upscale", `第 ${index + 1} 頁 ACNet ONNX [快取命中]，0ms 直接顯示`)
                } else {
                  log("info", "upscale", `第 ${index + 1} 頁 ACNet ONNX 超分完成，耗時 ${costMs}ms`)
                }
              }
            })
          }
        }
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
  }, [session, chapterId, index])

  if (image && aspect) {
    return (
      <Image
        image={image}
        resizable={true}
        aspectRatio={{ value: aspect, contentMode: "fit" }}
        frame={size ? { width: size.width, height: size.height } : undefined}
      />
    )
  }

  // 未載入時的佔位高度：
  // 如果給了 size（畫廊/橫向）吃指定高度；沒給（縱向條漫）預設給 560pt（約螢幕 70% 高），
  // 避免 160pt 導致 LazyVStack 開場一口氣塞進 5~6 個載入中並同時並行發起大圖網路與超分請求。
  const placeholderHeight = size?.height ?? 560

  return (
    <VStack alignment="center" spacing={6} frame={{ height: placeholderHeight }}>
      {error ? (
        <Text foregroundStyle="systemRed" font="caption">
          {t("common.loadFailed", { message: error })}
        </Text>
      ) : (
        <ProgressView />
      )}
    </VStack>
  )
}
