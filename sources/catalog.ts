import { t } from "../i18n"

export interface CatalogEntry {
  name: string
  key: string
  version: string
  url?: string
  fileName?: string
  description?: string
  iconUrl?: string
  languages?: string[]
  nsfw?: boolean
  extensionLib?: string
}

export interface CatalogParseResult {
  entries: CatalogEntry[]
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

export function indexUrlOf(url: string): string {
  return url.endsWith("/") ? url + "index.json" : url
}

export function compareVersion(a: string, b: string): number {
  const norm = (value: string) => value.split(/[.\-]/).slice(0, 3).map(part => parseInt(part, 10) || 0)
  const left = norm(a)
  const right = norm(b)
  for (let i = 0; i < 3; i++) {
    if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0)
  }
  return 0
}
