// Aidoku 倉庫索引：兩種 schema 收斂成同一份 CatalogEntry。
//
//   community   { name, sources: [{ id, name, version, iconURL, downloadURL, languages, contentRating }] }
//   zh-sources  [{ id, name, version, file, icon, lang, nsfw }]
//
// 差別只在欄位名（downloadURL/file、iconURL/icon、languages/lang、contentRating/nsfw）與版本型別
// （community 是數字、zh-sources 也是數字；兩種都收字串）。圖示是相對路徑，對索引 base 解。
// `minAppVersion` 是 Aidoku App 的版號，與 Vesper 無關，直接忽略。

import { t } from "../i18n"

import { keyOf } from "./aidoku"
import { resolveRelative, type CatalogEntry } from "./catalog"

export type AidokuIndexSchema = "community" | "zh-sources"

export interface AidokuIndexParseResult {
  entries: CatalogEntry[]
  /** 被跳過的條目與原因。 */
  rejected: Array<{ index: number; reason: string }>
  /** 索引自己宣告的名稱（community 才有）。 */
  name?: string
}

/** Aidoku 的源 id（`zh.copymanga`、`multi.mangadex`）。 */
const ID_PATTERN = /^[A-Za-z0-9._-]+$/

/** 這個 JSON 是不是 Aidoku 的索引；不是就回 null。 */
export function aidokuIndexSchema(raw: unknown): AidokuIndexSchema | null {
  if (Array.isArray(raw)) return "zh-sources"
  if (raw && typeof raw === "object" && Array.isArray((raw as { sources?: unknown }).sources)) return "community"
  return null
}

function textOf(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

function languagesOf(item: Record<string, unknown>): string[] {
  const raw = item.languages ?? item.lang
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
  return list.map(value => textOf(value)).filter((value): value is string => Boolean(value))
}

/** `contentRating` 是 Aidoku 的整數（0 安全 / 1 暗示 / 2 R18）；zh-sources 的 `nsfw` 同理。 */
function nsfwOf(item: Record<string, unknown>): boolean {
  const raw = item.contentRating ?? item.nsfw
  if (typeof raw === "boolean") return raw
  if (typeof raw === "number") return raw >= 2
  if (typeof raw === "string") return raw.trim().toLowerCase() === "nsfw"
  return false
}

export function parseAidokuIndex(raw: unknown, base: string): AidokuIndexParseResult {
  const entries: CatalogEntry[] = []
  const rejected: Array<{ index: number; reason: string }> = []
  const schema = aidokuIndexSchema(raw)
  if (!schema) {
    return { entries, rejected: [{ index: -1, reason: t("sources.aidoku.indexInvalid") }] }
  }

  const records: unknown[] = schema === "community" ? ((raw as { sources: unknown[] }).sources as unknown[]) : (raw as unknown[])
  const name = schema === "community" ? textOf((raw as { name?: unknown }).name) : undefined

  // zh-sources 的 `file` / `icon` 不帶子目錄：索引在 public/，檔案在 public/sources/ 與 public/icons/。
  const root = base.endsWith("/") ? base : base + "/"
  const targetDir = schema === "zh-sources" ? "sources/" : ""
  const iconDir = schema === "zh-sources" ? "icons/" : ""

  records.forEach((record, index) => {
    if (!record || typeof record !== "object") {
      rejected.push({ index, reason: t("sources.catalog.notObject") })
      return
    }
    const item = record as Record<string, unknown>
    const id = textOf(item.id)
    if (!id || !ID_PATTERN.test(id)) {
      rejected.push({ index, reason: t("sources.aidoku.indexBadId", { id: String(item.id ?? "") }) })
      return
    }
    const title = textOf(item.name)
    const version = textOf(item.version)
    const target = textOf(item.downloadURL ?? item.file ?? item.url)
    if (!title || !version || !target) {
      rejected.push({ index, reason: t("sources.aidoku.indexBadEntry") })
      return
    }
    const icon = textOf(item.iconURL ?? item.icon)
    entries.push({
      name: title,
      key: keyOf(id),
      version,
      url: resolveRelative(root + targetDir, target),
      iconUrl: icon ? resolveRelative(root + iconDir, icon) : undefined,
      languages: languagesOf(item),
      nsfw: nsfwOf(item),
      description: textOf(item.description),
    })
  })

  return { entries, rejected, name }
}
