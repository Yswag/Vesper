import { fetch, type AbortSignal } from "scripting"

import { absorbResponseCookies, authEpochOf, cookieHeader, mergeCookieHeader } from "./cookies"
import { isCloudflareChallenge, solveCloudflare } from "./cloudflare"
import { log } from "./log"

export const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  body: string
}

export interface HttpBytesResponse {
  status: number
  headers: Record<string, string>
  body: ArrayBuffer
}

const WINDOW_MS = 10000
const SAME_URL_LIMIT = 8
const TOTAL_LIMIT = 200
const requestHits = new Map<string, Map<string, number[]>>()
const lastSeen = new Map<string, number>()

function guardRunaway(sourceKey: string, url: string): () => void {
  const now = Date.now()

  for (const [key, seen] of lastSeen) {
    if (now - seen >= WINDOW_MS) {
      requestHits.delete(key)
      lastSeen.delete(key)
    }
  }
  lastSeen.set(sourceKey, now)

  let byUrl = requestHits.get(sourceKey)
  if (!byUrl) {
    byUrl = new Map()
    requestHits.set(sourceKey, byUrl)
  }

  let total = 0
  for (const [key, times] of byUrl) {
    const kept = times.filter(time => now - time < WINDOW_MS)
    if (kept.length === 0) byUrl.delete(key)
    else {
      byUrl.set(key, kept)
      total += kept.length
    }
  }

  const times = byUrl.get(url) ?? []
  times.push(now)
  byUrl.set(url, times)
  total += 1

  const undo = () => {
    const current = requestHits.get(sourceKey)?.get(url)
    if (!current) return
    const index = current.lastIndexOf(now)
    if (index >= 0) current.splice(index, 1)
  }

  if (times.length > SAME_URL_LIMIT || total > TOTAL_LIMIT) {
    if (times.length === SAME_URL_LIMIT + 1 || total === TOTAL_LIMIT + 1) {
      log(
        "error",
        "http",
        `${sourceKey} 在 ${WINDOW_MS / 1000} 秒內重複請求同一個網址 ${times.length} 次（共 ${total} 次），已中止（源可能有重試迴圈）`
      )
    }
    throw new Error(`${sourceKey} 重複請求同一個網址，已中止（源可能有無限重試迴圈）`)
  }
  return undo
}

export function runawayTableSnapshot(): Record<string, number> {
  const snapshot: Record<string, number> = {}
  for (const [key, byUrl] of requestHits) {
    let total = 0
    for (const times of byUrl.values()) total += times.length
    snapshot[key] = total
  }
  return snapshot
}

const OPTION_KEYS = new Set([
  "method",
  "data",
  "body",
  "timeout",
  "encoding",
  "redirect",
  "allowInsecureRequest",
  "http_client",
  "cache-time",
  "prevent-parallel",
  "headers",
])

export interface RequestOptions {
  method?: string
  data?: unknown
  extra?: Record<string, unknown>
  timeout?: number
}

export function normalizeHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== "object") return out
  const source = raw as Record<string, unknown>
  const nested = source.headers
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    for (const [k, v] of Object.entries(nested as Record<string, unknown>)) {
      if (OPTION_KEYS.has(k)) continue
      if (v != null) out[k] = String(v)
    }
  }
  for (const [k, v] of Object.entries(source)) {
    if (OPTION_KEYS.has(k)) continue
    if (v != null) out[k] = String(v)
  }
  return out
}

function lowerCaseKeys(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v
  return out
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase()
  return Object.keys(headers).some(k => k.toLowerCase() === lower)
}

function encodeBody(data: unknown, headers: Record<string, string>): any {
  if (data == null) return undefined
  if (typeof data === "string") return data
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return data
  if (ArrayBuffer.isView(data)) return new Uint8Array((data as ArrayBufferView).buffer)
  if (typeof data === "object") {
    if (!hasHeader(headers, "content-type")) headers["content-type"] = "application/json"
    return JSON.stringify(data)
  }
  return String(data)
}


const RESPONSE_CACHE_MAX_BYTES = 10 * 1024 * 1024
const CACHE_TTL_SHORT = 5000
const CACHE_TTL_LONG = 6 * 60 * 60 * 1000
const VOLATILE_HEADERS = new Set(["cookie", "authorization"])

interface CachedResponse {
  status: number
  headers: Record<string, string>
  body: string
  time: number
  size: number
}

const responseCache = new Map<string, CachedResponse>()
let responseCacheBytes = 0

function responseKey(sourceKey: string, url: string, headers: Record<string, string>): string {
  const stable = Object.keys(headers)
    .filter(name => !VOLATILE_HEADERS.has(name.toLowerCase()))
    .sort()
    .map(name => `${name.toLowerCase()}:${headers[name]}`)
    .join("\n")
  return `${sourceKey}#${authEpochOf(sourceKey)}\n${url}\n${stable}`
}

function dropCached(key: string) {
  const hit = responseCache.get(key)
  if (!hit) return
  responseCache.delete(key)
  responseCacheBytes -= hit.size
}

function readCached(key: string, cacheTime: string | null, url: string): HttpResponse | null {
  const hit = responseCache.get(key)
  if (!hit) return null
  const ttl = cacheTime === "long" ? CACHE_TTL_LONG : CACHE_TTL_SHORT
  if (Date.now() - hit.time >= ttl) return null
  responseCache.delete(key)
  responseCache.set(key, hit)
  log("debug", "http", `GET 快取命中 ${shortUrl(url)}`)
  return { status: hit.status, headers: { ...hit.headers }, body: hit.body }
}

function storeCached(key: string, response: { status: number; headers: Record<string, string>; body: string }) {
  if (response.status < 200 || response.status >= 300) return
  const size = response.body.length
  dropCached(key)
  if (size > RESPONSE_CACHE_MAX_BYTES) return
  while (responseCacheBytes + size > RESPONSE_CACHE_MAX_BYTES && responseCache.size > 0) {
    const oldest = responseCache.keys().next().value
    if (oldest === undefined) break
    dropCached(oldest)
  }
  responseCache.set(key, {
    status: response.status,
    headers: response.headers,
    body: response.body,
    time: Date.now(),
    size,
  })
  responseCacheBytes += size
}

export function clearResponseCache() {
  responseCache.clear()
  responseCacheBytes = 0
}

const serialTails = new Map<string, Promise<void>>()

function acquireSerial(slot: string): Promise<() => void> {
  const previous = serialTails.get(slot)
  let release!: () => void
  const gate = new Promise<void>(resolve => (release = resolve))
  serialTails.set(slot, gate)
  return (async () => {
    if (previous) {
      try {
        await previous
      } catch {
      }
    }
    return () => {
      if (serialTails.get(slot) === gate) serialTails.delete(slot)
      release()
    }
  })()
}

async function perform(
  sourceKey: string,
  url: string,
  options: RequestOptions,
  asBytes: boolean,
  signal?: AbortSignal,
  fromSource = true
): Promise<any> {
  if (!url || typeof url !== "string") {
    throw new Error(`Network: 空的 URL（${options.method ?? "GET"}）`)
  }
  const method = (options.method ?? "GET").toUpperCase()
  const extra = (options.extra ?? {}) as Record<string, unknown>
  const headers = normalizeHeaders(extra.headers ?? {})

  if (!hasHeader(headers, "user-agent")) headers["user-agent"] = WEB_UA

  const cookie = cookieHeader(sourceKey, url)
  if (cookie) {
    const existing = Object.keys(headers).find(name => name.toLowerCase() === "cookie")
    if (existing) headers[existing] = mergeCookieHeader(headers[existing], cookie)
    else headers["cookie"] = cookie
  }

  const body = method === "GET" || method === "HEAD" ? undefined : encodeBody(extra.data, headers)

  const cacheTime = typeof extra["cache-time"] === "string" ? (extra["cache-time"] as string) : null
  const serial = extra["prevent-parallel"] === true || extra["prevent-parallel"] === "true"
  const cacheKey = fromSource && !asBytes && method === "GET" ? responseKey(sourceKey, url, headers) : ""
  if (cacheKey) {
    if (cacheTime === "no") dropCached(cacheKey)
    else {
      const cached = readCached(cacheKey, cacheTime, url)
      if (cached) return cached
    }
  }

  const undo = fromSource ? guardRunaway(sourceKey, url) : null
  const release = serial ? await acquireSerial(`${sourceKey}\n${url}`) : null

  const started = Date.now()
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      timeout: typeof extra.timeout === "number" ? extra.timeout : 30,
      allowInsecureRequest: true,
      signal,
    })
    absorbResponseCookies(sourceKey, url, response as any)

    const result = {
      status: response.status,
      headers: lowerCaseKeys(headersToObject(response.headers)),
      body: asBytes ? await response.arrayBuffer() : await response.text(),
    }
    log("debug", "http", `${method} ${shortUrl(url)} → ${result.status} (${Date.now() - started}ms)`)

    if (fromSource && !asBytes && isCloudflareChallenge(result.status, result.headers, result.body)) {
      log("info", "http", `偵測到 Cloudflare 挑戰 (${result.status}): ${shortUrl(url)}，嘗試自動過盾`)
      undo?.()
      const targetUa = headers["user-agent"] || WEB_UA
      await solveCloudflare(sourceKey, url, targetUa)

      log("info", "http", `過盾成功，重新發送請求: ${shortUrl(url)}`)
      const freshCookie = cookieHeader(sourceKey, url)
      const retryHeaders = { ...headers }
      if (freshCookie) retryHeaders["cookie"] = freshCookie
      const retryResponse = await fetch(url, {
        method,
        headers: retryHeaders,
        body,
        timeout: typeof extra.timeout === "number" ? extra.timeout : 30,
        allowInsecureRequest: true,
        signal,
      })
      absorbResponseCookies(sourceKey, url, retryResponse as any)
      const retried = {
        status: retryResponse.status,
        headers: lowerCaseKeys(headersToObject(retryResponse.headers)),
        body: await retryResponse.text(),
      }
      if (cacheKey) storeCached(cacheKey, retried)
      return retried
    }

    if (cacheKey && typeof result.body === "string") storeCached(cacheKey, { ...result, body: result.body })
    return result
  } catch (error) {
    if (isAbortError(error)) {
      undo?.()
    }
    throw error
  } finally {
    release?.()
  }
}

export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError"
}

function headersToObject(headers: any): Record<string, string> {
  if (!headers) return {}
  if (typeof headers.toJson === "function") {
    try {
      return headers.toJson()
    } catch {
      return {}
    }
  }
  const out: Record<string, string> = {}
  if (typeof headers.forEach === "function") {
    headers.forEach((value: string, key: string) => {
      out[key] = value
    })
  }
  return out
}

function shortUrl(url: string): string {
  return url.length > 90 ? url.slice(0, 90) + "…" : url
}

export function requestText(
  sourceKey: string,
  method: string,
  url: string,
  headers?: unknown,
  data?: unknown,
  extra?: Record<string, unknown>,
  signal?: AbortSignal
): Promise<HttpResponse> {
  return perform(sourceKey, url, { method, extra: { ...extra, headers: headers ?? extra?.headers, data: data ?? extra?.data } }, false, signal)
}

export function requestBytes(
  sourceKey: string,
  method: string,
  url: string,
  headers?: unknown,
  data?: unknown,
  extra?: Record<string, unknown>,
  signal?: AbortSignal
): Promise<HttpBytesResponse> {
  return perform(sourceKey, url, { method, extra: { ...extra, headers: headers ?? extra?.headers, data: data ?? extra?.data } }, true, signal)
}

export function fetchImageBytes(
  url: string,
  headers: Record<string, string>,
  sourceKey: string,
  signal?: AbortSignal
): Promise<HttpBytesResponse> {
  return perform(sourceKey, url, { method: "GET", extra: { headers } }, true, signal, false)
}
