// 倉庫索引：Venera 的格式是一份 JSON 陣列，每筆一個源。
// 驗證規則照 Venera 的 source_repositories.dart::parseCatalog（逐條不合法就跳過並彙總提示）。

import { t } from "../i18n"

export interface CatalogEntry {
  name: string
  key: string
  version: string
  /** 相對路徑以索引檔的最終 URL 為基準解析。 */
  url?: string
  fileName?: string
  description?: string
  /** Aidoku 索引才有：圖示（已對索引 base 解成絕對網址）。 */
  iconUrl?: string
  /** Aidoku 索引才有：源支援的語言。 */
  languages?: string[]
  /** Aidoku 索引才有：R18 標記（community 的 contentRating／zh-sources 的 nsfw）。 */
  nsfw?: boolean
}

export interface CatalogParseResult {
  entries: CatalogEntry[]
  /** 被跳過的條目與原因。 */
  rejected: Array<{ index: number; reason: string }>
}

const KEY_PATTERN = /^\w+$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[.\-].+)?$/

export function parseCatalog(raw: unknown): CatalogParseResult {
  const entries: CatalogEntry[] = []
  const rejected: Array<{ index: number; reason: string }> = []
  if (!Array.isArray(raw)) {
    return { entries, rejected: [{ index: -1, reason: t("sources.catalog.notArray") }] }
  }

  raw.forEach((record, index) => {
    if (!record || typeof record !== "object") {
      rejected.push({ index, reason: t("sources.catalog.notObject") })
      return
    }
    const item = record as Record<string, unknown>
    const name = item.name
    const key = item.key
    const version = item.version
    const url = typeof item.url === "string" && item.url.length > 0 ? item.url : undefined
    const fileName = typeof item.fileName === "string" && item.fileName.length > 0 ? item.fileName : undefined

    if (typeof name !== "string" || typeof version !== "string" || typeof key !== "string") {
      rejected.push({ index, reason: t("sources.catalog.badFields") })
      return
    }
    if (!KEY_PATTERN.test(key)) {
      rejected.push({ index, reason: t("sources.catalog.badKey", { key }) })
      return
    }
    if (!VERSION_PATTERN.test(version)) {
      rejected.push({ index, reason: t("sources.catalog.badVersion", { version }) })
      return
    }
    if (!url && !fileName) {
      rejected.push({ index, reason: t("sources.catalog.noTarget") })
      return
    }
    entries.push({
      name,
      key,
      version,
      url,
      fileName,
      description: typeof item.description === "string" ? item.description : undefined,
    })
  })

  return { entries, rejected }
}

/** 相對路徑以 base 為基準解析（Venera 用最終回應 URL，我們用請求 URL）。 */
export function resolveEntryUrl(entry: CatalogEntry, base: string): string {
  if (entry.url) return entry.url
  return resolveRelative(base, entry.fileName ?? "")
}

export function resolveRelative(base: string, target: string): string {
  if (/^https?:\/\//i.test(target)) return target
  if (target.startsWith("//")) return "https:" + target
  const trimmed = base.endsWith("/") ? base : base.replace(/[^/]*$/, "")
  return trimmed + target.replace(/^\.?\//, "")
}

export function catalogBaseOf(url: string): string {
  return url.endsWith("/") ? url : url.replace(/[^/]*$/, "")
}

/** 目錄形式的索引網址（結尾 `/`）補上 `index.json`；Aidoku 的索引常以目錄網址分享。 */
export function indexUrlOf(url: string): string {
  return url.endsWith("/") ? url + "index.json" : url
}

/** `1.2.0` vs `1.10.0`：Venera 用自製規則（比前 3 段整數）。 */
export function compareVersion(a: string, b: string): number {
  const norm = (value: string) => value.split(/[.\-]/).slice(0, 3).map(part => parseInt(part, 10) || 0)
  const left = norm(a)
  const right = norm(b)
  for (let i = 0; i < 3; i++) {
    if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0)
  }
  return 0
}
