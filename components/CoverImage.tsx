// 封面/縮圖。走圖片管線（自己抓位元組 → 本地檔案 → <Image>），
// 因為 <Image imageUrl> 不能帶 Referer，漫畫站的圖會裂。
//
// 三個關鍵：
// ① <Image> 是照「原始像素」畫的，一定要 resizable + frame；
// ② **絕對不能用 aspectRatio(fill)**：它會照原比例畫出比 frame 大很多的圖（例：格子 120×174、
//    橫式封面 1000×395 → 實際畫成 440pt 寬），外溢的繪製區會蓋到鄰格、把鄰居的點擊搶走
//    （實測：網格第一格會開到第二本；clipped／background／scaleEffect 都攔不住）。
//    所以 mode="fill" 改成**先把圖中心裁成格子的比例**（UIImage.croppedTo）再用 fit 畫；
// ③ 詳情頁想看完整封面就用 mode="fit"（不裁，可能留白）。
//
// 源的縮圖解析（Referer、modifyImage）與磁碟快取都在 ComicLibrary 後面，
// 這裡只認來源鍵與網址。

import { t } from "../i18n"

import { Image, RoundedRectangle, Text, VStack, ZStack, useEffect, useState } from "scripting"

import { comicLibrary } from "../app/services"
import { coverStroke, fill, radius, rect } from "../design/tokens"

export interface CoverImageProps {
  /** 哪個來源的圖（快取鍵與 Referer 都由它決定）。 */
  sourceKey: string
  url?: string
  width: number
  height: number
  /** fill（預設）＝填滿並裁切（會先把圖裁成格子比例，見上方說明）；fit＝完整顯示，可能留白。 */
  mode?: "fill" | "fit"
  cornerRadius?: number
}

/** 把圖**中心裁**成目標寬高比：填滿格子唯一的正確做法（用 aspectRatio(fill) 會外溢去搶鄰居的點擊）。 */
function cropToAspect(image: UIImage, ratio: number): UIImage {
  const sourceRatio = image.width / image.height
  if (!(ratio > 0) || !(sourceRatio > 0) || Math.abs(sourceRatio - ratio) < 0.01) return image
  if (sourceRatio > ratio) {
    const width = image.height * ratio
    return image.croppedTo({ x: (image.width - width) / 2, y: 0, width, height: image.height }) ?? image
  }
  const height = image.width / ratio
  return image.croppedTo({ x: 0, y: (image.height - height) / 2, width: image.width, height }) ?? image
}

export function CoverImage({
  sourceKey,
  url,
  width,
  height,
  mode = "fill",
  cornerRadius = radius.thumb,
}: CoverImageProps) {
  const [image, setImage] = useState<UIImage | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setFailed(false)
    setImage(null)

    if (!url) {
      setFailed(true)
      return
    }

    void (async () => {
      try {
        const path = await comicLibrary().thumbnailPath(sourceKey, url)
        if (!alive) return
        const decoded = UIImage.fromFile(path)
        if (decoded) setImage(mode === "fill" ? cropToAspect(decoded, width / height) : decoded)
        else setFailed(true)
      } catch {
        if (alive) setFailed(true)
      }
    })()

    return () => {
      alive = false
    }
  }, [url, sourceKey, mode, width, height])

  if (image) {
    return (
      <ZStack frame={{ width, height }}>
        <Image
          image={image}
          resizable={true}
          // 一律 fit：mode="fill" 的圖已經先裁成格子比例了，fit 剛好填滿又不會外溢。
          aspectRatio={{ contentMode: "fit" }}
          frame={{ width, height }}
          clipShape={rect(cornerRadius)}
        />
        <RoundedRectangle cornerRadius={cornerRadius} stroke={coverStroke} frame={{ width, height }} />
      </ZStack>
    )
  }

  return (
    <ZStack frame={{ width, height }}>
      <VStack
        alignment="center"
        spacing={0}
        frame={{ width, height }}
        background={fill.surface}
        clipShape={rect(cornerRadius)}
      >
        <Text foregroundStyle="tertiaryLabel" font="caption2">
          {failed ? t("common.noCover") : "…"}
        </Text>
      </VStack>
      <RoundedRectangle cornerRadius={cornerRadius} stroke={coverStroke} frame={{ width, height }} />
    </ZStack>
  )
}
