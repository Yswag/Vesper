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

export interface ChapterImageProps {
  session: ChapterSession
  /** 這一張在章節裡的頁索引（＝閱讀器的頁碼）。 */
  index: number
  /**
   * 指定圖片的顯示框（點）。給了就以 `fit` 方式置中塞進這個框（只給 height 就是「以高度為準」）；
   * 不給＝撐滿可用寬度、高度按比例（webtoon）。
   */
  size?: { width?: number; height?: number }
}

export function ChapterImage({ session, index, size }: ChapterImageProps) {
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
  }, [session, index])

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

  return (
    <VStack alignment="center" spacing={6} frame={{ height: 160 }}>
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
