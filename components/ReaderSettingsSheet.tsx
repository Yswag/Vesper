import { Form, HStack, Image, Menu, Picker, Rectangle, Section, Spacer, Text, Toggle, VStack } from "scripting"

import { t } from "../i18n"
import { useTint } from "../app/theme"
import { glass } from "../design/glass"
import { toggleTint } from "../design/rows"
import { capsule, fill, radius, rect } from "../design/tokens"
import type { ReaderSettings } from "../library/readerSettings"

export interface ReaderSettingsSheetProps {
  settings: ReaderSettings
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void
  canUpscale: boolean
  perComic: boolean
  onTogglePerComic: (on: boolean) => void
}

/** 列底要半透明才接得上玻璃；系統列底不跟區域的深色覆蓋，會畫成白底。 */
const rowBackground = <Rectangle fill={fill.chip} />

function directionLabel(direction: ReaderSettings["direction"]): string {
  if (direction === "ltr") return t("reader.directionLtr")
  if (direction === "rtl") return t("reader.directionRtl")
  return t("reader.directionTtb")
}

/** 開關列：圖示灰色（只是裝飾），開關跟主題色。 */
function SettingToggle({
  icon,
  title,
  value,
  disabled = false,
  onChanged,
}: {
  icon: string
  title: string
  value: boolean
  disabled?: boolean
  onChanged: (value: boolean) => void
}) {
  const tint = useTint()
  return (
    <HStack spacing={12} alignment="center" listRowBackground={rowBackground}>
      <Image
        systemName={icon}
        foregroundStyle={disabled ? "tertiaryLabel" : "secondaryLabel"}
        frame={{ width: 24 }}
      />
      <Text foregroundStyle={disabled ? "tertiaryLabel" : "label"}>{title}</Text>
      <Spacer />
      <Toggle title="" value={value} disabled={disabled} tint={toggleTint(tint)} onChanged={onChanged} />
    </HStack>
  )
}

/** 閱讀設定面板：改了立刻套用，漫畫留在後面看得到效果。 */
export function ReaderSettingsSheet({
  settings,
  onUpdateSettings,
  canUpscale,
  perComic,
  onTogglePerComic,
}: ReaderSettingsSheetProps) {
  // 縱向連續沒有點擊翻頁（縱向畫廊有，上下分區）。
  const tapZonesUnavailable = settings.direction === "ttb" && settings.mode !== "gallery"
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
      // 面板是另一個 presentation，接不到 App 根層的 tint。
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
        {/* 預設跟隨源宣告（再退全域）；打開才把這本記成獨立設定。 */}
        <Section>
          <SettingToggle icon="pin" title={t("reader.perComic")} value={perComic} onChanged={onTogglePerComic} />
        </Section>

        {/* 版面兩個控制放同一塊：模式是分段切換，方向是欄位式選單（點開是系統勾選清單）。 */}
        <Section>
          <VStack spacing={10} listRowBackground={rowBackground}>
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
        </Section>

        <Section footer={tapZonesUnavailable ? <Text>{t("reader.tapZonesVerticalOnly")}</Text> : undefined}>
          <SettingToggle
            icon="hand.tap"
            title={t("reader.tapZones")}
            disabled={tapZonesUnavailable}
            value={settings.tapZones && !tapZonesUnavailable}
            onChanged={value => {
              if (!tapZonesUnavailable) onUpdateSettings({ tapZones: value })
            }}
          />
        </Section>

        <Section footer={canUpscale ? undefined : <Text>{t("reader.upscaleRequiresPro")}</Text>}>
          <SettingToggle
            icon="sparkles"
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
