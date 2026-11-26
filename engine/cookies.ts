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

/** cookie 的 domain 不帶 port，`hostOf` 抓下來的 host 帶（loopback 就是這樣），比對前先拿掉。 */
export function bareHost(value: string): string {
  return String(value ?? "").replace(/:\d+$/, "").toLowerCase()
}

/** 網域比對：cookie domain 為空 → 視為通用；否則做後綴比對。port 不參與比對。 */
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

/** 送請求時用的 `Cookie:` 標頭值。 */
export function cookieHeader(sourceKey: string, url: string): string {
  return getCookies(sourceKey, url)
    .map(c => `${c.name}=${c.value}`)
    .join("; ")
}

/**
 * 把 jar 的 cookie 疊到請求自己的 `Cookie` 上；同名時 jar 優先——
 * jar 只有過盾登入會寫，比源存在設定裡的陳舊值新。
 */
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

/**
 * 一筆 `Set-Cookie`（RFC 6265 的單一標頭值）只取 jar 用得到的三件事：`name=value`、Domain、到期。
 * Path／Secure 不進 jar：jar 不分路徑、也不區分 http／https。上游（HTTPCookieStorage）兩者都分，
 * 但靠它們區分的源幾乎不存在，先不收。
 */
interface SetCookie {
  name: string
  value: string
  /** `Domain=` 給的網域（已去前導點、小寫）；沒給就是 null。 */
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

  // RFC 6265：兩個都給時 Max-Age 優先（`sid=; Max-Age=0; Expires=<未來>` 是刪除）。
  const expired = maxAge !== null ? maxAge <= 0 : expiresAt !== null ? expiresAt <= Date.now() : false
  return { name, value: pair.slice(eq + 1).trim(), domain, expired }
}

/**
 * 把回應的 `Set-Cookie`（一個標頭值一筆）收進 jar。
 * 代理層是唯一讀得到 `Set-Cookie` 的地方（XHR 依規範會濾掉），所以 jar 的寫入都在這裡；
 * 下一個請求由 `performProxy` 的 jar 合併自動帶上，worker 不必自己記。
 * 內容沒變就不寫 Storage：站方幾乎每個回應都發 cookie，跟著寫會白白吃 I/O。
 */
export function absorbSetCookieHeaders(sourceKey: string, url: string, headers: readonly string[]): void {
  if (!sourceKey || !headers || headers.length === 0) return
  const host = hostOf(url)
  if (!host) return
  const list = load(sourceKey).slice()
  let changed = false

  for (const header of headers) {
    const incoming = parseSetCookie(header)
    if (!incoming) continue
    // Domain 蓋不住回應的 host 就是別人的 cookie（瀏覽器也丟掉），不要收進這個源的 jar。
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

/** 把回應的 Set-Cookie 收進 jar（Venera 的 HTTP 層給的是已拆好的 cookie 物件）。 */
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
  // 登入態變了：GET 快取鍵帶著這個版號，舊的登入／登出前回應不會再被回。
  authEpoch.set(sourceKey, authEpochOf(sourceKey) + 1)
}

/** 登入態的版號（登出就 +1）；`engine/http` 的快取鍵帶著它。 */
const authEpoch = new Map<string, number>()

export function authEpochOf(sourceKey: string): number {
  return authEpoch.get(sourceKey) ?? 0
}
