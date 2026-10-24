// 封面「原圖」全螢幕檢視器。從詳情頁的 hero 點一下**推入**（`NavigationLink`）。
//
// 這裡刻意**不裁切**（跟網格／hero 相反）：要看的就是完整封面，連被裁掉的部分也看得到。
// 縮放／平移／雙擊都交給 `components/ZoomableView`（閱讀器的漫畫頁用同一個元件）。
// 用推入而不是 modal：只有推入頁面才會有 zoom 轉場動畫（modal 的 navigationTransition 引擎不觸發）。
//
// 圖走跟 CoverImage 同一條管線（`thumbnailPath`：源解析＋磁碟快取），
// 所以來源的 Referer / modifyImage 都照舊適用。

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
  /** 讓 hero 的 matchedTransitionSource 有東西可配。 */
  zoomTransition?: { sourceID: string | number; namespace: NamespaceID }
}) {
  const [image, setImage] = useState<UIImage | null>(null)
  const [failed, setFailed] = useState(false)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const dismiss = Navigation.useDismiss()

  // 語言一換就重繪（`t()` 讀的是模組層級的當前語言）。
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

  // 以「剛好裝進可用區域」為 1×（fit）。
  const aspect = image && image.height > 0 ? image.width / image.height : 0
  const fitWidth = aspect > 0 && box.width > 0 ? Math.min(box.width, box.height * aspect) : 0
  const fitHeight = aspect > 0 && fitWidth > 0 ? fitWidth / aspect : 0

  return (
    <ZStack
      alignment="topTrailing"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background={fill.canvas}
      // 推入頁面：跟閱讀器一樣把導覽列與 tab bar 都藏起來——全出血看圖時
      // 底部那條 tab bar 會壓在圖片上，也會誤觸換 tab。
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

/** 量到可用區域就回報。 */
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
