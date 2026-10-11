// 留言的時間戳 → 顯示字（相對時間）。
//
// 為什麼自己一支：① 舊版［在 `CommentScreen` 裡］把**已經渲染出來的字串**再
// `includes("前")`／`=== "剛剛"` 反推語意，那是拿顯示字串當程式邏輯（spec 跨票規則 4）；
// 現在只認時間戳，字串只出現在 render。② 相對時間要能單獨在三種語言下驗，
// 探針就不必把整個留言畫面拉進來。
//
// 相對時間走 `Intl.RelativeTimeFormat` 的 `numeric: "auto"`（zh-Hant 會給「昨天」「5分鐘前」），
// **不自己在字典裡組** `${n} 分鐘前`——複數、量詞、語序都是語言的規則，交給平台。
// 字典只收那一句沒有數字的「剛剛」。

import { getLocale, t } from "../../i18n"

const MINUTE = 60_000

/** 建一次不便宜，而列表每一列都要問一次：每種語言各留一份。 */
const relativeFormats = new Map<string, Intl.RelativeTimeFormat>()
const dateFormats = new Map<string, Intl.DateTimeFormat>()

/**
 * 一則留言的時間 → 顯示字。
 *
 * 認得時間戳（源多半給 ISO 字串）就換算成相對時間；源自己給的已經是「3分鐘前」這種
 * 相對字串（`new Date` 解析不了）就原樣顯示——那是源的資料，不是我們的話。
 */
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
  // 一個月以上：相對的說法（「上個月」）已經沒有資訊量，換成日期。
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

/** 兩種日期粒度：只到月日，或連年份。 */
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
