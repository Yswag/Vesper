import { bareHost, domainMatchesHost, hostOf } from "../engine/cookies"
import { exists, join, readText, remove, writeText } from "../engine/fs"

export type MihonJar = Record<string, Record<string, string>>

const FILE = "cookies.json"

const saved = new Map<string, string>()

export function normalizeJar(raw: unknown): MihonJar {
  const jar: MihonJar = {}
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return jar
  for (const [scope, values] of Object.entries(raw as Record<string, unknown>)) {
    if (!scope || !values || typeof values !== "object" || Array.isArray(values)) continue
    const entries: Record<string, string> = {}
    for (const [name, value] of Object.entries(values as Record<string, unknown>)) {
      if (name && typeof value === "string") entries[name] = value
    }
    if (Object.keys(entries).length > 0) jar[scope] = entries
  }
  return jar
}

export function isEmptyJar(jar: MihonJar): boolean {
  return Object.keys(jar).length === 0
}

function scopeMatches(scope: string, host: string): boolean {
  if (!host) return false
  return scope.startsWith(".") ? domainMatchesHost(scope, host) : bareHost(scope) === host
}

export function jarWithoutUrl(jar: MihonJar, url: string): { jar: MihonJar; removed: number } {
  const host = bareHost(hostOf(url))
  const next: MihonJar = {}
  let removed = 0
  for (const [scope, values] of Object.entries(jar)) {
    if (scopeMatches(scope, host)) removed += Object.keys(values).length
    else next[scope] = values
  }
  return { jar: next, removed }
}

export function jarCookiesFor(jar: MihonJar, url: string): { scope: string; name: string; value: string }[] {
  const host = bareHost(hostOf(url))
  const out: { scope: string; name: string; value: string }[] = []
  for (const [scope, values] of Object.entries(jar)) {
    if (!scopeMatches(scope, host)) continue
    for (const [name, value] of Object.entries(values)) out.push({ scope, name, value })
  }
  return out
}

export function loadJar(dir: string): MihonJar {
  let raw: unknown = null
  try {
    raw = JSON.parse(readText(join(dir, FILE)) ?? "null")
  } catch {
    raw = null
  }
  const jar = normalizeJar(raw)
  saved.set(dir, JSON.stringify(jar))
  return jar
}

export function saveJar(dir: string, jar: MihonJar): boolean {
  const serialized = JSON.stringify(jar)
  if (saved.get(dir) === serialized || !exists(dir)) return false
  const path = join(dir, FILE)
  if (isEmptyJar(jar)) {
    if (exists(path)) remove(path)
  } else writeText(path, serialized)
  saved.set(dir, serialized)
  return true
}

export function forgetJar(dir: string): void {
  saved.delete(dir)
}
