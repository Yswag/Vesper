// 通用清單與設定項目列元件庫。
// 點擊事件一律採 onTapGesture 與全寬容器，保持整列觸控範圍。
// ⚠️ 有 onTapGesture 的列要配 `contentShape="rect"`，不然 Spacer 那段不算內容、點不到。

import {
  Button,
  HStack,
  Image,
  Menu,
  Picker,
  SecureField,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  ZStack,
  type Color,
  type DynamicShapeStyle,
  type KeyboardType,
} from "scripting"

import { useTint, type Tint } from "../app/theme"
import { badgeOff, badgeShape, badgeSize, rowPadding, toneText } from "./tokens"
import { t } from "../i18n"

/** 列上的顏色可以給固定色（`Color`）或跟主題的 `DynamicShapeStyle`。 */
export type RowColor = Color | DynamicShapeStyle

/** 卡內分隔線的縮排：對齊文字起點（padding 16 + 圖示 24 + 間距 12）。 */
export const rowSeparatorInset = 52

/**
 * 圖示徽章：支援單色透明風格或傳入 background 之微透光膠囊背景。
 */
export function IconBadge({
  icon,
  color = "secondaryLabel",
  background,
  size = 24,
}: {
  icon: string
  color?: RowColor
  background?: RowColor
  size?: number
}) {
  if (!background) {
    return (
      <HStack alignment="center" frame={{ width: size, height: size }}>
        <Image systemName={icon} font="title3" fontWeight="regular" foregroundStyle={color} />
      </HStack>
    )
  }

  return (
    <ZStack alignment="center" frame={{ width: size, height: size }}>
      <VStack
        alignment="center"
        frame={{ width: size, height: size }}
        background={background}
        opacity={0.16}
        clipShape={badgeShape}
      />
      <Image systemName={icon} font="subheadline" fontWeight="medium" foregroundStyle={color} />
    </ZStack>
  )
}

/** 列表右侧的箭頭。只在「會進下一頁」時用。 */
export function Chevron() {
  return <Image systemName="chevron.right" font="caption" fontWeight="semibold" foregroundStyle="tertiaryLabel" />
}

/** 有圖示的一列。color 預設為 secondaryLabel（相容深淺色模式），onTap 不給就是純資訊列。 */
export function IconRow({
  icon,
  iconColor = "secondaryLabel",
  iconBackground,
  title,
  titleColor = "label",
  detail,
  detailColor = "secondaryLabel",
  chevron = false,
  onTap,
}: {
  icon: string
  iconColor?: RowColor
  iconBackground?: RowColor
  title: string
  titleColor?: RowColor
  detail?: string
  detailColor?: RowColor
  chevron?: boolean
  onTap?: () => void
}) {
  return (
    <HStack
      spacing={14}
      padding={rowPadding}
      alignment="center"
      frame={{ maxWidth: "infinity" }}
      contentShape="rect"
      onTapGesture={onTap}
    >
      <IconBadge icon={icon} color={iconColor} background={iconBackground} />
      <Text font="body" fontWeight="regular" foregroundStyle={titleColor}>
        {title}
      </Text>
      <Spacer />
      {detail ? (
        <Text font="subheadline" foregroundStyle={detailColor}>
          {detail}
        </Text>
      ) : null}
      {chevron ? <Chevron /> : null}
    </HStack>
  )
}

/** label / value 的資訊列（沒有圖示、沒有動作）。 */
export function InfoRow({
  label,
  value,
  valueColor = "secondaryLabel",
}: {
  label: string
  value: string
  valueColor?: RowColor
}) {
  return (
    <HStack spacing={14} padding={rowPadding} alignment="center" frame={{ maxWidth: "infinity" }}>
      <Text font="body" foregroundStyle="label">
        {label}
      </Text>
      <Spacer />
      <Text font="subheadline" foregroundStyle={valueColor} lineLimit={1} truncationMode="middle">
        {value}
      </Text>
    </HStack>
  )
}

/** 單選列。選中的那一列同時有 tint 色與勾號，不是只靠顏色。 */
export function OptionRow({ title, checked, onTap }: { title: string; checked: boolean; onTap: () => void }) {
  const tint = useTint()
  return (
    <HStack
      spacing={8}
      padding={rowPadding}
      alignment="center"
      frame={{ maxWidth: "infinity" }}
      contentShape="rect"
      onTapGesture={onTap}
    >
      <Text font="body" fontWeight={checked ? "medium" : "regular"} foregroundStyle={checked ? tint.tint : "label"}>
        {title}
      </Text>
      <Spacer />
      {checked ? (
        <Image systemName="checkmark" font="subheadline" fontWeight="semibold" foregroundStyle={tint.tint} />
      ) : null}
    </HStack>
  )
}

/** 開關的軌道色：中性盤（石墨、灰階）的 tint 是白色，圓鈕會淹在軌道裡 → 用系統預設綠。 */
export function toggleTint(tint: Tint): RowColor {
  return tint.neutral ? "systemGreen" : tint.tint
}

/** 開關列。`subtitle` 是標題下方的一句說明（來源的 `subtitle`）。 */
export function ToggleRow({
  icon,
  iconColor = "secondaryLabel",
  title,
  subtitle,
  value,
  onChanged,
}: {
  icon: string
  iconColor?: RowColor
  title: string
  subtitle?: string
  value: boolean
  onChanged: (value: boolean) => void
}) {
  const tint = useTint()
  return (
    <HStack spacing={14} padding={rowPadding} alignment="center">
      <IconBadge icon={icon} color={iconColor} />
      <VStack spacing={2} alignment="leading">
        <Text font="body" fontWeight="medium" foregroundStyle="label">
          {title}
        </Text>
        {subtitle ? (
          <Text font="caption" foregroundStyle="secondaryLabel">
            {subtitle}
          </Text>
        ) : null}
      </VStack>
      <Spacer />
      <Toggle title="" value={value} onChanged={onChanged} tint={toggleTint(tint)} />
    </HStack>
  )
}

/** 輸入列（設定值、帳號欄位…）。 */
export function FieldRow({
  icon,
  iconColor = "secondaryLabel",
  value,
  prompt,
  onChanged,
}: {
  icon: string
  iconColor?: RowColor
  value: string
  prompt?: string
  onChanged: (value: string) => void
}) {
  return (
    <HStack spacing={14} padding={rowPadding} alignment="center">
      <IconBadge icon={icon} color={iconColor} />
      <TextField title="" prompt={prompt} value={value} textFieldStyle="plain" onChanged={onChanged} />
    </HStack>
  )
}

/** 帶有獨立頂部標籤的文字輸入列（適合較長字串如 URL 或多行原始碼）。 */
export function TextInputRow({
  icon,
  iconColor,
  label,
  prompt,
  value,
  multiline = false,
  lines = 4,
  secure = false,
  keyboardType,
  onChanged,
  onBlur,
}: {
  icon?: string
  iconColor?: RowColor
  label: string
  prompt?: string
  value: string
  multiline?: boolean
  lines?: number
  /** 遮蔽輸入（來源的 `secure: true`）。`SecureField` 沒有多行，所以 multiline 會失效。 */
  secure?: boolean
  keyboardType?: KeyboardType
  onChanged: (value: string) => void
  onBlur?: () => void
}) {
  const tint = useTint()
  return (
    <VStack spacing={8} padding={rowPadding} alignment="leading" frame={{ maxWidth: "infinity" }}>
      <HStack spacing={8} alignment="center">
        {icon ? <IconBadge icon={icon} color={iconColor ?? tint.tint} /> : null}
        <Text font="caption" foregroundStyle="secondaryLabel">
          {label}
        </Text>
        <Spacer />
      </HStack>
      {secure ? (
        <SecureField
          title=""
          prompt={prompt}
          value={value}
          keyboardType={keyboardType}
          onBlur={onBlur}
          onChanged={onChanged}
        />
      ) : (
        <TextField
          title=""
          prompt={prompt}
          value={value}
          textFieldStyle="plain"
          axis={multiline ? "vertical" : undefined}
          lineLimit={multiline ? { min: lines, max: lines * 3 } : undefined}
          keyboardType={keyboardType}
          onBlur={onBlur}
          onChanged={onChanged}
        />
      )}
    </VStack>
  )
}

/** 下拉選單列。左側圖示與標題，右側顯示當前值（低調無彩色次要標籤，點擊彈出 Menu；選中項打勾）。 */
export function SelectRow({
  icon,
  iconColor = "secondaryLabel",
  title,
  value,
  options,
  onChanged,
}: {
  icon: string
  iconColor?: RowColor
  title: string
  value: string
  options: Array<{ value: string; text: string }>
  onChanged: (value: string) => void
}) {
  const currentText = options.find(o => o.value === value)?.text ?? value

  return (
    <HStack spacing={14} padding={rowPadding} alignment="center" frame={{ maxWidth: "infinity" }}>
      <IconBadge icon={icon} color={iconColor} />
      <Text font="body" fontWeight="regular" foregroundStyle="label">
        {title}
      </Text>
      <Spacer />
      <Menu
        label={
          <HStack spacing={4} alignment="center">
            <Text font="body" foregroundStyle="secondaryLabel" lineLimit={1}>
              {currentText}
            </Text>
            <Image
              systemName="chevron.up.chevron.down"
              font="caption2"
              fontWeight="semibold"
              foregroundStyle="tertiaryLabel"
            />
          </HStack>
        }
      >
        {options.map(option => (
          <Button
            key={option.value}
            title={option.text}
            systemImage={option.value === value ? "checkmark" : undefined}
            action={() => onChanged(option.value)}
          />
        ))}
      </Menu>
    </HStack>
  )
}

export type ActionTone = "default" | "destructive"

/**
 * 操作動作列（支援 busy 等候與 destructive 危險樣式）。
 */
export function ActionRow({
  icon,
  iconColor,
  title,
  detail,
  tone = "default",
  busy = false,
  disabled = false,
  onTap,
}: {
  icon: string
  iconColor?: RowColor
  title: string
  detail?: string
  tone?: ActionTone
  busy?: boolean
  disabled?: boolean
  onTap: () => void
}) {
  const inactive = busy || disabled
  const tint = useTint()
  const fallbackColor: RowColor = tone === "destructive" ? toneText.danger : tint.tint

  return (
    <IconRow
      icon={busy ? "hourglass" : icon}
      iconColor={inactive ? "secondaryLabel" : (iconColor ?? fallbackColor)}
      title={busy ? t("common.working") : title}
      titleColor={tone === "destructive" ? toneText.danger : inactive ? "secondaryLabel" : tint.tint}
      detail={detail}
      onTap={inactive ? undefined : onTap}
    />
  )
}

/**
 * 水平單列式表單輸入（iOS 標準風格）：
 * 左側為 IconBadge 與標籤（寬度適中），右側為佔滿的 TextField。
 */
export function FormInputRow({
  icon,
  iconColor = "secondaryLabel",
  label,
  value,
  prompt,
  onChanged,
}: {
  icon?: string
  iconColor?: RowColor
  label: string
  value: string
  prompt?: string
  onChanged: (value: string) => void
}) {
  return (
    <HStack spacing={14} padding={rowPadding} alignment="center" frame={{ maxWidth: "infinity" }}>
      {icon ? <IconBadge icon={icon} color={iconColor} /> : null}
      <Text font="body" fontWeight="regular" foregroundStyle="label">
        {label}
      </Text>
      <Spacer />
      <TextField
        title=""
        prompt={prompt}
        value={value}
        textFieldStyle="plain"
        multilineTextAlignment="trailing"
        onChanged={onChanged}
      />
    </HStack>
  )
}

