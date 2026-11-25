// 倉庫條目的篩選與分組：搜尋字串、語言集合、只看已安裝／可更新、隱藏不支援 ext-lib、隱藏 R18。
// 純函式，畫面只拿結果排版；每個條目只會落在一組（組筆數加起來就是篩選後的總數）。

import { getLocale } from "../i18n"

import { entryUnsupportedReason, type RepositoryEntryStatus } from "./registry"

export interface RepositoryFilter {
  query: string
  languages: string[]
  installedOnly: boolean
  updatableOnly: boolean
  hideUnsupported: boolean
  hideNsfw: boolean
}

export interface RepositoryFilterGroup {
  language: string
  items: RepositoryEntryStatus[]
}

export interface RepositoryFilterResult {
  groups: RepositoryFilterGroup[]
  shown: number
  total: number
}

export function defaultRepositoryFilter(languages: string[]): RepositoryFilter {
  return {
    query: "",
    languages: [...languages],
    installedOnly: false,
    updatableOnly: false,
    hideUnsupported: false,
    hideNsfw: false,
  }
}

export function isRepositoryFilterActive(filter: RepositoryFilter, defaults: string[]): boolean {
  return (
    filter.query.trim().length > 0 ||
    filter.installedOnly ||
    filter.updatableOnly ||
    filter.hideUnsupported ||
    filter.hideNsfw
  )
}

const collator = new Intl.Collator(getLocale())

function displayName(code: string): string {
  try {
    return new Intl.DisplayNames([getLocale()], { type: "language" }).of(code) || code
  } catch {
    return code
  }
}

function languageRank(code: string, preferred: string[]): number {
  if (code === "") return 3
  if (code === "all") return 0
  return preferred.includes(code) ? 1 : 2
}

function compareLanguage(a: string, b: string, preferred: string[]): number {
  const diff = languageRank(a, preferred) - languageRank(b, preferred)
  if (diff !== 0) return diff
  return collator.compare(displayName(a), displayName(b))
}

function primaryLanguage(entry: RepositoryEntryStatus, preferred: string[]): string {
  const languages = [...new Set((entry.entry.languages ?? []).filter(Boolean))]
  if (languages.length === 0) return ""
  return languages.length === 1 ? languages[0] : "all"
}

function matchesQuery(entry: RepositoryEntryStatus, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return true
  return (
    entry.entry.name.toLowerCase().includes(needle) || entry.entry.key.toLowerCase().includes(needle)
  )
}

function matchesLanguages(entry: RepositoryEntryStatus, languages: string[]): boolean {
  if (languages.length === 0) return true
  const supported = entry.entry.languages ?? []
  if (supported.length === 0) return true
  return supported.some(code => languages.includes(code))
}

export function filterRepositoryEntries(
  entries: RepositoryEntryStatus[],
  filter: RepositoryFilter,
  preferred: string[]
): RepositoryFilterResult {
  const buckets = new Map<string, RepositoryEntryStatus[]>()
  let shown = 0
  for (const entry of entries) {
    if (!matchesQuery(entry, filter.query)) continue
    if (!matchesLanguages(entry, filter.languages)) continue
    if (filter.installedOnly && !entry.installed) continue
    if (filter.updatableOnly && !entry.updateAvailable) continue
    if (filter.hideUnsupported && entryUnsupportedReason(entry.entry)) continue
    if (filter.hideNsfw && entry.entry.nsfw) continue
    const language = primaryLanguage(entry, preferred)
    const bucket = buckets.get(language)
    if (bucket) bucket.push(entry)
    else buckets.set(language, [entry])
    shown += 1
  }

  const groups = [...buckets.entries()]
    .map(([language, items]) => ({ language, items }))
    .sort((a, b) => compareLanguage(a.language, b.language, preferred))

  return { groups, shown, total: entries.length }
}
