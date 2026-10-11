// 統一的 HTTP 出口。Venera 的 http host method 對應這裡。
// 關鍵契約：4xx/5xx 不拋錯（源自己檢查 status）；headers 一律小寫化；
// 源沒給 User-Agent 就補一個 web UA；自動附上該源的 cookie。

import { fetch, type AbortSignal } from "scripting"

import { absorbResponseCookies, cookieHeader } from "./cookies"
import { isCloudflareChallenge, solveCloudflare } from "./cloudflare"
import { log } from "./log"

// 對齊 Venera 的 webUA（lib/foundation/consts.dart）：
// 源若沒有提供 User-Agent，預設填入桌面版 Windows Chrome UA，避免站方自動切成手機版 HTML 導致 DOM 解析失敗。
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
  /** 必須是 ArrayBuffer：源會直接 `new DataView(res.body)`。 */
  body: ArrayBuffer
}

// ------------------------------------------------------------------ 失控防護
//
// 源有可能自己寫出無限重試迴圈（實際案例：comic_walker 的 refreshToken → request
// → 看到錯誤碼又呼叫 refreshToken，同一個 POST 每秒打兩次）。JS 沒辦法從外面殺掉一條
// promise 鏈，所以改成在出口擋：**同一個 URL 短時間內重複太多次**就拋錯——
// 迴圈會因為例外而解開，也不再打人家的伺服器。
//
// 為什麼不看「總次數」：有些源（hitomi）正常探索就會在幾秒內發幾十個「不同」的請求
// （索引分段抓取），用總次數會誤殺正常行為。重複同一個 URL 才是迴圈的指紋。
// 圖片不納入計算（由 UI 驅動，一章可能同時幾十張）。
//
// 回傳的 `undo` 給**被取消的請求**用：取消不是重試，取消後立刻重送同一個 URL 是正常行為，
// 不撤銷就會被當成迴圈（見 perform 的說明）。
const WINDOW_MS = 10000
const SAME_URL_LIMIT = 8
const TOTAL_LIMIT = 200
const requestHits = new Map<string, Map<string, number[]>>()
// 每個源最後一次發請求的時間。requestHits 只會在「同一個源下次發請求」時被 prune，所以一個之後
// 不再被使用的源，它的表就再也沒人清——記下時間，讓後來的請求順手把它掃掉（見 guardRunaway）。
const lastSeen = new Map<string, number>()

function guardRunaway(sourceKey: string, url: string): () => void {
  const now = Date.now()

  // 視窗內都沒再動過的源，整張表直接刪掉。它每一筆都已超過視窗（下面那圈本來就會濾掉），
  // 所以這是在清殘留，不是在改判定。
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

/**
 * 探針用：失控防護表目前還記著哪些源、各幾次（驗「不再被使用的源不會殘留」）。
 * 只看殘留、不做 prune——斷言的判準就是「表裡還有沒有這個源」。
 */
export function runawayTableSnapshot(): Record<string, number> {
  const snapshot: Record<string, number> = {}
  for (const [key, byUrl] of requestHits) {
    let total = 0
    for (const times of byUrl.values()) total += times.length
    snapshot[key] = total
  }
  return snapshot
}

/** extra 裡這些鍵是「選項」不是 header。 */
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

/**
 * 源的 headers 參數有兩種寫法：扁平的 header map，或 `{headers: {...}}` 再包一層。
 * 兩種都要吃，否則整組 UA/Referer 會變成一個叫 headers 的 header 送出去。
 */
export function normalizeHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== "object") return out
  const source = raw as Record<string, unknown>
  const nested = source.headers
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    // 包一層的寫法也要過濾選項，不然 `{"headers": {"http_client": …}}` 會把它當真的 header 送出去。
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

async function perform(
  sourceKey: string,
  url: string,
  options: RequestOptions,
  asBytes: boolean,
  signal?: AbortSignal,
  fromSource = true
): Promise<any> {
  const undo = fromSource ? guardRunaway(sourceKey, url) : null
  if (!url || typeof url !== "string") {
    // fetch("") 會永久 hang，必須在這裡擋掉。
    throw new Error(`Network: 空的 URL（${options.method ?? "GET"}）`)
  }
  const method = (options.method ?? "GET").toUpperCase()
  const extra = (options.extra ?? {}) as Record<string, unknown>
  const headers = normalizeHeaders(extra.headers ?? {})

  if (!hasHeader(headers, "user-agent")) headers["user-agent"] = WEB_UA

  const cookie = cookieHeader(sourceKey, url)
  if (cookie && !hasHeader(headers, "cookie")) headers["cookie"] = cookie

  const body = method === "GET" || method === "HEAD" ? undefined : encodeBody(extra.data, headers)

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

    // 只有來自源的非二進位請求（API / HTML 等文字請求）才觸發自動過盾，圖片下載不彈窗
    if (fromSource && !asBytes && isCloudflareChallenge(result.status, result.headers, result.body)) {
      log("info", "http", `偵測到 Cloudflare 挑戰 (${result.status}): ${shortUrl(url)}，嘗試自動過盾`)
      // 撤銷被攔截的那次計數，避免重試算入 runaway guard 觸發限制
      undo?.()
      const targetUa = headers["user-agent"] || WEB_UA
      await solveCloudflare(sourceKey, url, targetUa)

      // 過盾成功，重新構建 headers 並重新發送原始請求
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
      return {
        status: retryResponse.status,
        headers: lowerCaseKeys(headersToObject(retryResponse.headers)),
        body: await retryResponse.text(),
      }
    }

    return result
  } catch (error) {
    if (isAbortError(error)) {
      // 取消是正常結束，不是失敗：撤銷這一次的計數（不然「取消後立刻重送同一個 URL」會被
      // 當成重試迴圈而拋錯），也不留下任何日誌——Log 頁不該被取消洗版。
      undo?.()
    }
    throw error
  }
}

/**
 * 取消的唯一判定方式。這個 runtime 沒有 `AbortError` class（`instanceof` 用不上），
 * `fetch` 被 abort 時丟出的是一個 name 為 "AbortError" 的 DOMException。
 */
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

/** 圖片管線用：帶自訂 header 抓位元組。不納入失控防護（由 UI 驅動，一章可能幾十張）。 */
export function fetchImageBytes(
  url: string,
  headers: Record<string, string>,
  sourceKey: string,
  signal?: AbortSignal
): Promise<HttpBytesResponse> {
  return perform(sourceKey, url, { method: "GET", extra: { headers } }, true, signal, false)
}
