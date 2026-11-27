import { Form, HStack, Image, Menu, Picker, Rectangle, Section, Spacer, Stepper, Text, Toggle, VStack, useState } from "scripting"

import { t } from "../i18n"
import { useTint } from "../app/theme"
import { glass } from "../design/glass"
import { toggleTint } from "../design/rows"
import { capsule, fill, radius, rect } from "../design/tokens"
import {
  getPrefetchPages,
  PREFETCH_MAX,
  PREFETCH_MIN,
  setPrefetchPages,
  type ReaderSettings,
} from "../library/readerSettings"

export interface ReaderSettingsSheetProps {
  settings: ReaderSettings
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void
  canUpscale: boolean
  perComic: boolean
  onTogglePerComic: (on: boolean) => void
}

const rowBackground = <Rectangle fill={fill.chip} />
const rowStyle = { listRowBackground: rowBackground, listRowSeparator: "hidden" } as const

function directionLabel(direction: ReaderSettings["direction"]): string {
  if (direction === "ltr") return t("reader.directionLtr")
  if (direction === "rtl") return t("reader.directionRtl")
  return t("reader.directionTtb")
}

function SettingToggle({
  title,
  value,
  disabled = false,
  onChanged,
}: {
  title: string
  value: boolean
  disabled?: boolean
  onChanged: (value: boolean) => void
}) {
  const tint = useTint()
  return (
    <HStack spacing={12} alignment="center" {...rowStyle}>
      <Text foregroundStyle={disabled ? "tertiaryLabel" : "label"}>{title}</Text>
      <Spacer />
      <Toggle title="" value={value} disabled={disabled} tint={toggleTint(tint)} onChanged={onChanged} />
    </HStack>
  )
}

function PrefetchStepper() {
  const [pages, setPages] = useState<number>(getPrefetchPages)
  const change = (delta: number) => setPages(setPrefetchPages(pages + delta))
  return (
    <Stepper
      {...rowStyle}
      onIncrement={() => {
        if (pages < PREFETCH_MAX) change(1)
      }}
      onDecrement={() => {
        if (pages > PREFETCH_MIN) change(-1)
      }}
    >
      <HStack>
        <Text foregroundStyle="label">{t("reader.prefetch")}</Text>
        <Spacer />
        <Text foregroundStyle="secondaryLabel" monospacedDigit>
          {pages === 0 ? t("reader.prefetchOff") : t("reader.prefetchPages", { n: pages })}
        </Text>
      </HStack>
    </Stepper>
  )
}

export function ReaderSettingsSheet({
  settings,
  onUpdateSettings,
  canUpscale,
  perComic,
  onTogglePerComic,
}: ReaderSettingsSheetProps) {
  const tapZonesUnavailable = settings.direction === "ttb" && settings.mode !== "gallery"
  const splitUnavailable = settings.mode !== "gallery"
  const tint = useTint()

  return (
    <VStack
      spacing={0}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      environments={{ colorScheme: "dark" }}
      preferredColorScheme="dark"
      presentationBackground="clear"
      {...glass({ shape: rect(radius.xl), fallback: "regularMaterial" })}
      ignoresSafeArea={{ edges: "bottom" }}
      presentationDetents={["medium", "large"]}
      presentationDragIndicator="visible"
      presentationCornerRadius={24}
      tint={tint.tint}
    >
      <Text
        font="headline"
        fontWeight="bold"
        foregroundStyle="label"
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        padding={{ top: 18, horizontal: 20, bottom: 4 }}
      >
        {t("reader.readingSettings")}
      </Text>

      <Form scrollContentBackground="hidden">
        {}
        <Section>
          <SettingToggle title={t("reader.perComic")} value={perComic} onChanged={onTogglePerComic} />
        </Section>

        {}
        <Section footer={tapZonesUnavailable ? <Text>{t("reader.tapZonesVerticalOnly")}</Text> : undefined}>
          <VStack spacing={10} {...rowStyle}>
            <Picker
              title={t("reader.mode")}
              value={settings.mode}
              pickerStyle="segmented"
              onChanged={(mode: string | number) =>
                onUpdateSettings({ mode: mode === "gallery" ? "gallery" : "continuous" })
              }
            >
              <Text tag="gallery">{t("reader.modeGallery")}</Text>
              <Text tag="continuous">{t("reader.modeContinuous")}</Text>
            </Picker>

            <Menu
              accessibilityLabel={t("reader.direction")}
              label={
                <HStack
                  frame={{ maxWidth: "infinity" }}
                  padding={{ horizontal: 16, vertical: 12 }}
                  background={{ style: fill.chip, shape: capsule() }}
                  foregroundStyle={tint.tint}
                >
                  <Text lineLimit={1}>{directionLabel(settings.direction)}</Text>
                  <Spacer />
                  <Image systemName="chevron.up.chevron.down" font="footnote" fontWeight="semibold" />
                </HStack>
              }
            >
              <Picker
                title={t("reader.direction")}
                value={settings.direction}
                onChanged={(direction: string | number) =>
                  onUpdateSettings({
                    direction: direction === "ltr" || direction === "rtl" ? direction : "ttb",
                  })
                }
              >
                <Text tag="ltr">{t("reader.directionLtr")}</Text>
                <Text tag="rtl">{t("reader.directionRtl")}</Text>
                <Text tag="ttb">{t("reader.directionTtb")}</Text>
              </Picker>
            </Menu>
          </VStack>

          <SettingToggle
            title={t("reader.tapZones")}
            disabled={tapZonesUnavailable}
            value={settings.tapZones && !tapZonesUnavailable}
            onChanged={value => {
              if (!tapZonesUnavailable) onUpdateSettings({ tapZones: value })
            }}
          />
          <SettingToggle
            title={t("reader.splitWide")}
            disabled={splitUnavailable}
            value={settings.splitWide && !splitUnavailable}
            onChanged={value => {
              if (!splitUnavailable) onUpdateSettings({ splitWide: value })
            }}
          />
          {settings.splitWide && !splitUnavailable ? (
            <SettingToggle
              title={t("reader.splitSwap")}
              value={settings.splitSwap}
              onChanged={value => onUpdateSettings({ splitSwap: value })}
            />
          ) : null}
        </Section>

        {}
        <Section>
          <SettingToggle
            title={t("reader.cornerPage")}
            value={settings.cornerPage}
            onChanged={value => onUpdateSettings({ cornerPage: value })}
          />
          <SettingToggle
            title={t("reader.cornerTime")}
            value={settings.cornerTime}
            onChanged={value => onUpdateSettings({ cornerTime: value })}
          />
        </Section>

        {}
        <Section footer={canUpscale ? undefined : <Text>{t("reader.upscaleRequiresPro")}</Text>}>
          <SettingToggle
            title={t("reader.seamlessNext")}
            value={settings.seamlessNext}
            onChanged={value => onUpdateSettings({ seamlessNext: value })}
          />
          <PrefetchStepper />
          <SettingToggle
            title={t("reader.hardwareSharpen")}
            disabled={!canUpscale}
            value={settings.hardwareSharpen}
            onChanged={value => {
              if (canUpscale) onUpdateSettings({ hardwareSharpen: value })
            }}
          />
        </Section>
      </Form>
    </VStack>
  )
}
