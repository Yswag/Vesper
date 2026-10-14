// 通用狀態元件：包含狀態橫幅（NoticeBanner）、載入指示（PageLoading）、頁尾（ListFooter）與空狀態（EmptyState）。

import { HStack, Image, ProgressView, Spacer, Text, VStack, type Color } from "scripting"

import { t } from "../i18n"
import { cardBackgroundSubtle, cardShape } from "./tokens"

export type NoticeTone = "info" | "success" | "pending" | "error"

/** 業務狀態分類。 */
export type StatusKind = "loading" | "error" | "empty" | "ready"

/**
 * 一則要顯示的狀態：`kind` 是狀態、`text` 是要顯示的訊息（資料）。
 * 沒有話要說就是 `null`（不是空字串）——「有沒有訊息」也是結構，不是文字。
 */
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

/** 依業務狀態取得對應視覺語調。 */
export function statusTone(kind: StatusKind): NoticeTone {
  return STATUS_TONE[kind]
}

const NOTICE_STYLE: Record<NoticeTone, { icon: string; color: Color; background: Color }> = {
  info: { icon: "info.circle.fill", color: "systemBlue", background: "rgba(10, 132, 255, 0.12)" },
  success: { icon: "checkmark.circle.fill", color: "systemGreen", background: "rgba(48, 209, 88, 0.12)" },
  pending: { icon: "hourglass", color: "systemOrange", background: "rgba(255, 159, 10, 0.12)" },
  error: { icon: "exclamationmark.triangle.fill", color: "systemRed", background: "rgba(255, 69, 58, 0.12)" },
}

/**
 * 一則狀態。`detail` 給「一句標題 + 一行說明」的情況（例如載入失敗的原因）。
 * 文字靠左：置中的話長訊息會變成兩邊都對不齊。
 */
export function NoticeBanner({
  tone,
  text,
  detail,
}: {
  tone: NoticeTone
  text: string
  detail?: string
}) {
  const style = NOTICE_STYLE[tone]
  return (
    <VStack
      spacing={detail ? 6 : 0}
      padding={{ horizontal: 16, vertical: 12 }}
      alignment="leading"
      frame={{ maxWidth: "infinity" }}
      background={style.background}
      clipShape={cardShape}
    >
      <HStack spacing={10} alignment="center" frame={{ maxWidth: "infinity" }}>
        <Image systemName={style.icon} foregroundStyle={style.color} />
        <Text
          font="subheadline"
          fontWeight={detail ? "semibold" : "regular"}
          foregroundStyle={style.color}
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

/**
 * 內容上方的一行狀態（不擋內容、靠左）。
 * 加 Spacer 是為了讓它撑滿寬度 —— 只有 Text 的 HStack 會 hug 內容，
 * 父層（頁面的 VStack）預設置中，訊息就會被推到中間去。
 */
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

/** 頁面第一次載入（還沒有任何內容可以顯示）。預設文案在呼叫時才算，切語言會跟著變。 */
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

/** 列表底部的加載中或已加載完畢提示。 */
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

/**
 * 空狀態：圖示 + 一句說明（可再加一行怎麼開始）。
 * card＝清單裡的一段（淡底卡片）；page＝整頁還沒內容（不畫底，往下讓開）。
 */
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
