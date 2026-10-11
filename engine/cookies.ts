// 每個源一份 cookie jar（Venera 是 App 共用一個 jar，我們按源隔離比較安全）。
// 持久化在 Storage，key 形如 `cookies:<sourceKey>`。

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
    // 持久化失敗不影響本次執行
  }
}

export function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url)
  return m ? m[1].toLowerCase() : ""
}

/** 網域比對：cookie domain 為空 → 視為通用；否則做後綴比對。port 不參與比對。 */
export function domainMatchesHost(domain: string, host: string): boolean {
  if (!domain) return true
  const d = domain.replace(/^\./, "").toLowerCase()
  const h = host.split(":")[0].toLowerCase()
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
    const domain = incoming.domain || host
    const idx = list.findIndex(c => c.name === incoming.name && c.domain === domain)
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

/** 送請求時用的 `Cookie:` 標頭值。 */
export function cookieHeader(sourceKey: string, url: string): string {
  return getCookies(sourceKey, url)
    .map(c => `${c.name}=${c.value}`)
    .join("; ")
}

/** 把回應的 Set-Cookie 收進 jar。 */
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
}
