import { getLocale, t } from "../../i18n"

const MINUTE = 60_000

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>()
const dateFormats = new Map<string, Intl.DateTimeFormat>()

export function formatCommentTime(rawTime?: string): string {
  if (!rawTime) return ""
  const trimmed = rawTime.trim()
  if (!trimmed) return ""

  const when = new Date(trimmed)
  if (isNaN(when.getTime())) return trimmed.split("T")[0] || trimmed

  const seconds = Math.floor((Date.now() - when.getTime()) / 1000)
  if (seconds < 60) return t("comments.justNow")
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return relativeTime(-minutes, "minute")
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return relativeTime(-hours, "hour")
  const days = Math.floor(hours / 24)
  if (days < 30) return relativeTime(-days, "day")
  if (days < 365) return calendarDate(when, "monthDay")
  return calendarDate(when, "full")
}

function relativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  const locale = getLocale()
  let format = relativeFormats.get(locale)
  if (format === undefined) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
    relativeFormats.set(locale, format)
  }
  return format.format(value, unit)
}

const DATE_OPTIONS: Record<"monthDay" | "full", Intl.DateTimeFormatOptions> = {
  monthDay: { month: "short", day: "numeric" },
  full: { year: "numeric", month: "short", day: "numeric" },
}

function calendarDate(when: Date, style: "monthDay" | "full"): string {
  const locale = getLocale()
  const key = `${locale}:${style}`
  let format = dateFormats.get(key)
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, DATE_OPTIONS[style])
    dateFormats.set(key, format)
  }
  return format.format(when)
}
