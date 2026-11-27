import { t } from "../i18n"

import { Image, ProgressView, RoundedRectangle, Text, VStack, ZStack, useEffect, useRef, useState, type DynamicShapeStyle } from "scripting"

import { comicLibrary } from "../app/services"
import { PALETTES } from "../app/theme"
import { CoverShadow } from "../design/CoverShadow"
import { coverStroke, fill, radius, rect } from "../design/tokens"
import { getDisplayImage, putDisplayImage } from "../engine/displaycache"

export interface CoverImageProps {
  sourceKey: string
  url?: string
  width: number
  height: number
  mode?: "fill" | "fit"
  cornerRadius?: number
  title?: string
  lifted?: boolean
}

const DISPLAY_SCALE = 3

function fitForFrame(image: UIImage, width: number, height: number): UIImage {
  if (!(width > 0 && height > 0)) return image
  const targetWidth = Math.ceil(width * DISPLAY_SCALE)
  const targetHeight = Math.ceil(height * DISPLAY_SCALE)
  if (image.width <= targetWidth * 1.2 && image.height <= targetHeight * 1.2) return image
  return image.preparingThumbnail({ width: targetWidth, height: targetHeight }) ?? image
}

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

function placeholderPalette(title: string) {
  let hash = 0
  for (let index = 0; index < title.length; index += 1) {
    hash = (hash * 31 + title.charCodeAt(index)) | 0
  }
  return PALETTES[Math.abs(hash) % PALETTES.length]
}

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
  loading?: boolean
}

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
  const [failed, setFailed] = useState(!url)
  const lastUrl = useRef<string | undefined>(url)

  useEffect(() => {
    let alive = true
    setFailed(false)
    if (lastUrl.current !== url) {
      lastUrl.current = url
      setImage(null)
    }

    if (!url) {
      setImage(null)
      setFailed(true)
      return
    }

    void (async () => {
      try {
        const path = await comicLibrary().thumbnailDisplayPath(sourceKey, url)
        if (!alive) return
        const key = `${path}|${Math.round(width)}x${Math.round(height)}|${mode}`
        const cached = getDisplayImage(key)
        if (cached) {
          setImage(cached)
          return
        }
        const decoded = UIImage.fromFile(path)
        if (!decoded) {
          setFailed(true)
          return
        }
        const shaped = mode === "fill" ? cropToAspect(decoded, width / height) : decoded
        const fitted = fitForFrame(shaped, width, height)
        putDisplayImage(key, fitted)
        setImage(fitted)
      } catch {
        if (alive) setFailed(true)
      }
    })()

    return () => {
      alive = false
    }
  }, [url, sourceKey, width, height, mode])

  const body = image ? (
    <ZStack frame={{ width, height }}>
      <Image
        image={image}
        resizable={true}
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

  return lifted ? <CoverShadow cornerRadius={cornerRadius}>{body}</CoverShadow> : body
}
