// 載入中的骨架：尺寸跟載入後的版面一樣，資料來了畫面不會跳。
// 塊＝`fill.surface` 底；字＝一行看不見的字撐住行高，上面疊一條實心灰條。
// 每塊自帶掃光：同時掛上、同一節奏，看起來是整片一起掃。

import {
  Divider,
  GeometryReader,
  HStack,
  Rectangle,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
  useColorScheme,
  useEffect,
  useState,
  type Color,
  type Font,
  type FontWeight,
  type Shape,
} from "scripting"

import { t } from "../i18n"
import { Card } from "./layout"
import { rowSeparatorInset } from "./rows"
import { badgeSize, capsule, cardGap, fill, pageInsets, pageSpacing, radius, rect, rowPadding } from "./tokens"

const SKELETON_TEXT = "XXXX"

/**
 * 掃光：整個螢幕只有一道斜光，從左上掃到右下；每塊只畫它經過自己的那段。
 * 亮帶寬（pt）、傾斜角、速度（pt/秒）、掃完後在畫面外多走的距離（＝停頓）、掛上後多久開始動。
 */
const SHIMMER_BAND = 140
const SHIMMER_ANGLE = 20
const SHIMMER_SPEED = 420
const SHIMMER_REST = 320
const SHIMMER_DELAY_MS = 100
/** 五個色標：中間最亮、兩側慢慢淡出，邊緣才不硬。深色用白光、淺色用灰光（白光在淺灰底上看不到）。 */
const SHIMMER_GLOW: Record<"light" | "dark", { peak: Color; soft: Color; clear: Color }> = {
  light: { peak: "rgba(150,158,168,0.16)", soft: "rgba(150,158,168,0.06)", clear: "rgba(150,158,168,0)" },
  dark: { peak: "rgba(255,255,255,0.14)", soft: "rgba(255,255,255,0.05)", clear: "rgba(255,255,255,0)" },
}

/** 這塊的螢幕中心點：掛上那一刻量到的，之後不跟著變（中途改起訖點會打亂重播）。 */
interface Anchor {
  x: number
  y: number
}

function ShimmerLight({ width, height, anchor }: { width: number; height: number; anchor: Anchor }) {
  const scheme = useColorScheme()
  const [origin] = useState(anchor)
  const [moving, setMoving] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setMoving(true), SHIMMER_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])
  // 光的中心線在螢幕上是 x = X − y·tanθ，X 從「整條光都在左邊外」走到「整條光都在右邊外」再多走一段停頓。
  // 每塊都用同一個 X 換算成自己的位移，所以看起來是同一道光。
  const radians = (SHIMMER_ANGLE * Math.PI) / 180
  const tan = Math.tan(radians)
  const halfBand = SHIMMER_BAND / 2 / Math.cos(radians)
  const start = -halfBand
  const end = Device.screen.width + Device.screen.height * tan + halfBand + SHIMMER_REST
  const shift = origin.x + origin.y * tan
  const glow = SHIMMER_GLOW[scheme === "dark" ? "dark" : "light"]
  return (
    <ZStack frame={{ width, height }}>
      <Rectangle
        fill={{
          stops: [
            { color: glow.clear, location: 0 },
            { color: glow.soft, location: 0.3 },
            { color: glow.peak, location: 0.5 },
            { color: glow.soft, location: 0.7 },
            { color: glow.clear, location: 1 },
          ],
          startPoint: "leading",
          endPoint: "trailing",
        }}
        // 斜著的亮帶要長到上下緣都碰不到它的端點。
        frame={{ width: SHIMMER_BAND, height: (height + SHIMMER_BAND) / Math.cos(radians) }}
        rotationEffect={SHIMMER_ANGLE}
        offset={{ x: (moving ? end : start) - shift, y: 0 }}
        animation={{
          animation: Animation.linear((end - start) / SHIMMER_SPEED).repeatForever(false),
          value: moving,
        }}
      />
    </ZStack>
  )
}

/** 疊在骨架上的掃光，用骨架同一個形狀裁切。尺寸變了就重建。 */
function ShimmerOverlay({ shape }: { shape: Shape }) {
  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} clipShape={shape} clipped={true}>
      <GeometryReader coordinateSpaces={["global"]}>
        {geometry => {
          const frame = geometry.frame("global")
          return (
            <ShimmerLight
              key={`${geometry.size.width}x${geometry.size.height}`}
              width={geometry.size.width}
              height={geometry.size.height}
              anchor={{ x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }}
            />
          )
        }}
      </GeometryReader>
    </ZStack>
  )
}

/** 一塊灰底。`shape` 預設跟封面同一級圓角；`bar` 是字條（小圓角、比封面亮一階）。 */
export function SkeletonBlock({
  width,
  height,
  shape = "rect",
}: {
  width?: number
  height: number
  shape?: "rect" | "capsule" | "bar"
}) {
  const clip = shape === "capsule" ? capsule("circular") : rect(shape === "bar" ? radius.sm : radius.md)
  return (
    <VStack
      frame={width === undefined ? { maxWidth: "infinity", height } : { width, height }}
      background={shape === "bar" ? fill.chip : fill.surface}
      clipShape={clip}
      overlay={<ShimmerOverlay shape={clip} />}
    />
  )
}

/** 灰條占行高的比例；多行時最後一條的長度（像真的段落收尾）。 */
const BAR_HEIGHT_RATIO = 0.6
const LAST_LINE_RATIO = 0.6

/**
 * 一行灰條字：字級與真的那行一樣，高度就一樣。`length` 是字數的倍數（越長灰條越寬，受外框限制）。
 * `lineLimit` > 1 時拆成幾條單行、撑滿寬，最後一條較短。
 */
export function SkeletonText({
  font,
  fontWeight,
  lineLimit = 1,
  length = 3,
}: {
  font: Font
  fontWeight?: FontWeight
  lineLimit?: number
  length?: number
}) {
  const multiline = lineLimit > 1
  // 不用 redacted 的灰條：它是半透明的，掃光只能靠遮罩，光會被壓到幾乎看不到。
  return (
    <VStack alignment="leading" spacing={0} frame={multiline ? { maxWidth: "infinity", alignment: "leading" } : undefined}>
      {Array.from({ length: lineLimit }, (_, index) => {
        const ratio = multiline && index === lineLimit - 1 ? LAST_LINE_RATIO : 1
        return (
          <Text
            key={index}
            font={font}
            fontWeight={fontWeight}
            lineLimit={1}
            foregroundStyle="clear"
            frame={multiline ? { maxWidth: "infinity", alignment: "leading" } : undefined}
            overlay={
              <GeometryReader>
                {geometry => (
                  <ZStack
                    alignment="leading"
                    frame={{ width: geometry.size.width, height: geometry.size.height, alignment: "leading" }}
                  >
                    <SkeletonBlock
                      width={Math.round(geometry.size.width * ratio)}
                      height={Math.round(geometry.size.height * BAR_HEIGHT_RATIO)}
                      shape="bar"
                    />
                  </ZStack>
                )}
              </GeometryReader>
            }
          >
            {SKELETON_TEXT.repeat(length)}
          </Text>
        )
      })}
    </VStack>
  )
}

/** 橫向卡片排：封面塊＋一行書名，跟真的卡片同尺寸。 */
export function SkeletonCardRow({
  size,
  titleFont = "caption",
  count = 4,
  accessibilityLabel = t("common.loading"),
}: {
  size: { width: number; height: number }
  titleFont?: Font
  count?: number
  accessibilityLabel?: string
}) {
  return (
    <ScrollView axes="horizontal" scrollDisabled={true} scrollIndicator="hidden">
      <HStack spacing={12} padding={{ horizontal: pageInsets.horizontal, vertical: 8 }} accessibilityLabel={accessibilityLabel}>
        {Array.from({ length: count }, (_, index) => (
          <VStack key={index} alignment="leading" spacing={6} frame={{ width: size.width }}>
            <SkeletonBlock width={size.width} height={size.height} />
            <SkeletonText font={titleFont} fontWeight="medium" length={2} />
          </VStack>
        ))}
      </HStack>
    </ScrollView>
  )
}

/** 設定類頁面：幾組「小標題＋卡片」，每列跟 `IconRow` 同尺寸。`groups` 是每組的列數。 */
export function SkeletonCardGroups({ groups = [2, 3] }: { groups?: number[] }) {
  return (
    <VStack spacing={pageSpacing} frame={{ maxWidth: "infinity" }} accessibilityLabel={t("common.loading")}>
      {groups.map((rows, group) => (
        <VStack key={group} alignment="leading" spacing={cardGap} frame={{ maxWidth: "infinity" }}>
          <HStack padding={{ leading: 4 }}>
            <SkeletonText font="footnote" length={2} />
          </HStack>
          <Card>
            {Array.from({ length: rows }, (_, row) => (
              <VStack key={row} spacing={0} frame={{ maxWidth: "infinity" }}>
                {row > 0 ? <Divider padding={{ leading: rowSeparatorInset }} /> : null}
                <HStack spacing={14} padding={rowPadding} alignment="center" frame={{ maxWidth: "infinity" }}>
                  <SkeletonBlock width={badgeSize} height={badgeSize} />
                  <SkeletonText font="body" length={2} />
                  <Spacer />
                </HStack>
              </VStack>
            ))}
          </Card>
        </VStack>
      ))}
    </VStack>
  )
}

/** 封面在左、文字在右的一列。`lines` 是右側每行的字級。 */
export function SkeletonListRow({
  cover,
  lines,
  height,
}: {
  cover: { width: number; height: number }
  lines: Font[]
  height?: number
}) {
  return (
    <HStack
      spacing={12}
      alignment="top"
      padding={{ horizontal: pageInsets.horizontal }}
      frame={{ maxWidth: "infinity", height, alignment: "top" }}
    >
      <SkeletonBlock width={cover.width} height={cover.height} />
      <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        {lines.map((font, index) => (
          <SkeletonText key={index} font={font} />
        ))}
      </VStack>
    </HStack>
  )
}
