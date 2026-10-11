// 列：設定頁與清單頁的每一列都走這裡。
//
// 整列可點一律用 onTapGesture + frame(maxWidth: infinity)，不是 Button 包 label ——
// Button 的命中區只有 label 本身的尺寸（設定頁的列就是一個選項，整列都該能按）。

import { HStack, Image, Picker, Spacer, Text, TextField, Toggle, VStack, ZStack, type Color } from "scripting"

import { badgeOff, badgeShape, badgeSize, palette, rowPadding } from "./tokens"
import { t } from "../i18n"

/** 卡內分隔線的縮排：對齊文字起點（padding 16 + 圖示 24 + 間距 12）。 */
export const rowSeparatorInset = 52

/**
 * 圖示徽章：
 * - 支援無背景單色風格（如 monochrome minimal），相容深色/淺色語意色（secondaryLabel / tintColor / red 等）。
 * - 若有傳入 background，則呈現柔和微透光背景徽章。
 */
export function IconBadge({
  icon,
  color = "secondaryLabel",
  background,
  size = 24,
}: {
  icon: string
  color?: Color
  background?: Color
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
  iconColor?: Color
  iconBackground?: Color
  title: string
  titleColor?: Color
  detail?: string
  detailColor?: Color
  chevron?: boolean
  onTap?: () => void
}) {
  return (
    <HStack
      spacing={14}
      padding={rowPadding}
      alignment="center"
      frame={{ maxWidth: "infinity" }}
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
  valueColor?: Color
}) {
  return (
    <HStack spacing={14} padding={rowPadding}>
      <Text font="body" foregroundStyle="label">
        {label}
      </Text>
      <Spacer />
      <Text font="subheadline" foregroundStyle={valueColor} lineLimit={1}>
        {value}
      </Text>
    </HStack>
  )
}

/** 單選列。選中的那一列同時有 tint 色與勾號，不是只靠顏色。 */
export function OptionRow({ title, checked, onTap }: { title: string; checked: boolean; onTap: () => void }) {
  return (
    <HStack
      spacing={8}
      padding={rowPadding}
      alignment="center"
      frame={{ maxWidth: "infinity" }}
      onTapGesture={onTap}
    >
      <Text font="body" fontWeight={checked ? "medium" : "regular"} foregroundStyle={checked ? "tintColor" : "label"}>
        {title}
      </Text>
      <Spacer />
      {checked ? (
        <Image systemName="checkmark" font="subheadline" fontWeight="semibold" foregroundStyle="tintColor" />
      ) : null}
    </HStack>
  )
}

/** 開關列。 */
export function ToggleRow({
  icon,
  iconColor = "secondaryLabel",
  title,
  value,
  onChanged,
}: {
  icon: string
  iconColor?: Color
  title: string
  value: boolean
  onChanged: (value: boolean) => void
}) {
  return (
    <HStack spacing={14} padding={rowPadding} alignment="center">
      <IconBadge icon={icon} color={iconColor} />
      <Text font="body" fontWeight="medium" foregroundStyle="label">
        {title}
      </Text>
      <Spacer />
      <Toggle title="" value={value} onChanged={onChanged} />
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
  iconColor?: Color
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

/**
 * 有標題的輸入列（表單用）。標題在欄位上方 —— 帳號、網址、關鍵字這類值都很長，
 * 標題放左邊會把欄位擠成一小條。`multiline` 給貼原始碼那種大區塊用。
 */
export function TextInputRow({
  icon,
  iconColor,
  label,
  prompt,
  value,
  multiline = false,
  lines = 4,
  onChanged,
}: {
  icon?: string
  iconColor?: Color
  label: string
  prompt?: string
  value: string
  multiline?: boolean
  lines?: number
  onChanged: (value: string) => void
}) {
  return (
    <VStack spacing={8} padding={rowPadding} alignment="leading" frame={{ maxWidth: "infinity" }}>
      <HStack spacing={8} alignment="center">
        {icon ? <IconBadge icon={icon} color={iconColor ?? "tintColor"} /> : null}
        <Text font="caption" foregroundStyle="secondaryLabel">
          {label}
        </Text>
        <Spacer />
      </HStack>
      <TextField
        title=""
        prompt={prompt}
        value={value}
        textFieldStyle="plain"
        axis={multiline ? "vertical" : undefined}
        lineLimit={multiline ? { min: lines, max: lines * 3 } : undefined}
        onChanged={onChanged}
      />
    </VStack>
  )
}

/** 下拉選單列。左側圖示與標題，右側顯示當前值（可選單點擊切換）。 */
export function SelectRow({
  icon,
  iconColor = "secondaryLabel",
  title,
  value,
  options,
  onChanged,
}: {
  icon: string
  iconColor?: Color
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
      <Picker
        title={currentText}
        pickerStyle="menu"
        value={value}
        onChanged={(next: string | number) => onChanged(String(next))}
      >
        {options.map(option => (
          <Text key={option.value} tag={option.value}>
            {option.text}
          </Text>
        ))}
      </Picker>
    </HStack>
  )
}

export type ActionTone = "default" | "destructive"

/**
 * 卡片裡的動作列。整列可點（執行中與停用時不給 onTap），
 * `busy` 把圖示換成漏斗並改寫標題。
 *
 * 刻意不用 `glassProminent`：那個在卡片裡會被拉成一整塊填滿的色塊
 * （預覽環境沒玻璃時是純白），而設定頁的動作本來就是一列文字，列比色塊好。
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
  iconColor?: Color
  title: string
  detail?: string
  tone?: ActionTone
  busy?: boolean
  disabled?: boolean
  onTap: () => void
}) {
  const inactive = busy || disabled
  const fallbackColor = tone === "destructive" ? palette.red : "tintColor"

  return (
    <IconRow
      icon={busy ? "hourglass" : icon}
      iconColor={inactive ? "secondaryLabel" : (iconColor ?? fallbackColor)}
      title={busy ? t("common.working") : title}
      titleColor={tone === "destructive" ? palette.red : inactive ? "secondaryLabel" : "tintColor"}
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
  iconColor?: Color
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

