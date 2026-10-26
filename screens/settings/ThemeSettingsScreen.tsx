// 外觀主題設定頁：構圖 × 顏色兩軸選擇。
// 由 SettingsScreen 導覽進入。

import { Circle, ColorPicker, Divider, HStack, Image, ScrollView, ScrollViewReader, Spacer, Text, VStack, ZStack, useEffect, useRef, type Color, type ScrollViewProxy } from "scripting"

import {
  COMPOSITIONS,
  PALETTES,
  PaletteDot,
  buildCustomPalette,
  getCustomColor,
  setComposition,
  setCustomColor,
  setPalette,
  useThemeChoice,
  useTint,
  type Composition,
  type Palette,
} from "../../app/theme"
import { useSubscription } from "../../app/useSubscription"
import { CardGroup, PageScroll } from "../../design/layout"
import { rowSeparatorInset } from "../../design/rows"
import { Footnote } from "../../design/text"
import { dotStroke, rowPadding } from "../../design/tokens"
import { subscribe as subscribeLocale, t } from "../../i18n"

export function ThemeSettingsScreen() {
  // 這一頁的每一個名字（構圖／色盤）都在字典裡：語言換了要跟著重繪。
  useSubscription(subscribeLocale)
  const choice = useThemeChoice()
  const paletteProxy = useRef<ScrollViewProxy>()
  const selectedPaletteKey = choice.palette === "custom" ? "palette:custom" : `palette:${choice.palette}`

  // 進頁時把選中的色盤捲進視野：色盤列比畫面寬，預設位置看不到選中項。
  useEffect(() => {
    const proxy = paletteProxy.current
    if (!proxy) return
    const timer = setTimeout(() => proxy.scrollTo(selectedPaletteKey, "center"), 0)
    return () => clearTimeout(timer)
  }, [])

  return (
    <PageScroll title={t("settings.root.appearance")}>
      <CardGroup title={t("settings.theme.paletteGroup")}>
        <ScrollViewReader>
          {proxy => {
            paletteProxy.current = proxy
            return (
              <ScrollView axes="horizontal" scrollIndicator="hidden">
                <HStack spacing={8} padding={{ horizontal: 16, vertical: 12 }}>
                  <CustomColorButton
                    key="palette:custom"
                    selected={choice.palette === "custom"}
                    onColorChanged={color => setCustomColor(String(color))}
                  />
                  {PALETTES.map(item => (
                    <PaletteDotButton
                      key={`palette:${item.id}`}
                      palette={item}
                      selected={choice.palette === item.id}
                      onTap={() => setPalette(item.id)}
                    />
                  ))}
                </HStack>
              </ScrollView>
            )
          }}
        </ScrollViewReader>
      </CardGroup>

      <CardGroup title={t("settings.theme.compositionGroup")}>
        {COMPOSITIONS.map((item, index) => (
          <VStack key={item.id} spacing={0}>
            {index > 0 ? <Divider padding={{ leading: 16 }} /> : null}
            <CompositionRow
              composition={item}
              selected={choice.composition === item.id}
              onTap={() => setComposition(item.id)}
            />
          </VStack>
        ))}
      </CardGroup>
    </PageScroll>
  )
}

/** 一個構圖：精簡優雅的純文字排版，無示範縮圖干擾，選中打勾。 */
function CompositionRow({
  composition,
  selected,
  onTap,
}: {
  composition: Composition
  selected: boolean
  onTap: () => void
}) {
  const tint = useTint()
  return (
    <HStack
      spacing={14}
      padding={rowPadding}
      alignment="center"
      frame={{ maxWidth: "infinity" }}
      contentShape="rect"
      onTapGesture={onTap}
    >
      <VStack alignment="leading" spacing={3}>
        <Text font="body" fontWeight={selected ? "semibold" : "medium"} foregroundStyle="label">
          {t(composition.nameKey)}
        </Text>
        <Footnote>{t(composition.noteKey)}</Footnote>
      </VStack>
      <Spacer />
      {selected ? (
        <Image systemName="checkmark" font="subheadline" fontWeight="semibold" foregroundStyle={tint.tint} />
      ) : null}
    </HStack>
  )
}

/** 一個顏色：橫向的小圓，選中加一圈外框；熱區為 44×44 pt。 */
function PaletteDotButton({
  palette,
  selected,
  onTap,
}: {
  palette: Palette
  selected: boolean
  onTap: () => void
}) {
  const tint = useTint()
  return (
    <ZStack
      alignment="center"
      frame={{ width: 44, height: 44 }}
      contentShape="rect"
      onTapGesture={onTap}
    >
      <PaletteDot palette={palette} size={30} />
      <Circle frame={{ width: 30, height: 30 }} stroke={dotStroke} allowsHitTesting={false} />
      {selected ? (
        <Circle
          frame={{ width: 38, height: 38 }}
          stroke={{ shapeStyle: tint.tint, strokeStyle: { lineWidth: 2 } }}
          allowsHitTesting={false}
        />
      ) : null}
    </ZStack>
  )
}

/** 最前方的自訂調色盤按鈕：
 * iOS 的 ColorPicker 是 Label + ColorWell 的組合控制項，
 * 我們將 ColorPicker 放於底層透過透明度隱藏，但覆蓋滿版以接收原生點擊喚起系統面板；
 * 上層疊上我們自繪的標準 30pt PaletteDot + 選中 38pt 外框，保證視覺與位置 100% 精準對齊。
 */
function CustomColorButton({
  selected,
  onColorChanged,
}: {
  selected: boolean
  onColorChanged: (color: Color) => void
}) {
  const currentCustom = getCustomColor()
  const customPalette = buildCustomPalette(String(currentCustom))
  const tint = useTint()

  return (
    <ZStack alignment="center" frame={{ width: 44, height: 44 }}>
      {/* 視覺層：完全按照其他圓點的規格繪製 */}
      <PaletteDot palette={customPalette} size={30} />
      <Circle frame={{ width: 30, height: 30 }} stroke={dotStroke} allowsHitTesting={false} />
      {selected ? (
        <Circle
          frame={{ width: 38, height: 38 }}
          stroke={{ shapeStyle: tint.tint, strokeStyle: { lineWidth: 2 } }}
          allowsHitTesting={false}
        />
      ) : null}

      {/* 原生互動層：覆蓋滿版，透明觸發原生選色視窗 */}
      <ColorPicker
        title=""
        value={currentCustom}
        onChanged={onColorChanged}
        supportsOpacity={false}
        opacity={0.015}
        frame={{ width: 44, height: 44 }}
      />
    </ZStack>
  )
}
