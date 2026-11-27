import type { Cookie } from "./convert-types"
import { kv } from "./storage"

export type { Cookie }

const cache = new Map<string, Cookie[]>()
const PREFIX = "venera:cookies:"

function storageKey(sourceKey: string) {
  return PREFIX + sourceKey
}

function load(sourceKey: string): Cookie[] {
  const hit = cache.get(sourceKey)
  if (hit) return hit
  let list: Cookie[] = []
  try {
    const raw = kv.get(storageKey(sourceKey))
    if (Array.isArray(raw)) list = raw as Cookie[]
  } catch {
    list = []
  }
  cache.set(sourceKey, list)
  return list
}

function save(sourceKey: string, list: Cookie[]) {
  cache.set(sourceKey, list)
  try {
    kv.set(storageKey(sourceKey), list)
  } catch {
  }
}

export function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url)
  return m ? m[1].toLowerCase() : ""
}

export function bareHost(value: string): string {
  return String(value ?? "").replace(/:\d+$/, "").toLowerCase()
}

export function domainMatchesHost(domain: string, host: string): boolean {
  if (!domain) return true
  const d = bareHost(domain.replace(/^\./, ""))
  const h = bareHost(host)
  return h === d || h.endsWith("." + d)
}

function domainMatches(cookie: Cookie, host: string): boolean {
  return domainMatchesHost(cookie.domain, host)
}

export function getCookies(sourceKey: string, url: string): Cookie[] {
  const host = hostOf(url)
  return load(sourceKey).filter(c => domainMatches(c, host))
}

export function setCookies(sourceKey: string, url: string, cookies: Cookie[]) {
  const host = hostOf(url)
  const list = load(sourceKey).slice()
  for (const incoming of cookies ?? []) {
    if (!incoming?.name) continue
    const domain = incoming.domain || bareHost(host)
    const idx = list.findIndex(c => c.name === incoming.name && bareHost(c.domain) === domain)
    const next: Cookie = { name: incoming.name, value: incoming.value ?? "", domain }
    if (idx >= 0) list[idx] = next
    else list.push(next)
  }
  save(sourceKey, list)
}

export function deleteCookies(sourceKey: string, url: string) {
  const host = hostOf(url)
  save(
    sourceKey,
    load(sourceKey).filter(c => !domainMatches(c, host))
  )
}

export function cookieHeader(sourceKey: string, url: string): string {
  return getCookies(sourceKey, url)
    .map(c => `${c.name}=${c.value}`)
    .join("; ")
}

export function mergeCookieHeader(own: string | undefined, jar: string): string {
  const values = new Map<string, string>()
  for (const part of (own ?? "").split(";")) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    values.set(trimmed.slice(0, eq), trimmed.slice(eq + 1))
  }
  for (const part of jar.split(";")) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    values.set(trimmed.slice(0, eq), trimmed.slice(eq + 1))
  }
  return [...values].map(([name, value]) => `${name}=${value}`).join("; ")
}

interface SetCookie {
  name: string
  value: string
  domain: string | null
  expired: boolean
}

function parseSetCookie(header: string): SetCookie | null {
  const parts = String(header ?? "").split(";")
  const pair = (parts[0] ?? "").trim()
  const eq = pair.indexOf("=")
  if (eq <= 0) return null
  const name = pair.slice(0, eq).trim()
  if (!name) return null

  let domain: string | null = null
  let maxAge: number | null = null
  let expiresAt: number | null = null
  for (let index = 1; index < parts.length; index++) {
    const attr = parts[index]
    const cut = attr.indexOf("=")
    const key = (cut < 0 ? attr : attr.slice(0, cut)).trim().toLowerCase()
    const raw = cut < 0 ? "" : attr.slice(cut + 1).trim()
    if (key === "domain" && raw) domain = raw.replace(/^\./, "").toLowerCase()
    else if (key === "max-age") {
      const seconds = Number(raw)
      if (Number.isFinite(seconds)) maxAge = seconds
    } else if (key === "expires" && raw) {
      const at = Date.parse(raw)
      if (Number.isFinite(at)) expiresAt = at
    }
  }

  const expired = maxAge !== null ? maxAge <= 0 : expiresAt !== null ? expiresAt <= Date.now() : false
  return { name, value: pair.slice(eq + 1).trim(), domain, expired }
}

export function absorbSetCookieHeaders(sourceKey: string, url: string, headers: readonly string[]): void {
  if (!sourceKey || !headers || headers.length === 0) return
  const host = hostOf(url)
  if (!host) return
  const list = load(sourceKey).slice()
  let changed = false

  for (const header of headers) {
    const incoming = parseSetCookie(header)
    if (!incoming) continue
    if (incoming.domain && !domainMatchesHost(incoming.domain, host)) continue
    const domain = incoming.domain ?? bareHost(host)
    const index = list.findIndex(item => item.name === incoming.name && bareHost(item.domain) === domain)

    if (incoming.expired) {
      if (index >= 0) {
        list.splice(index, 1)
        changed = true
      }
      continue
    }
    if (index < 0) {
      list.push({ name: incoming.name, value: incoming.value, domain })
      changed = true
    } else if (list[index].value !== incoming.value || list[index].domain !== domain) {
      list[index] = { name: incoming.name, value: incoming.value, domain }
      changed = true
    }
  }

  if (changed) save(sourceKey, list)
}

export function absorbResponseCookies(sourceKey: string, url: string, response: { cookies?: any[] }) {
  const incoming = response?.cookies
  if (!Array.isArray(incoming) || incoming.length === 0) return
  const host = hostOf(url)
  setCookies(
    sourceKey,
    url,
    incoming.map(c => ({ name: c.name, value: c.value, domain: c.domain || host }))
  )
}

export function clearCookies(sourceKey: string) {
  save(sourceKey, [])
  authEpoch.set(sourceKey, authEpochOf(sourceKey) + 1)
}

const authEpoch = new Map<string, number>()

export function authEpochOf(sourceKey: string): number {
  return authEpoch.get(sourceKey) ?? 0
}
