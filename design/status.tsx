import { HStack, Image, ProgressView, Spacer, Text, VStack, type Color, type DynamicShapeStyle } from "scripting"

import { t } from "../i18n"
import { useTint } from "../app/theme"
import { cardBackgroundStrong, cardBackgroundSubtle, cardShape } from "./tokens"

export type NoticeTone = "info" | "success" | "pending" | "error"

export type StatusKind = "loading" | "error" | "empty" | "ready"

export interface StatusNotice {
  kind: StatusKind
  text: string
}

const STATUS_TONE: Record<StatusKind, NoticeTone> = {
  loading: "pending",
  error: "error",
  empty: "success",
  ready: "success",
}

export function statusTone(kind: StatusKind): NoticeTone {
  return STATUS_TONE[kind]
}

const NOTICE_ICON: Record<NoticeTone, string> = {
  info: "info.circle.fill",
  success: "checkmark.circle.fill",
  pending: "hourglass",
  error: "exclamationmark.triangle.fill",
}

const SEMANTIC_TONE: Record<Exclude<NoticeTone, "info">, { color: Color; background: Color }> = {
  success: { color: "systemGreen", background: "rgba(48, 209, 88, 0.12)" },
  pending: { color: "systemOrange", background: "rgba(255, 159, 10, 0.12)" },
  error: { color: "systemRed", background: "rgba(255, 69, 58, 0.12)" },
}

export function NoticeBanner({
  tone,
  text,
  detail,
}: {
  tone: NoticeTone
  text: string
  detail?: string
}) {
  const tint = useTint()
  const icon = NOTICE_ICON[tone]
  const info = tone === "info"
  const color: Color | DynamicShapeStyle = info ? "label" : SEMANTIC_TONE[tone].color
  const iconColor: Color | DynamicShapeStyle = info ? tint.tint : SEMANTIC_TONE[tone].color
  const background: Color | DynamicShapeStyle = info ? cardBackgroundStrong : SEMANTIC_TONE[tone].background
  return (
    <VStack
      spacing={detail ? 6 : 0}
      padding={{ horizontal: 16, vertical: 12 }}
      alignment="leading"
      frame={{ maxWidth: "infinity" }}
      background={background}
      clipShape={cardShape}
    >
      <HStack spacing={10} alignment="center" frame={{ maxWidth: "infinity" }}>
        <Image systemName={icon} foregroundStyle={iconColor} />
        <Text
          font="subheadline"
          fontWeight={detail ? "semibold" : "regular"}
          foregroundStyle={color}
          lineLimit={3}
          multilineTextAlignment="leading"
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          {text}
        </Text>
      </HStack>
      {detail ? (
        <Text font="caption2" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">
          {detail}
        </Text>
      ) : null}
    </VStack>
  )
}

export function StatusLine({ text }: { text: string }) {
  return (
    <HStack spacing={8} padding={{ horizontal: 16, vertical: 8 }} frame={{ maxWidth: "infinity" }}>
      <Text font="caption" foregroundStyle="secondaryLabel">
        {text}
      </Text>
      <Spacer />
    </HStack>
  )
}

export function PageLoading({ text = t("common.loading") }: { text?: string }) {
  return (
    <VStack alignment="center" spacing={12} padding={{ top: 80 }}>
      <ProgressView />
      <Text font="caption" foregroundStyle="tertiaryLabel">
        {text}
      </Text>
    </VStack>
  )
}

export function ListFooter({ loading, text = t("common.loadingMore") }: { loading: boolean; text?: string }) {
  if (!loading) {
    return (
      <HStack spacing={0} frame={{ maxWidth: "infinity" }} padding={{ top: 12, bottom: 36 }}>
        <Spacer />
        <Text font="caption2" foregroundStyle="tertiaryLabel">
          {t("common.allShown")}
        </Text>
        <Spacer />
      </HStack>
    )
  }
  return (
    <VStack alignment="center" spacing={8} padding={{ top: 16, bottom: 32 }}>
      <ProgressView />
      <Text font="caption2" foregroundStyle="tertiaryLabel">
        {text}
      </Text>
    </VStack>
  )
}

export function EmptyState({
  icon,
  title,
  detail,
  variant = "card",
}: {
  icon: string
  title: string
  detail?: string
  variant?: "card" | "page"
}) {
  return (
    <VStack
      spacing={8}
      alignment="center"
      padding={variant === "page" ? { top: 80, horizontal: 20 } : { vertical: 34, horizontal: 20 }}
      frame={{ maxWidth: "infinity" }}
      background={variant === "page" ? undefined : cardBackgroundSubtle}
      clipShape={variant === "page" ? undefined : cardShape}
    >
      <Image systemName={icon} font="title2" foregroundStyle="tertiaryLabel" />
      <Text font="subheadline" foregroundStyle="secondaryLabel" multilineTextAlignment="center">
        {title}
      </Text>
      {detail ? (
        <Text font="caption" foregroundStyle="tertiaryLabel" multilineTextAlignment="center">
          {detail}
        </Text>
      ) : null}
    </VStack>
  )
}
