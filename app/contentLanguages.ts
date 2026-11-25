// 內容語言：全 App 一份，決定瀏覽／搜尋看得到哪些 Mihon 子源、倉庫預設篩選與子源排序。
// 值放 Storage KV（`venera:*` 前綴），變更用 emitter 廣播；registry 收到後只重建 Mihon 子源。

import { createEmitter } from "../engine/emitter"
import { kv } from "../engine/storage"
import { getLocale, t } from "../i18n"
import { listRepositories } from "../sources/repository"
import { languageName } from "./languageNames"

export const CONTENT_LANGUAGES_KEY = "venera:contentLanguages"

const bus = createEmitter()

export const subscribeContentLanguages = bus.subscribe

export function appLanguageCode(): string {
  return getLocale().startsWith("zh") ? "zh" : "en"
}

export function repositoryLanguages(): string[] {
  const seen = new Set<string>()
  for (const repository of listRepositories()) {
    for (const entry of repository.entries) {
      for (const code of entry.languages ?? []) if (code) seen.add(code)
    }
  }
  return [...seen]
}

/**
 * 上游的預設：`all`、`en`、App 語言，再加上所有以 App 語言開頭的子語言
 * （zh 介面 → zh-Hans／zh-Hant／zh-TW／zh-CN／zh-HK／zh-tw…）。
 */
export function contentLanguageDefaults(languages: string[] = repositoryLanguages()): string[] {
  const base = appLanguageCode()
  const codes = ["all", "en", base]
  for (const code of languages) {
    if (code !== base && code.startsWith(base)) codes.push(code)
  }
  return codes.filter((code, index, list) => list.indexOf(code) === index)
}

export function defaultContentLanguages(): string[] {
  return contentLanguageDefaults()
}

function normalize(codes: unknown): string[] | null {
  if (!Array.isArray(codes)) return null
  const out: string[] = []
  for (const value of codes) {
    const code = typeof value === "string" ? value.trim() : ""
    if (code && !out.includes(code)) out.push(code)
  }
  return out.length > 0 ? out : null
}

export function getContentLanguages(): string[] {
  return normalize(kv.get(CONTENT_LANGUAGES_KEY)) ?? defaultContentLanguages()
}

export function setContentLanguages(codes: string[]): boolean {
  const next = normalize(codes)
  if (!next) return false
  const current = getContentLanguages()
  if (next.length === current.length && next.every((code, index) => code === current[index])) return false
  kv.set(CONTENT_LANGUAGES_KEY, next)
  bus.emit()
  return true
}

export function toggleContentLanguage(code: string): boolean {
  const current = getContentLanguages()
  const has = current.includes(code)
  if (has && current.length === 1) return false
  return setContentLanguages(has ? current.filter(value => value !== code) : [...current, code])
}

/**
 * 使用者還沒改過內容語言時，把倉庫裡的子語言一次加進來（上游在第一次拿到擴充清單時做）。
 * 寫入後就算「改過」，之後不再自動擴充。
 */
export function ensureContentLanguagesFromRepositories(): void {
  if (kv.get(CONTENT_LANGUAGES_KEY) !== undefined) return
  const defaults = contentLanguageDefaults()
  if (defaults.length === 0) return
  setContentLanguages(defaults)
}

export function isContentLanguage(code: string | undefined): boolean {
  return code !== undefined && getContentLanguages().includes(code)
}

export function contentLanguageName(code: string): string {
  return code === "all" ? t("settings.contentLanguage.multi") : languageName(code)
}

export function contentLanguagesDetail(codes: string[] = getContentLanguages()): string {
  const names = codes.map(contentLanguageName)
  if (names.length <= 2) return names.join("、")
  return `${names.slice(0, 2).join("、")} +${names.length - 2}`
}

export function contentLanguageOptions(candidates: string[] = []): string[] {
  const codes = new Set<string>(candidates)
  for (const code of defaultContentLanguages()) codes.add(code)
  for (const code of getContentLanguages()) codes.add(code)
  return [...codes]
}

const collator = new Intl.Collator(getLocale())

export function compareContentLanguage(a: string, b: string, selected: string[]): number {
  const rank = (code: string) => (code === "all" ? 0 : selected.includes(code) ? 1 : 2)
  const diff = rank(a) - rank(b)
  if (diff !== 0) return diff
  return collator.compare(contentLanguageName(a), contentLanguageName(b))
}
