import { GeometryReader, Image, Navigation, Text, VStack, ZStack, useEffect, useState } from "scripting"

import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { ZoomableView } from "../../components/ZoomableView"
import { fill, neutral } from "../../design/tokens"

export function CoverViewerScreen({
  sourceKey,
  url,
  title,
  zoomTransition,
}: {
  sourceKey: string
  url?: string
  title?: string
  zoomTransition?: { sourceID: string | number; namespace: NamespaceID }
}) {
  const [image, setImage] = useState<UIImage | null>(null)
  const [failed, setFailed] = useState(false)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const dismiss = Navigation.useDismiss()

  useSubscription(subscribeLocale)

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
        if (decoded) setImage(decoded)
        else setFailed(true)
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [sourceKey, url])

  const aspect = image && image.height > 0 ? image.width / image.height : 0
  const fitWidth = aspect > 0 && box.width > 0 ? Math.min(box.width, box.height * aspect) : 0
  const fitHeight = aspect > 0 && fitWidth > 0 ? fitWidth / aspect : 0

  return (
    <ZStack
      alignment="topTrailing"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background={fill.canvas}
      navigationBarVisibility="hidden"
      tabBarVisibility="hidden"
      navigationTransition={zoomTransition ? { type: "zoom", ...zoomTransition } : undefined}
    >
      <GeometryReader>
        {geometry => (
          <SizeBox size={{ width: geometry.size.width, height: geometry.size.height }} onSize={setBox} />
        )}
      </GeometryReader>

      {image && fitWidth > 0 ? (
        <ZoomableView contentSize={{ width: fitWidth, height: fitHeight }} box={box}>
          <Image
            image={image}
            resizable={true}
            aspectRatio={{ contentMode: "fit" }}
            frame={{ width: fitWidth, height: fitHeight }}
          />
        </ZoomableView>
      ) : (
        <VStack alignment="center" spacing={8} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
          <Text font="body" foregroundStyle={neutral.secondary}>{failed ? t("detail.coverFailed") : t("common.loading")}</Text>
          {title ? <Text font="caption2" foregroundStyle={neutral.tertiary}>{title}</Text> : null}
        </VStack>
      )}

      <Text font="title2" foregroundStyle="white" padding={{ top: 14, trailing: 20 }} onTapGesture={dismiss}>
        {"✕"}
      </Text>
    </ZStack>
  )
}

function SizeBox({
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
