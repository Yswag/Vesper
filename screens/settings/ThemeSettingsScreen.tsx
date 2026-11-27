import { Circle, ColorPicker, Divider, HStack, Image, Picker, ScrollView, ScrollViewReader, Spacer, Text, VStack, ZStack, useEffect, useRef, type Color, type ScrollViewProxy } from "scripting"

import {
  APPEARANCES,
  COMPOSITIONS,
  PALETTES,
  PaletteDot,
  appearanceSetting,
  buildCustomPalette,
  getCustomColor,
  parseAppearance,
  setAppearance,
  setComposition,
  setCustomColor,
  setPalette,
  useThemeChoice,
  useTint,
  type Appearance,
  type Composition,
  type Palette,
} from "../../app/theme"
import { useSubscription } from "../../app/useSubscription"
import { CardGroup, PageScroll } from "../../design/layout"
import { rowSeparatorInset } from "../../design/rows"
import { Footnote } from "../../design/text"
import { dotStroke, rowPadding } from "../../design/tokens"
import { subscribe as subscribeLocale, t, type MessageKey } from "../../i18n"

const APPEARANCE_LABELS: Record<Appearance, MessageKey> = {
  system: "settings.followSystem",
  light: "settings.theme.light",
  dark: "settings.theme.dark",
}

export function ThemeSettingsScreen() {
  useSubscription(subscribeLocale)
  const choice = useThemeChoice()
  const paletteProxy = useRef<ScrollViewProxy>()
  const selectedPaletteKey = choice.palette === "custom" ? "palette:custom" : `palette:${choice.palette}`

  useEffect(() => {
    const proxy = paletteProxy.current
    if (!proxy) return
    const timer = setTimeout(() => proxy.scrollTo(selectedPaletteKey, "center"), 0)
    return () => clearTimeout(timer)
  }, [])

  return (
    <PageScroll title={t("settings.root.appearance")}>
      <CardGroup title={t("settings.theme.appearanceGroup")}>
        <Picker
          title={t("settings.theme.appearanceGroup")}
          value={appearanceSetting()}
          pickerStyle="segmented"
          onChanged={(value: string | number) => setAppearance(parseAppearance(value))}
          padding={rowPadding}
        >
          {APPEARANCES.map(item => (
            <Text key={item} tag={item}>
              {t(APPEARANCE_LABELS[item])}
            </Text>
          ))}
        </Picker>
      </CardGroup>

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
      {}
      <PaletteDot palette={customPalette} size={30} />
      <Circle frame={{ width: 30, height: 30 }} stroke={dotStroke} allowsHitTesting={false} />
      {selected ? (
        <Circle
          frame={{ width: 38, height: 38 }}
          stroke={{ shapeStyle: tint.tint, strokeStyle: { lineWidth: 2 } }}
          allowsHitTesting={false}
        />
      ) : null}

      {}
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
