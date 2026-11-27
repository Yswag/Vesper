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
  useEffect,
  useState,
  type Color,
  type Font,
  type FontWeight,
  type Shape,
} from "scripting"

import { useResolvedColorScheme } from "../app/theme"
import { t } from "../i18n"
import { Card } from "./layout"
import { rowSeparatorInset } from "./rows"
import { badgeSize, capsule, cardGap, fill, pageInsets, pageSpacing, radius, rect, rowPadding } from "./tokens"

const SKELETON_TEXT = "XXXX"

const SHIMMER_BAND = 140
const SHIMMER_ANGLE = 20
const SHIMMER_SPEED = 420
const SHIMMER_REST = 320
const SHIMMER_DELAY_MS = 100
const SHIMMER_GLOW: Record<"light" | "dark", { peak: Color; soft: Color; clear: Color }> = {
  light: { peak: "rgba(150,158,168,0.16)", soft: "rgba(150,158,168,0.06)", clear: "rgba(150,158,168,0)" },
  dark: { peak: "rgba(255,255,255,0.14)", soft: "rgba(255,255,255,0.05)", clear: "rgba(255,255,255,0)" },
}

interface Anchor {
  x: number
  y: number
}

function ShimmerLight({ width, height, anchor }: { width: number; height: number; anchor: Anchor }) {
  const scheme = useResolvedColorScheme()
  const [moving, setMoving] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setMoving(true), SHIMMER_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])
  const radians = (SHIMMER_ANGLE * Math.PI) / 180
  const tan = Math.tan(radians)
  const halfBand = SHIMMER_BAND / 2 / Math.cos(radians)
  const start = -halfBand
  const end = Device.screen.width + Device.screen.height * tan + halfBand + SHIMMER_REST
  const shift = anchor.x + anchor.y * tan
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

function ShimmerOverlay({ shape }: { shape: Shape }) {
  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} clipShape={shape} clipped={true}>
      <GeometryReader coordinateSpaces={["global"]}>
        {geometry => {
          const frame = geometry.frame("global")
          return (
            <ShimmerLight
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
    <Rectangle
      fill={shape === "bar" ? fill.chip : fill.surface}
      frame={width === undefined ? { maxWidth: "infinity", height } : { width, height }}
      clipShape={clip}
      overlay={<ShimmerOverlay shape={clip} />}
    />
  )
}

const BAR_HEIGHT_RATIO = 0.6
const LAST_LINE_RATIO = 0.6

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

export function SkeletonCardRow({
  size,
  lines = ["caption"],
  count = 4,
  accessibilityLabel = t("common.loading"),
}: {
  size: { width: number; height: number }
  lines?: Font[]
  count?: number
  accessibilityLabel?: string
}) {
  return (
    <ScrollView axes="horizontal" scrollDisabled={true} scrollIndicator="hidden">
      <HStack spacing={12} padding={{ horizontal: pageInsets.horizontal, vertical: 8 }} accessibilityLabel={accessibilityLabel}>
        {Array.from({ length: count }, (_, index) => (
          <VStack key={index} alignment="leading" spacing={6} frame={{ width: size.width }}>
            <SkeletonBlock width={size.width} height={size.height} />
            <VStack alignment="leading" spacing={1} frame={{ width: size.width, alignment: "leading" }}>
              {lines.map((font, line) => (
                <SkeletonText
                  key={line}
                  font={font}
                  fontWeight={line === 0 ? "medium" : undefined}
                  length={line === 0 ? 2 : 1}
                />
              ))}
            </VStack>
          </VStack>
        ))}
      </HStack>
    </ScrollView>
  )
}

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
