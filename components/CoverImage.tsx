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

import { Image, ProgressView, RoundedRectangle, Text, VStack, ZStack, useEffect, useState, type DynamicShapeStyle } from "scripting"

import { comicLibrary } from "../app/services"
import { PALETTES } from "../app/theme"
import { CoverShadow } from "../design/CoverShadow"
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
  /** 沒圖時挑佔位色盤並顯示首字（同標題永遠同色）。 */
  title?: string
  /** 加上投影。只留在圖片這層：加到含角標的容器上，角標也會被投一份影。 */
  lifted?: boolean
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

/** 佔位色盤的選擇：同一個標題永遠落到同一盤（跨啟動、跨裝置都一樣，因為只吃字串）。 */
function placeholderPalette(title: string) {
  let hash = 0
  for (let index = 0; index < title.length; index += 1) {
    hash = (hash * 31 + title.charCodeAt(index)) | 0
  }
  return PALETTES[Math.abs(hash) % PALETTES.length]
}

/** 佔位底：色盤的 accent → mid 斜向漸層，深淺各取該模式的值。 */
function placeholderBackground(title: string): DynamicShapeStyle {
  const tone = placeholderPalette(title)
  return {
    dark: { colors: [tone.dark.accent, tone.dark.mid], startPoint: "topLeading", endPoint: "bottomTrailing" },
    light: { colors: [tone.light.accent, tone.light.mid], startPoint: "topLeading", endPoint: "bottomTrailing" },
  }
}

export interface CoverPlaceholderProps {
  title?: string
  width: number
  height: number
  cornerRadius?: number
  /** true＝載入中（surface 底＋小轉圈）；false＝沒圖／失敗（色盤漸層＋首字）。 */
  loading?: boolean
}

/** 沒有圖時的樣子。也給藝廊直接畫「載入中」那排（不必真的去跑一次圖片管線）。 */
export function CoverPlaceholder({
  title,
  width,
  height,
  cornerRadius = radius.md,
  loading = false,
}: CoverPlaceholderProps) {
  const trimmed = (title ?? "").trim()
  const initial = Array.from(trimmed)[0] ?? ""

  return (
    <ZStack frame={{ width, height }}>
      {loading ? (
        <VStack
          alignment="center"
          spacing={0}
          frame={{ width, height }}
          background={fill.surface}
          clipShape={rect(cornerRadius)}
        >
          <ProgressView controlSize="small" />
        </VStack>
      ) : (
        <VStack
          alignment="center"
          spacing={0}
          frame={{ width, height }}
          background={placeholderBackground(trimmed)}
          clipShape={rect(cornerRadius)}
        >
          {initial ? (
            <Text
              font={width < 60 ? "headline" : "title3"}
              fontWeight="bold"
              foregroundStyle="label"
              lineLimit={1}
            >
              {initial}
            </Text>
          ) : (
            <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
              {t("common.noCover")}
            </Text>
          )}
        </VStack>
      )}
      <RoundedRectangle cornerRadius={cornerRadius} stroke={coverStroke} frame={{ width, height }} />
    </ZStack>
  )
}

export function CoverImage({
  sourceKey,
  url,
  width,
  height,
  mode = "fill",
  cornerRadius = radius.md,
  title,
  lifted = false,
}: CoverImageProps) {
  const [image, setImage] = useState<UIImage | null>(null)
  // 沒給網址就是「沒有圖」：第一帧直接畫佔位，不要先轉一圈才變成佔位。
  const [failed, setFailed] = useState(!url)

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

  const body = image ? (
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
  ) : (
    <ZStack frame={{ width, height }}>
      <CoverPlaceholder
        title={title}
        width={width}
        height={height}
        cornerRadius={cornerRadius}
        loading={!failed}
      />
    </ZStack>
  )

  return lifted ? <CoverShadow>{body}</CoverShadow> : body
}
