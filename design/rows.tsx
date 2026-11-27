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
import { badgeOff, badgeShape, badgeSize, capsule, rowPadding, toneText } from "./tokens"
import { t } from "../i18n"

export type RowColor = Color | DynamicShapeStyle

export const rowSeparatorInset = 52

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

export function CountBadge({ count }: { count: number }) {
  return (
    <Text
      font="caption2"
      fontWeight="bold"
      foregroundStyle="white"
      monospacedDigit
      lineLimit={1}
      fixedSize={{ horizontal: true, vertical: false }}
      padding={{ horizontal: 5 }}
      frame={{ minWidth: 16, minHeight: 16 }}
      background={{ style: "systemRed", shape: capsule("circular") }}
    >
      {count > 99 ? "99+" : String(count)}
    </Text>
  )
}

export function Chevron() {
  return <Image systemName="chevron.right" font="caption" fontWeight="semibold" foregroundStyle="tertiaryLabel" />
}

export function IconRow({
  icon,
  iconColor = "secondaryLabel",
  iconBackground,
  title,
  titleColor = "label",
  detail,
  detailColor = "secondaryLabel",
  chevron = false,
  badge = 0,
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
  badge?: number
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
      <VStack
        overlay={
          badge > 0
            ? {
                alignment: "topTrailing",
                content: (
                  <VStack offset={{ x: 8, y: -8 }}>
                    <CountBadge count={badge} />
                  </VStack>
                ),
              }
            : undefined
        }
      >
        <IconBadge icon={icon} color={iconColor} background={iconBackground} />
      </VStack>
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

export function OptionRow({
  title,
  subtitle,
  checked,
  onTap,
}: {
  title: string
  subtitle?: string
  checked: boolean
  onTap: () => void
}) {
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
      <VStack spacing={2} alignment="leading">
        <Text font="body" fontWeight={checked ? "medium" : "regular"} foregroundStyle={checked ? tint.tint : "label"}>
          {title}
        </Text>
        {subtitle ? (
          <Text font="caption2" foregroundStyle="tertiaryLabel">
            {subtitle}
          </Text>
        ) : null}
      </VStack>
      <Spacer />
      {checked ? (
        <Image systemName="checkmark" font="subheadline" fontWeight="semibold" foregroundStyle={tint.tint} />
      ) : null}
    </HStack>
  )
}

export function toggleTint(tint: Tint): RowColor {
  return tint.neutral ? "systemGreen" : tint.tint
}

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

export function SelectRow({
  icon,
  iconColor = "secondaryLabel",
  title,
  value,
  options,
  onChanged,
}: {
  icon?: string
  iconColor?: RowColor
  title: string
  value: string
  options: Array<{ value: string; text: string }>
  onChanged: (value: string) => void
}) {
  const currentText = options.find(o => o.value === value)?.text ?? value

  return (
    <HStack spacing={14} padding={rowPadding} alignment="center" frame={{ maxWidth: "infinity" }}>
      {icon ? <IconBadge icon={icon} color={iconColor} /> : null}
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

