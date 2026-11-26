// 源宿主（Aidoku／Mihon）：本機 HttpServer 服務頁面與 runtime，WebView 內每個源一個 module worker。
// 與超分分開：各自的 server 與 WebView（超分頁面需要 COOP/COEP，這裡不需要）。
//
// 生命週期：第一次用到才開 → 常駐 → 閒置逾時 dispose。每個源一條隊列（同一個源序列，不同源並行）；
// 頁面層級的動作（建頁、重建、dispose）會先等所有源的隊列排空，所以不會拆在請求中間。
// 隊列分兩級：使用者在等的（詳情、翻頁）排在背景追更前面；只在任務邊界讓位，跑起來的不會被中斷。

import { Script, fetch } from "scripting"

import { absorbSetCookieHeaders, cookieHeader, mergeCookieHeader } from "../cookies"
import { Convert } from "../convert"
import { join, readBytes } from "../fs"
import { log } from "../log"
import { requirePro } from "../pro"
import { isCloudflareChallenge } from "../cloudflareDetect"
import { dexvmAssets } from "../mihon/dexvm"
import { mihonUserAgent } from "../mihon/network"
import { timerAfter, timerEvery, type TimerHandle } from "../timers"

const CALL_TIMEOUT_MS = 15_000
const LOAD_TIMEOUT_MS = 30_000
const PROXY_TIMEOUT_MS = 15_000
/** 把工作丟進頁面這一步的逾時：頁面死了就不該等到呼叫本身的逾時。 */
const START_TIMEOUT_MS = 5_000
const IMAGE_TIMEOUT_MS = 30_000
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000
/** 同時最多幾個源的 worker（對齊 Aidoku 原版的 maxConcurrentTasks）。 */
const WORKER_LIMIT = 3

/**
 * worker 的種類：同一個宿主、同一套隊列與上限，差別只在載入時用哪個 worker 腳本。
 * 一個 apk（Mihon）一個 worker；Aidoku 是一個源一個 worker。
 */
export type SourceWorkerKind = "aidoku" | "mihon"

/** 宿主這一層壞掉（頁面沒了、伺服器起不來）。呼叫端據此重建整個宿主再重試。 */
export class SourceHostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SourceHostError"
  }
}

/** 只有某個源的 worker 壞了／逾時：丟掉它就夠了，其他源與頁面不受影響。 */
export class SourceWorkerError extends SourceHostError {
  constructor(message: string) {
    super(message)
    this.name = "SourceWorkerError"
  }
}

export function isSourceHostError(error: unknown): boolean {
  return error instanceof SourceHostError
}

/** 這個源自己的 worker 掛了（而不是頁面沒了）。 */
export function isSourceWorkerError(error: unknown): boolean {
  return error instanceof SourceWorkerError
}

function hostError(error: unknown): SourceHostError {
  if (error instanceof SourceHostError) return error
  return new SourceHostError(error instanceof Error ? error.message : String(error ?? ""))
}

let nextTaskId = 1
const taskWaiters = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()

/** 一張等待 `process_page_image` 的圖片：位元組只給一次，結果由 POST 帶回來。 */
interface PageJob {
  bytes: Uint8Array | null
  served: boolean
  resolve: (bytes: Uint8Array) => void
  reject: (error: Error) => void
  timer: number | null
}

const pageJobs = new Map<string, PageJob>()
let nextPageJobId = 1
let pageJobTotal = 0
const DROPPED_REQUEST_HEADERS = new Set(["host", "content-length", "connection", "accept-encoding"])

let server: HttpServer | null = null
let controller: WebViewController | null = null
let port = 0
/** 頁面上有哪些源的 worker（一個源一個）。 */
interface WorkerSlot {
  key: string
  lastUsed: number
}

const slots = new Map<string, WorkerSlot>()
/**
 * 每個源手上的呼叫數（執行中＋排隊中）：>0 就不能回收。
 * 刻意與 `slots` 分開：重建頁面會清 `slots`，但計數必須跟著還在跑的呼叫。
 */
const pendingCounts = new Map<string, number>()
/** 哪些源的 worker 真的載好了（重載判斷用；回收或 dispose 之後消失）。 */
const loadedKeys = new Set<string>()
/**
 * 每個源的 worker 還有幾個背景 job（dexvm 的 GlobalScope.launch）。
 * 回收時有 job 的排在最後：丟掉就得丟掉那些 job，能留就留。
 */
const pendingJobs = new Map<string, number>()
/** 載入中的源：載入期間源就可能寫設定，這時 loadedKeys 裡還不是它。 */
const loadingKeys = new Set<string>()
/** 還沒被 worker 取走的載入素材（依源分開，兩個源同時載入也不會互相蓋掉）。 */
const pendingAix = new Map<string, Uint8Array>()
const pendingPackages = new Map<string, AidokuPackage>()
/** Mihon：apk 位元組（worker 用同步 XHR 向宿主拿）。 */
const pendingApks = new Map<string, Uint8Array>()

/** 源自己寫設定（`defaults.set`）的落地函式；由 `sources/aidoku.ts` 注冊。 */
let settingsWriter: ((key: string, name: string, value: unknown) => void) | null = null

export function setSourceSettingWriter(writer: (key: string, name: string, value: unknown) => void): void {
  settingsWriter = writer
}

/** 頁面被建立過幾次（回歸驗証用它數「只重建一次」）。 */
let generation = 0
let idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS
/** setTimeout 的第一個 handle 是 0，所以不能用 truthy 判斷。 */
let idleTimer: number | null = null
let lastActivity = 0

// ---------------------------------------------------------------- 隊列

/** 任務的優先級：使用者在等（詳情、翻頁）的排在背景追更前面。 */
export type SourcePriority = "user" | "background"

/** 隊列裡的一筆：排序只看 `priority`。 */
export interface SourceQueueItem {
  priority: SourcePriority
}

/**
 * 下一個該跑誰：**最早的使用者任務**先跑；沒有使用者任務才輪到最早的背景任務。
 * 純函式、不碰宿主（離線驗証驗這支）。回 -1 表示隊列是空的。
 */
export function nextSourceTaskIndex(items: readonly SourceQueueItem[]): number {
  let background = -1
  for (let index = 0; index < items.length; index++) {
    if (items[index].priority === "user") return index
    if (background < 0) background = index
  }
  return background
}

interface QueuedCall {
  priority: SourcePriority
  task: () => Promise<unknown>
  resolve: (value: any) => void
  reject: (error: unknown) => void
}

/** 每個源一條隊列：還沒開始跑的呼叫（執行中的不在裡面）。 */
const sourceQueues = new Map<string, QueuedCall[]>()
/** 手上有呼叫在跑的源：同一個源一次只跑一個，先開始的不會被後來的打斷。 */
const busySources = new Set<string>()
/** 目前手上有多少個源的呼叫做到一半（排隊的不算）。 */
let running = 0
const idleWaiters: (() => void)[] = []
/** 等「有 worker 空下來」的人（回收不成就等）。 */
const slotWaiters: (() => void)[] = []

function slotOf(key: string): WorkerSlot {
  const existing = slots.get(key)
  if (existing) return existing
  const created: WorkerSlot = { key, lastUsed: Date.now() }
  slots.set(key, created)
  return created
}

/** 這個源手上的呼叫數。 */
function busyCount(sourceKey: string): number {
  return pendingCounts.get(sourceKey) ?? 0
}

/** 這個源的 worker 還有幾個背景 job（頁面回報的，0 就是沒有）。 */
export function sourcePendingJobs(sourceKey: string): number {
  return pendingJobs.get(sourceKey) ?? 0
}

/** 頁面上現在有哪幾個 worker（診斷與探針用：上限是 `sourceWorkerLimit()`）。 */
export function sourceWorkerSlots(): string[] {
  return [...slots.keys()]
}

function notePendingJobs(sourceKey: string, remaining: number): void {
  if (!sourceKey) return
  if (remaining > 0) pendingJobs.set(sourceKey, remaining)
  else pendingJobs.delete(sourceKey)
}

function bumpPending(sourceKey: string, delta: number): void {
  const next = busyCount(sourceKey) + delta
  if (next <= 0) pendingCounts.delete(sourceKey)
  else pendingCounts.set(sourceKey, next)
}

/**
 * 一次源呼叫排進這個源自己的隊列。
 * 呼叫數在**入列時**就加一：回收一個源之前要看它手上有沒有還沒跑的呼叫。
 * `priority` 由呼叫端明講（逐呼叫帶進來，不讀環境態）：同一個源並行的背景與使用者呼叫才分得開。
 */
export function runSourceExclusive<T>(
  sourceKey: string,
  task: () => Promise<T>,
  priority: SourcePriority = "user"
): Promise<T> {
  // 這裡**不能**建 slot：slot 代表「頁面上真的有這個 worker」，
  // 先建的話 acquireSlot 會以為它已經存在，上限就永遠輪不到回收。
  bumpPending(sourceKey, 1)
  touch(sourceKey)
  return new Promise<T>((resolve, reject) => {
    const entry: QueuedCall = { priority, task, resolve, reject }
    const queue = sourceQueues.get(sourceKey)
    if (queue) queue.push(entry)
    else sourceQueues.set(sourceKey, [entry])
    pumpSource(sourceKey)
  })
}

/** 這個源的下一個任務：挑一個就交給 `execute`，同一個源同時只有一個在跑。 */
function pumpSource(sourceKey: string): void {
  if (busySources.has(sourceKey)) return
  const queue = sourceQueues.get(sourceKey)
  if (!queue || queue.length === 0) return
  const [entry] = queue.splice(nextSourceTaskIndex(queue), 1)
  if (queue.length === 0) sourceQueues.delete(sourceKey)
  busySources.add(sourceKey)
  void execute(sourceKey, entry)
}

async function execute(sourceKey: string, entry: QueuedCall): Promise<void> {
  try {
    await pageGate
    running += 1
    try {
      entry.resolve(await entry.task())
    } finally {
      running -= 1
      bumpPending(sourceKey, -1)
      wake()
    }
  } catch (failure) {
    entry.reject(failure)
  } finally {
    busySources.delete(sourceKey)
    pumpSource(sourceKey)
  }
}

function wake(): void {
  if (running === 0) for (const resolve of idleWaiters.splice(0)) resolve()
  for (const resolve of slotWaiters.splice(0)) resolve()
}

// ---------------------------------------------------------------- 頁面層級的動作

/**
 * 頁面層級的動作（建頁、重建、dispose、收 worker）在跑時，源的呼叫先等在門外，
 * 而且要等手邊的呼叫做完才動手：銷毀不會落在請求中間。
 */
let pageGate: Promise<void> = Promise.resolve()
let pageQueue: Promise<unknown> = Promise.resolve()

function runPageTask<T>(task: () => Promise<T>, drainBefore = true): Promise<T> {
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const previous = pageGate
  pageGate = gate
  const run = pageQueue.then(async () => {
    await previous
    try {
      if (drainBefore) await drainRunning()
      return await task()
    } finally {
      release()
    }
  })
  pageQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/** 等到手邊沒有任何源的呼叫（排隊的都在門外等，不會突然插進來）。 */
async function drainRunning(): Promise<void> {
  while (running > 0) {
    await new Promise<void>(resolve => idleWaiters.push(resolve))
  }
}

// ---------------------------------------------------------------- 閒置回收

function touch(sourceKey?: string): void {
  lastActivity = Date.now()
  const slot = sourceKey ? slots.get(sourceKey) : undefined
  if (slot) slot.lastUsed = lastActivity
  scheduleIdle()
}

function scheduleIdle(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (!controller && !server) return
  const now = Date.now()
  let due = lastActivity + idleTimeoutMs
  for (const slot of slots.values()) due = Math.min(due, slot.lastUsed + idleTimeoutMs)
  const remaining = Math.max(0, due - now)
  try {
    idleTimer = setTimeout(() => {
      idleTimer = null
      void disposeWhenIdle()
    }, remaining)
  } catch {
    // 呼叫端可能不在主佇列（WebView 回呼的續行），下一輪 touch() 再排就好。
    idleTimer = null
  }
}

/** 每個 worker 自己算閒置；最後一個收掉之後才釋放頁面與伺服器。 */
async function disposeWhenIdle(): Promise<void> {
  await runPageTask(async () => {
    const now = Date.now()
    for (const slot of [...slots.values()]) {
      if (busyCount(slot.key) > 0 || now - slot.lastUsed < idleTimeoutMs) continue
      await dropWorker(slot.key)
    }
    if (slots.size === 0 && (controller || server) && now - lastActivity >= idleTimeoutMs) {
      teardown()
      log("info", "sourcehost", `宿主閒置 ${Math.round(idleTimeoutMs / 1000)} 秒，已釋放`)
    }
  })
  scheduleIdle()
}

/** 閒置多久之後 dispose（預設 10 分鐘；驗証用短的值）。 */
export function setSourceIdleTimeout(ms: number): void {
  idleTimeoutMs = Math.max(0, ms)
  scheduleIdle()
}

/** 頁面與伺服器都在。 */
export function sourceHostAlive(): boolean {
  return controller !== null && server !== null
}

/** 頁面被建立過幾次。 */
export function sourceHostGeneration(): number {
  return generation
}

/** 宿主伺服器的埠號（沒開就是 0）。 */
export function sourceHostPort(): number {
  return port
}

/** 這個源的 worker 裡載著它的源嗎（引擎用它判斷要不要重載）。 */
export function isSourceLoaded(sourceKey: string): boolean {
  return loadedKeys.has(sourceKey)
}

/**
 * 同時最多幾個源的 worker（聚合搜尋據此限流：超過只會把剛載好的源擠掉，白載一輪）。
 * 呼叫端讀這個數字，不要自己抄一份。
 */
export function sourceWorkerLimit(): number {
  return WORKER_LIMIT
}

function hostAssetPath(name: string): string {
  return join(Script.directory, "assets/sourcehost", name)
}

function aidokuAssetPath(name: string): string {
  return join(Script.directory, "assets/aidoku", name)
}

function mihonAssetPath(name: string): string {
  return join(Script.directory, "assets/mihon", name)
}

function staticResponse(bytes: Uint8Array, contentType: string): HttpResponse {
  return HttpResponse.raw(200, "OK", {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
    body: Data.fromArrayBuffer(bytes.buffer as ArrayBuffer)!,
  })
}

function readHostAsset(name: string, contentType: string): HttpResponse {
  const bytes = readBytes(hostAssetPath(name))
  if (!bytes) return HttpResponse.notFound()
  return staticResponse(bytes, contentType)
}

function readAidokuAsset(name: string, contentType: string): HttpResponse {
  const bytes = readBytes(aidokuAssetPath(name))
  if (!bytes) return HttpResponse.notFound()
  return staticResponse(bytes, contentType)
}

/** dexvm 的兩個成品檔：只能供驗過的那一份（驗証在載入前做，載入過了就不可能不合）。 */
function dexvmAssetResponse(pick: "wasm" | "host"): HttpResponse {
  try {
    const assets = dexvmAssets()
    const contentType = pick === "wasm" ? "application/wasm" : "text/javascript; charset=utf-8"
    return staticResponse(pick === "wasm" ? assets.wasm : assets.host, contentType)
  } catch (failure) {
    log("error", "mihon", "dexvm 成品檔載不起來", failure)
    return HttpResponse.notFound()
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    } catch {
      // 不在主佇列時建不了 timer（原生回呼的續行）：那就沒有逾時，直接把結果交出去。
    }
    promise.then(resolve, reject)
  })
}

function jsonBody(request: HttpRequest): any {
  const raw = (request as any).body
  if (!raw || typeof raw.toArrayBuffer !== "function") return null
  try {
    return JSON.parse(new TextDecoder("utf-8").decode(new Uint8Array(raw.toArrayBuffer())))
  } catch {
    return null
  }
}

/** 原始位元組：`Data` 或 `Uint8Array`。 */
function bodyBytes(request: HttpRequest): Uint8Array | null {
  const raw = (request as any).body
  if (!raw || typeof raw.toArrayBuffer !== "function") return null
  try {
    return new Uint8Array(raw.toArrayBuffer())
  } catch {
    return null
  }
}

/** `GET /job/<token>`：回原始位元組；同一個 token 只給一次。 */
function pageJobResponse(request: HttpRequest): HttpResponse {
  const job = pageJobs.get(request.params.token)
  if (!job || job.served || !job.bytes) return HttpResponse.notFound()
  const bytes = job.bytes
  job.served = true
  // 交出去之後就不必再留一份（POST 回來時也不需要原始位元組）。
  job.bytes = null
  return staticResponse(bytes, "application/octet-stream")
}

/** `POST /result/<token>`：收處理後的位元組，叫醒等這個 job 的人。 */
function pageResultResponse(request: HttpRequest): HttpResponse {
  const token = request.params.token
  const job = pageJobs.get(token)
  if (!job || !job.served) return HttpResponse.notFound()
  const bytes = bodyBytes(request)
  if (!bytes) return HttpResponse.badRequest()
  finishPageJob(token, bytes)
  return HttpResponse.raw(200, "OK", { headers: { "Content-Type": "application/octet-stream" } })
}

/** 已解開的源（安裝後放在磁碟上的形狀）。 */
export interface AidokuPackage {
  manifest: Record<string, unknown>
  settingsJson?: unknown
  /** 使用者改過的設定值（只含改過的 key）；載入時交給 worker 疊在 schema 預設上。 */
  settings?: Record<string, unknown>
  wasm: Uint8Array
}

export interface SourceProxyRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string | null
  /** 二進位 body（base64）：Mihon 擴充的 POST 會送位元組。有值時優於 `body`。 */
  bodyBase64?: string | null
  /**
   * 這個請求來自哪個引擎（worker 自己宣告）。宿主不查 registry：`registry → sources → sourcehost`
   * 這條依賴反過來就成環，而一個 worker 本來就只服務一個引擎，它帶過來最明確。
   * 回應 cookie 要不要收進宿主 jar 就看這個。
   */
  engine?: SourceWorkerKind
}

export interface SourceProxyResult {
  status: number
  headers: Record<string, string>
  bytes: Uint8Array
  /** 重新導向後的真實位址。 */
  url: string
}

/** 代理請求撞到的 Cloudflare 挑戰（由呼叫端決定何時去過盾）。 */
export interface SourceChallenge {
  sourceKey: string
  url: string
  userAgent: string
  at: number
}

/** 沒人去處理的挑戰不要留太久，不然下一次同名源的呼叫會莫名多過一次盾。 */
const CHALLENGE_TTL_MS = 120_000

let pendingChallenge: SourceChallenge | null = null

/** 取走這個源待處理的挑戰；別的源的不算，也不清掉。 */
export function takeSourceChallenge(sourceKey: string): SourceChallenge | null {
  if (!pendingChallenge) return null
  if (Date.now() - pendingChallenge.at > CHALLENGE_TTL_MS) {
    pendingChallenge = null
    return null
  }
  if (pendingChallenge.sourceKey !== sourceKey) return null
  const value = pendingChallenge
  pendingChallenge = null
  return value
}

/** 把 jar 的 cookie 補進代理請求（源自己給的 Cookie 保留，同名由 jar 覆蓋）。 */
function withJarCookies(sourceKey: string | null, url: string, headers: Record<string, string>): void {
  if (!sourceKey) return
  const jar = cookieHeader(sourceKey, url)
  if (!jar) return
  const existing = Object.keys(headers).find(name => name.toLowerCase() === "cookie")
  if (existing) headers[existing] = mergeCookieHeader(headers[existing], jar)
  else headers["cookie"] = jar
}

/** 實際幫 worker 打那發請求；與伺服器隔開，讓它可以被直接測。 */
export async function performProxy(
  request: SourceProxyRequest,
  timeoutMs: number = PROXY_TIMEOUT_MS,
  sourceKey: string | null = null
): Promise<SourceProxyResult> {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (!DROPPED_REQUEST_HEADERS.has(key.toLowerCase())) headers[key] = String(value)
  }

  // 過盾拿到的 cf_clearance 存在 jar 裡；源自己從設定組的 Cookie 只會在畫面那幾條路徑拿到，
  // 所以代理這一層一定要補上（同名以 jar 為準，才不會被舊值卡住）。
  withJarCookies(sourceKey, request.url, headers)

  const method = String(request.method || "GET").toUpperCase()
  const init: any = { method, headers, redirect: "follow" }
  if (method !== "GET" && method !== "HEAD") {
    if (request.bodyBase64) init.body = Convert.decodeBase64(request.bodyBase64)
    else if (request.body != null) init.body = request.body
  }

  const response = await withTimeout(fetch(request.url, init), timeoutMs, "source proxy")
  const buffer = await response.arrayBuffer()

  const outHeaders: Record<string, string> = {}
  response.headers.forEach((value: string, key: string) => {
    if (!DROPPED_REQUEST_HEADERS.has(key.toLowerCase())) outHeaders[key] = value
  })
  const finalUrl = response.url || request.url
  outHeaders["X-Nemu-Final-Url"] = finalUrl
  // XHR 的回應標頭依規範會濾掉 Set-Cookie，worker 讀不到；改放自訂標頭，一筆一個值（Mihon 要交給 dexvm）。
  // 只有 Aidoku 把 jar 交給宿主收：它的 runtime jar 一個標頭值只收第一筆（同名標頭又會疊掉）。
  // Mihon 的 jar 在 dexvm 的 Java 端，那裡才是唯一真實來源：宿主再存一份，擴充清掉／改寫之後
  // 下一發會被 withJarCookies 把舊值塞回去（包子 gatekeeper 的 binding 就是這樣壞的）。
  const setCookies = response.headers.getSetCookie()
  if (setCookies.length > 0) {
    outHeaders["X-Nemu-Set-Cookie"] = encodeURIComponent(JSON.stringify(setCookies))
    if (sourceKey && request.engine === "aidoku") absorbSetCookieHeaders(sourceKey, finalUrl, setCookies)
  }

  if (sourceKey && isCloudflareChallenge(response.status, outHeaders, buffer)) {
    pendingChallenge = {
      sourceKey,
      url: finalUrl,
      userAgent: headers["user-agent"] ?? headers["User-Agent"] ?? "",
      at: Date.now(),
    }
    log("info", "sourcehost", `${sourceKey} 的代理請求遇到 Cloudflare 挑戰，交給呼叫端過盾`)
  }

  return { status: response.status, headers: outHeaders, bytes: new Uint8Array(buffer), url: finalUrl }
}

/** 請求信封裡的源：worker 自己帶過來，代理層不再猜「目前載著誰」。 */
function sourceKeyOf(payload: any): string | null {
  return payload && typeof payload.sourceKey === "string" && payload.sourceKey ? payload.sourceKey : null
}

/** 請求信封裡的引擎：只認這兩個字串，其餘當沒宣告（沒宣告就不收 cookie）。 */
function engineOf(payload: any): SourceWorkerKind | undefined {
  const value = payload?.engine
  return value === "aidoku" || value === "mihon" ? value : undefined
}

/** HTTP 入口：只負責把 worker 的 JSON 信封轉成一次 performProxy。 */
async function proxyResponse(request: HttpRequest): Promise<HttpResponse> {
  const payload = jsonBody(request)
  const target: string | null = payload && typeof payload.url === "string" ? payload.url : null
  if (!target) return HttpResponse.badRequest()

  const started = Date.now()
  let result: SourceProxyResult
  proxyInFlight += 1
  try {
    result = await performProxy(
      {
        url: target,
        method: payload.method,
        headers: payload.headers,
        body: payload.body,
        bodyBase64: payload.bodyBase64,
        engine: engineOf(payload),
      },
      PROXY_TIMEOUT_MS,
      sourceKeyOf(payload)
    )
  } catch (failure) {
    // fetch 自己丟（TLS、DNS、連線中斷）也在這裡接：這個回呼若往外丟，就會變成
    // 沒有呼叫端的未處理錯誤，而 worker 只會看到 XHR 失敗、不知道為什麼。
    const message = failure instanceof Error ? failure.message : String(failure ?? "")
    const op = typeof payload?.op === "string" ? payload.op : "?"
    log(
      "warning",
      "sourcehost",
      `${sourceKeyOf(payload) ?? "?"} 的 ${op} 代理請求失敗：${target}（${message}）`,
      failure
    )
    return HttpResponse.raw(599, "Proxy Failed", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: Data.fromRawString(`proxy failed: ${message}`, "utf-8")!,
    })
  } finally {
    proxyInFlight = Math.max(0, proxyInFlight - 1)
  }
  noteProxyCall(sourceKeyOf(payload) ?? "", target, result.status, started, Date.now() - started, payload.headers)

  return HttpResponse.raw(result.status, "OK", {
    headers: result.headers,
    body: Data.fromArrayBuffer(result.bytes.buffer as ArrayBuffer)!,
  })
}

/** 已經進到 `/proxy`、還沒回的請求數（探針用它確認收尾時沒有還在飛的東西）。 */
let proxyInFlight = 0

export function sourceProxyInFlight(): number {
  return proxyInFlight
}

/** 一次代理請求的紀錄（診斷用：拆得開「源在等網路」與「源在算」）。 */
export interface ProxyCall {
  sourceKey: string
  url: string
  status: number
  /** 發出時間（毫秒）。 */
  at: number
  ms: number
  /** 送出的 header 名稱（小寫、排序）；用來分辨同一個網址是不是同一個呼叫端。 */
  headerNames: string
  /** 實際送出的 User-Agent（源自己宣告的或宿主補的）。 */
  userAgent: string
}

const PROXY_CALL_LIMIT = 400
const proxyCalls: ProxyCall[] = []

function noteProxyCall(
  sourceKey: string,
  url: string,
  status: number,
  at: number,
  ms: number,
  headers: unknown
): void {
  if (!sourceKey) return
  const names =
    headers && typeof headers === "object"
      ? Object.keys(headers as Record<string, unknown>)
          .map(name => name.toLowerCase())
          .sort()
          .join(",")
      : ""
  let userAgent = ""
  if (headers && typeof headers === "object") {
    for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
      if (name.toLowerCase() === "user-agent") userAgent = String(value)
    }
  }
  proxyCalls.push({ sourceKey, url, status, at, ms, headerNames: names, userAgent })
  if (proxyCalls.length > PROXY_CALL_LIMIT) proxyCalls.splice(0, proxyCalls.length - PROXY_CALL_LIMIT)
}

/** 取出目前累積的代理請求並清空（探針用來對「這一段做了幾發 HTTP、各花多久」）。 */
export function takeProxyCalls(): ProxyCall[] {
  const out = proxyCalls.slice()
  proxyCalls.length = 0
  return out
}

/** 與 dexvm-host 的 `SLEEP_CAP_MS` 一致：再長就是擴充寫錯了，不該讓 worker 卡住。 */
const MIHON_SLEEP_CAP_MS = 60_000

let mihonSleeps = 0

/** dexvm 的同步 sleep：worker 在這個請求上阻塞，等待期間不燒 CPU（worker 沒有 SharedArrayBuffer，用不了 Atomics.wait）。 */
async function mihonSleepResponse(request: HttpRequest): Promise<HttpResponse> {
  const requested = Number(jsonBody(request)?.ms)
  const ms = Number.isFinite(requested) ? Math.min(Math.max(0, requested), MIHON_SLEEP_CAP_MS) : 0
  mihonSleeps += 1
  if (ms > 0) await new Promise<void>(resolve => setTimeout(() => resolve(), ms))
  return staticResponse(new Uint8Array(0), "application/octet-stream")
}

/** `/mihon/sleep` 被打過幾次（探針用：確認限流走的是宿主 sleep，不是 busy-wait）。 */
export function mihonSleepTotal(): number {
  return mihonSleeps
}

/** 一批最多同時幾個（源自己通常一批 5 個）。 */
const BATCH_CONCURRENCY = 6

/**
 * `send_all` 的整批預取：平行送出，一次回給 worker。
 * 回應格式：4 byte LE meta 長度 + meta JSON（每筆 status／headers／length 或 error）+ 各 body 依序接起來。
 */
async function proxyBatchResponse(request: HttpRequest): Promise<HttpResponse> {
  const payload = jsonBody(request)
  const requests: any[] = Array.isArray(payload?.requests) ? payload.requests : []
  if (requests.length === 0) return HttpResponse.badRequest()
  const sourceKey = sourceKeyOf(payload)

  const results: (SourceProxyResult | null)[] = new Array(requests.length).fill(null)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < requests.length) {
      const index = next++
      const item = requests[index]
      if (!item || typeof item.url !== "string") continue
      try {
        results[index] = await performProxy(
          {
            url: item.url,
            method: item.method,
            headers: item.headers,
            body: item.body,
            bodyBase64: item.bodyBase64,
            engine: engineOf(payload),
          },
          PROXY_TIMEOUT_MS,
          sourceKey
        )
      } catch {
        // 留 null：worker 那邊會退回單筆送出
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, requests.length) }, worker))

  const meta = results.map(result =>
    result ? { status: result.status, headers: result.headers, length: result.bytes.byteLength } : { error: true }
  )
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta))
  const total = 4 + metaBytes.byteLength + results.reduce((sum, result) => sum + (result?.bytes.byteLength ?? 0), 0)
  const out = new Uint8Array(total)
  new DataView(out.buffer).setUint32(0, metaBytes.byteLength, true)
  out.set(metaBytes, 4)
  let offset = 4 + metaBytes.byteLength
  for (const result of results) {
    if (!result) continue
    out.set(result.bytes, offset)
    offset += result.bytes.byteLength
  }
  return staticResponse(out, "application/octet-stream")
}

async function waitForHostReady(target: WebViewController): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const ready = await target.evaluateJavaScript("return typeof window.__sourceHost === 'object'")
      if (ready === true) return
    } catch {
      // 頁面還沒起來，繼續等
    }
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 100))
  }
  throw new Error("source host page did not become ready")
}

// 對外服務的檔名 → 磁碟上的檔名（目前同名，大檔也直接放 .js）。
const RUNTIME_FILES: Record<string, string> = {
  "runtime.bundle.js": "runtime.bundle.js",
  "canvas.js": "canvas.js",
  "postcard.js": "postcard.js",
  "types.js": "types.js",
  "serde.js": "serde.js",
}

async function ensureServer(): Promise<number> {
  if (server && port) return port

  const instance = new HttpServer()
  instance.registerHandler("/", () => readHostAsset("host.html", "text/html; charset=utf-8"))
  instance.registerHandler("/host.js", () => readHostAsset("host.js", "text/javascript; charset=utf-8"))
  instance.registerHandler("/worker.js", () => readAidokuAsset("worker.js", "text/javascript; charset=utf-8"))
  instance.registerHandler("/mihon/worker.js", () => {
    const bytes = readBytes(mihonAssetPath("worker.js"))
    return bytes ? staticResponse(bytes, "text/javascript; charset=utf-8") : HttpResponse.notFound()
  })
  instance.registerHandler("/mihon/dexvm-host.js", () => dexvmAssetResponse("host"))
  instance.registerHandler("/mihon/dexvm_bridge.wasm", () => dexvmAssetResponse("wasm"))
  instance.registerAsyncHandler("/mihon/apk", async request => {
    const apk = pendingApks.get(sourceKeyOf(jsonBody(request)) ?? "")
    if (!apk) return HttpResponse.notFound()
    return staticResponse(apk, "application/octet-stream")
  })
  for (const [served, file] of Object.entries(RUNTIME_FILES)) {
    instance.registerHandler(`/rt/${served}`, () => readAidokuAsset(`rt/${file}`, "text/javascript; charset=utf-8"))
  }
  instance.registerAsyncHandler("/aix", async request => {
    const aix = pendingAix.get(sourceKeyOf(jsonBody(request)) ?? "")
    if (!aix) return HttpResponse.notFound()
    return staticResponse(aix, "application/octet-stream")
  })
  instance.registerAsyncHandler("/manifest", async request => {
    const pkg = pendingPackages.get(sourceKeyOf(jsonBody(request)) ?? "")
    if (!pkg) return HttpResponse.notFound()
    const payload = JSON.stringify({
      manifest: pkg.manifest,
      settingsJson: pkg.settingsJson ?? null,
      settings: pkg.settings ?? {},
    })
    return staticResponse(new TextEncoder().encode(payload), "application/json; charset=utf-8")
  })
  instance.registerAsyncHandler("/wasm", async request => {
    const pkg = pendingPackages.get(sourceKeyOf(jsonBody(request)) ?? "")
    if (!pkg) return HttpResponse.notFound()
    return staticResponse(pkg.wasm, "application/octet-stream")
  })
  instance.registerAsyncHandler("/proxy", proxyResponse)
  instance.registerAsyncHandler("/mihon/sleep", mihonSleepResponse)
  instance.registerAsyncHandler("/proxy-batch", proxyBatchResponse)
  instance.registerAsyncHandler("/settings", async request => {
    const payload = jsonBody(request)
    const key = typeof payload?.sourceKey === "string" ? payload.sourceKey : ""
    const name = typeof payload?.key === "string" ? payload.key : ""
    if (!key || !name) return HttpResponse.badRequest()
    // 只接「這個 key 有載著或正在載」的寫入，避免交叉寫到別的源。
    if (!loadedKeys.has(key) && !loadingKeys.has(key)) return HttpResponse.badRequest()
    settingsWriter?.(key, name, payload.value)
    return HttpResponse.raw(204, "No Content", {})
  })
  instance.registerAsyncHandler("/job/:token", async request => pageJobResponse(request))
  instance.registerAsyncHandler("/result/:token", async request => pageResultResponse(request))

  const error = instance.start({ port: 0 })
  if (error) throw new SourceHostError(`source host server failed: ${error}`)
  port = instance.port ?? 0
  server = instance
  log("info", "sourcehost", `宿主伺服器啟動於埠號 ${port}`)
  return port
}

let creatingHost: Promise<WebViewController> | null = null

async function ensureHost(): Promise<WebViewController> {
  if (controller) return controller
  // 宿主頁與 runtime 都住在本機 HttpServer（Scripting Pro）。在 createHost 之前擋，
  // 才不會被 withHealing 當成「宿主壞掉」重建一輪。
  requirePro("aidoku")
  // 兩個源同時第一次用到時只建一個頁面。
  if (!creatingHost) creatingHost = createHost().finally(() => {
    creatingHost = null
  })
  return await creatingHost
}

async function createHost(): Promise<WebViewController> {
  let listening = 0
  try {
    listening = await ensureServer()
  } catch (failure) {
    throw hostError(failure)
  }
  const target = new WebViewController({ ephemeral: true })
  try {
    await target.addScriptMessageHandler("sourceResult", (payload: any) => {
      // 背景 job 的剩餘數：沒有 taskId，也不代表任何一次呼叫成功或失敗。
      if (payload?.pending === true) {
        notePendingJobs(String(payload.sourceKey ?? ""), Number(payload.remaining) || 0)
        return true
      }
      const waiter = taskWaiters.get(payload?.id)
      if (!waiter) return true
      taskWaiters.delete(payload.id)
      if (payload.ok === true) waiter.resolve(payload.value)
      // 只有那個源的 worker 壞了：剩下的源與頁面都還能用。
      else if (payload.fatal === true) waiter.reject(new SourceWorkerError(String(payload.error ?? "source worker failed")))
      else waiter.reject(new Error(String(payload.error ?? "source error")))
      return true
    })
    await target.loadURL(`http://127.0.0.1:${listening}/`)
    await target.waitForLoad()
    await waitForHostReady(target)
  } catch (error) {
    try {
      target.dispose()
    } catch {}
    throw hostError(error)
  }
  controller = target
  generation++
  // 新頁面上一個 worker 都沒有：之前的載入紀錄全部作廢。
  slots.clear()
  loadedKeys.clear()
  loadingKeys.clear()
  pendingJobs.clear()
  pendingAix.clear()
  pendingPackages.clear()
  pendingApks.clear()
  touch()
  log("info", "sourcehost", "宿主頁面就緒")
  return controller
}

/**
 * 畫面外的 WebView 一陣子沒被碰就會被 WebKit 暫停：一次呼叫連發幾十個同步 XHR
 * （例如逐頁抓解密 key）會停在半路，直到下一次 evaluateJavaScript 才醒。
 * 有呼叫在跑時每 500ms 碰一下頁面；所有呼叫共用一個計時器。
 */
const AWAKE_INTERVAL_MS = 500
let awakeCount = 0
let awakeTimer: number | null = null

/** 要在主佇列呼叫（建 timer 的限制同 runTask）。 */
function keepAwake(): void {
  awakeCount += 1
  if (awakeTimer !== null) return
  awakeTimer = setInterval(() => {
    const page = controller
    if (page) Promise.resolve(page.evaluateJavaScript("return 0")).catch(() => {})
  }, AWAKE_INTERVAL_MS) as unknown as number
}

function releaseAwake(): void {
  awakeCount = Math.max(0, awakeCount - 1)
  if (awakeCount > 0 || awakeTimer === null) return
  clearInterval(awakeTimer)
  awakeTimer = null
}

/** 先把工作丟給頁面（立即返回），結果由 script message handler 推回來。 */
async function runTask(sourceKey: string, startScript: (id: number) => string, timeoutMs: number, label: string): Promise<any> {
  const id = nextTaskId++
  // 計時器要在呼叫當下（主佇列）就建好：`ensureHost()` 回來時可能已經不是主佇列，
  // 那時建 timer 會丟「Timer requires its active script on the main JS execution queue」。
  const result = new Promise<any>((resolve, reject) => {
    taskWaiters.set(id, { resolve, reject })
    try {
      setTimeout(() => {
        // 一次呼叫拖太久是這個源自己的事（卡住的源不該連累別的源）。
        if (taskWaiters.delete(id)) reject(new SourceWorkerError(`${label} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      keepAwake()
    } catch {
      // 連這裡都建不了就沒有逾時。
    }
  })
  result.then(releaseAwake, releaseAwake)

  let target: WebViewController
  try {
    // 頁面與這個源的 worker 都得在：排到這裡時它可能已經被回收或重建掉了。
    target = await ensureHost()
    await acquireSlot(sourceKey)
  } catch (failure) {
    taskWaiters.delete(id)
    throw hostError(failure)
  }

  try {
    await withTimeout(Promise.resolve(target.evaluateJavaScript(startScript(id))), START_TIMEOUT_MS, `${label} start`)
  } catch (failure) {
    // 頁面不見了（或卡住）就不是那個呼叫的問題，而是宿主：丟給上層重建。
    taskWaiters.delete(id)
    throw hostError(failure)
  }
  return await result
}

/**
 * 這個源要一個 worker：滿了就回收最久沒用而且閒著的那個，全都忙就等其中一個閒下來。
 * 回收會讓那個源下次呼叫時重載（`loadedKeys` 一起清掉）。
 */
async function acquireSlot(sourceKey: string): Promise<void> {
  for (;;) {
    if (slots.has(sourceKey)) return
    if (slots.size < WORKER_LIMIT) {
      slotOf(sourceKey)
      return
    }
    const victim = pickVictim()
    if (victim) {
      log("info", "sourcehost", `worker 已達上限 ${WORKER_LIMIT}，回收閒置最久的 ${victim}`)
      await dropWorker(victim)
      continue
    }
    await new Promise<void>(resolve => slotWaiters.push(resolve))
  }
}

/**
 * 要回收誰：手上有呼叫的不算；有背景 job 的排在最後（真的只剩它們才丟）。
 * 純函式，離線驗証驗這支。全部都在忙就回 null。
 */
export function nextWorkerVictim(candidates: readonly WorkerVictimCandidate[]): string | null {
  let idleKey: string | null = null
  let idleAt = Number.POSITIVE_INFINITY
  let holdingKey: string | null = null
  let holdingAt = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    if (candidate.busy > 0) continue
    if (candidate.pendingJobs > 0) {
      if (candidate.lastUsed < holdingAt) {
        holdingAt = candidate.lastUsed
        holdingKey = candidate.key
      }
      continue
    }
    if (candidate.lastUsed < idleAt) {
      idleAt = candidate.lastUsed
      idleKey = candidate.key
    }
  }
  return idleKey ?? holdingKey
}

interface WorkerVictimCandidate {
  key: string
  lastUsed: number
  /** 手上有呼叫（執行中＋排隊中）。 */
  busy: number
  /** dexvm 還沒跑完的背景 job。 */
  pendingJobs: number
}

/** 最久沒用而且閒著的源（有背景 job 的排最後；全都忙就回 null）。 */
function pickVictim(): string | null {
  return nextWorkerVictim(
    [...slots.values()].map(slot => ({
      key: slot.key,
      lastUsed: slot.lastUsed,
      busy: busyCount(slot.key),
      pendingJobs: sourcePendingJobs(slot.key),
    }))
  )
}

/** 叫頁面把這個 worker 收掉，並把它的狀態清除。 */
async function dropWorker(sourceKey: string): Promise<void> {
  const droppedJobs = sourcePendingJobs(sourceKey)
  slots.delete(sourceKey)
  loadedKeys.delete(sourceKey)
  loadingKeys.delete(sourceKey)
  pendingJobs.delete(sourceKey)
  pendingAix.delete(sourceKey)
  pendingPackages.delete(sourceKey)
  pendingApks.delete(sourceKey)
  if (droppedJobs > 0) {
    log("info", "sourcehost", `回收 ${sourceKey} 的 worker：直接丟掉 ${droppedJobs} 個還沒跑完的背景 job`)
  }
  if (!controller || !server) return
  try {
    // 頁面真的沒了也不用管：下一次呼叫會自己重建，到時這份狀態就不算數了。
    const target = controller
    await withTimeout(
      Promise.resolve(target.evaluateJavaScript(`return window.__sourceHost.dropSource(${JSON.stringify(sourceKey)})`)),
      START_TIMEOUT_MS,
      "source dropSource"
    )
  } catch (failure) {
    log("warning", "sourcehost", `收掉 ${sourceKey} 的 worker 失敗`, failure)
  }
}

/**
 * 丟掉這個源的載入狀態（檔案換掉、設定改掉、移除時叫）：下一次呼叫重載。
 * 只動這個源的紀錄，其他源的 worker 不受影響；worker 本身留著（重載就是重載）。
 */
export function forgetSource(sourceKey: string): void {
  loadedKeys.delete(sourceKey)
  loadingKeys.delete(sourceKey)
  pendingAix.delete(sourceKey)
  pendingPackages.delete(sourceKey)
  pendingApks.delete(sourceKey)
  scheduleIdle()
}

/** 真的把這個源的 worker 收掉（自癒用：worker 自己卡住或死了）。 */
export function dropSource(sourceKey: string): Promise<void> {
  forgetSource(sourceKey)
  // 不等別的源排空：這個動作只碰自己那一個 worker，而且呼叫端已經把它的隊列放掉了。
  return runPageTask(async () => {
    await dropWorker(sourceKey)
  }, false)
}

async function load(sourceKey: string, label: string, start: (id: number) => string, prepare: () => void): Promise<any> {
  await ensureHost()
  loadedKeys.delete(sourceKey)
  // 新實例從空的佇列開始：上一份的背景 job 跟著舊實例一起沒了。
  pendingJobs.delete(sourceKey)
  loadingKeys.add(sourceKey)
  prepare()
  try {
    const result = await runTask(sourceKey, start, LOAD_TIMEOUT_MS, label)
    loadedKeys.add(sourceKey)
    return result
  } finally {
    loadingKeys.delete(sourceKey)
    pendingAix.delete(sourceKey)
    pendingPackages.delete(sourceKey)
    pendingApks.delete(sourceKey)
  }
}

/** 從 `.aix` 原封不動載入（舊路徑用）。 */
export async function loadAidokuSource(
  aix: Uint8Array,
  sourceKey: string,
  settings: Record<string, unknown> = {}
): Promise<any> {
  return await load(
    sourceKey,
    "source load",
    (id) => `return window.__sourceHost.startLoad(${id}, ${JSON.stringify(sourceKey)}, ${JSON.stringify(settings)})`,
    () => {
      pendingAix.set(sourceKey, aix)
      pendingPackages.delete(sourceKey)
    }
  )
}

/** 從解開的檔案載入：manifest 走 `/manifest`、wasm 走 `/wasm`（兩者都帶 sourceKey）。 */
export async function loadAidokuPackage(pkg: AidokuPackage, sourceKey: string): Promise<any> {
  return await load(
    sourceKey,
    "source load",
    (id) => `return window.__sourceHost.startLoadPackage(${id}, ${JSON.stringify(sourceKey)})`,
    () => {
      pendingPackages.set(sourceKey, pkg)
      pendingAix.delete(sourceKey)
    }
  )
}

// ---------------------------------------------------------------- Mihon（dexvm-wasm）

/** worker 回報的載入耗時：分得開「拿 apk」、「實例化 wasm」與「open」。 */
export interface MihonLoadTimings {
  apk: number
  wasm: number
  instantiate: number
  open: number
}

export interface MihonLoaded {
  manifest: unknown
  timings: MihonLoadTimings
}

/**
 * 載入一個 Mihon apk：一個 apk 一個 worker，內部的語言子源共用同一個 dexvm handle。
 * 呼叫端要自己在 `runSourceExclusive` 裡叫（與 Aidoku 的載入路徑一樣）。
 */
export async function loadMihonExtension(
  apk: Uint8Array,
  apkKey: string,
  prefs: Record<string, unknown> = {},
  userAgent: string = mihonUserAgent()
): Promise<MihonLoaded> {
  // 雜湊不符就在開宿主之前失敗，並說清楚是哪一個檔（不要變成頁面上的 404）。
  dexvmAssets()
  return await load(
    apkKey,
    "mihon load",
    (id) =>
      `return window.__sourceHost.startLoadMihon(${id}, ${JSON.stringify(apkKey)}, ${JSON.stringify(prefs)}, ${JSON.stringify(
        userAgent
      )})`,
    () => {
      pendingApks.set(apkKey, apk)
      pendingAix.delete(apkKey)
      pendingPackages.delete(apkKey)
    }
  )
}

/** 對 Mihon 擴充做一次 op（`handle` 由 worker 自己補上）。 */
export async function callMihon(
  apkKey: string,
  op: string,
  args: Record<string, unknown> = {},
  timeoutMs: number = CALL_TIMEOUT_MS
): Promise<any> {
  return await runTask(
    apkKey,
    (id) =>
      `return window.__sourceHost.startMihonCall(${id}, ${JSON.stringify(apkKey)}, ${JSON.stringify(op)}, ${JSON.stringify(args)})`,
    timeoutMs,
    `mihon ${op}`
  )
}

export interface MihonImageRequest {
  sourceId: string
  /** `pages` 回來的其中一頁（PageRef）。 */
  page: unknown
}

/**
 * 抓一頁圖：`fetchImage` 在 VM 裡跑（含源的攔截器與解混淆），位元組由 worker 交給 `/result/<token>`，
 * 不經 messageHandlers。呼叫端要自己排進 `runSourceExclusive`，並先確認 worker 載著那個 apk。
 */
export async function fetchMihonImage(
  apkKey: string,
  request: MihonImageRequest,
  timeoutMs: number = IMAGE_TIMEOUT_MS
): Promise<Uint8Array> {
  const token = createSourcePageJob(null)
  const result = waitSourcePageJob(token, timeoutMs)
  const task = runTask(
    apkKey,
    (id) =>
      `return window.__sourceHost.startMihonFetchImage(${id}, ${JSON.stringify(apkKey)}, ${JSON.stringify(token)}, ${JSON.stringify(request)})`,
    timeoutMs,
    "mihon fetchImage"
  )
  task.catch(failure => failSourcePageJob(token, failure instanceof Error ? failure.message : String(failure)))
  return await result
}

/**
 * 測試縫（比照 `detachSourceHostPage`）：worker 自己模擬 trap 與 `eval_js`。
 * 實機上找不到穩定能讓 dexvm panic 的 apk，trap 這條路只能這樣驗。
 * 呼叫端要自己排進 `runSourceExclusive`。
 */
export async function probeMihonWorker(apkKey: string, probe: Record<string, unknown>): Promise<any> {
  return await runTask(
    apkKey,
    (id) => `return window.__sourceHost.startMihonProbe(${id}, ${JSON.stringify(apkKey)}, ${JSON.stringify(probe)})`,
    CALL_TIMEOUT_MS,
    "mihon probe"
  )
}

/** worker 現在的 `currentSettings`（schema 預設 ＋ 使用者值 ＋ manifest 預設）：只讀。 */export async function sourceSettingsSnapshot(sourceKey: string): Promise<Record<string, unknown>> {
  const value = await runTask(
    sourceKey,
    (id) => `return window.__sourceHost.startSettingsSnapshot(${id}, ${JSON.stringify(sourceKey)})`,
    CALL_TIMEOUT_MS,
    "source settingsSnapshot"
  )
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

export async function initializeAidokuSource(sourceKey: string): Promise<boolean> {
  return await runTask(
    sourceKey,
    (id) => `return window.__sourceHost.startInitialize(${id}, ${JSON.stringify(sourceKey)})`,
    CALL_TIMEOUT_MS,
    "source initialize"
  )
}

/** 源設定完成後的通知（`handle_notification`）；源沒匯出就是 no-op。 */
export async function notifyAidoku(sourceKey: string, notification: string): Promise<void> {
  await runTask(
    sourceKey,
    (id) => `return window.__sourceHost.startNotification(${id}, ${JSON.stringify(sourceKey)}, ${JSON.stringify(notification)})`,
    CALL_TIMEOUT_MS,
    "source notification"
  )
}

export interface AidokuImageProcessors {
  page: boolean
  cover: boolean
}

/** 源有沒有 `process_page_image`／`process_cover_image`（圖要解密／解拼）：載入後問一次。 */
export async function hasImageProcessorAidoku(sourceKey: string): Promise<AidokuImageProcessors> {
  const value = await runTask(
    sourceKey,
    (id) => `return window.__sourceHost.startHasImageProcessor(${id}, ${JSON.stringify(sourceKey)})`,
    CALL_TIMEOUT_MS,
    "source hasImageProcessor"
  )
  return { page: value?.page === true, cover: value?.cover === true }
}

export async function selfTestAidoku(sourceKey: string): Promise<any> {
  return await runTask(
    sourceKey,
    (id) => `return window.__sourceHost.startSelfTest(${id}, ${JSON.stringify(sourceKey)})`,
    CALL_TIMEOUT_MS,
    "source selftest"
  )
}

export async function callAidoku(
  sourceKey: string,
  method: string,
  args: unknown[] = [],
  timeoutMs: number = CALL_TIMEOUT_MS
): Promise<any> {
  return await runTask(
    sourceKey,
    (id) => `return window.__sourceHost.startCall(${id}, ${JSON.stringify(sourceKey)}, ${JSON.stringify(method)}, ${JSON.stringify(args)})`,
    timeoutMs,
    `source ${method}`
  )
}

/** 建立一個頁面圖工作（`processAidokuPageImage` 與協定層測試共用）。`null` = 沒有輸入位元組（Mihon 的 `fetchImage` 由 VM 自己抓）。 */
export function createSourcePageJob(bytes: Uint8Array | null): string {
  pageJobTotal += 1
  const token = `${Date.now().toString(36)}-${nextPageJobId++}-${Math.random().toString(36).slice(2, 8)}`
  pageJobs.set(token, {
    bytes,
    served: bytes === null,
    resolve: () => {},
    reject: () => {},
    timer: null,
  })
  return token
}

/** 等工作結果；逾時就 reject 並把工作從表裡拿掉。 */
export function waitSourcePageJob(token: string, timeoutMs: number = IMAGE_TIMEOUT_MS): Promise<Uint8Array> {
  const job = pageJobs.get(token)
  if (!job) return Promise.reject(new SourceHostError("source page job not found"))
  return new Promise<Uint8Array>((resolve, reject) => {
    job.resolve = resolve
    job.reject = reject
    // 不在主佇列時建不了 timer：那就沒有自己的逾時，交給呼叫端的 runTask 逾時。
    job.timer = timerAfter(() => {
      discardPageJob(token, new Error(`source processPageImage timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
}

/** 收掉一個工作：reject 等待者並從表裡移除。 */
function discardPageJob(token: string, error: Error): void {
  const job = pageJobs.get(token)
  if (!job) return
  if (job.timer !== null) clearTimeout(job.timer)
  pageJobs.delete(token)
  job.reject(error)
}

function finishPageJob(token: string, bytes: Uint8Array): void {
  const job = pageJobs.get(token)
  if (!job) return
  if (job.timer !== null) clearTimeout(job.timer)
  pageJobs.delete(token)
  job.resolve(bytes)
}

/** 主動收掉一個工作（錯誤路徑與協定層測試用）。 */
export function failSourcePageJob(token: string, reason: string): void {
  discardPageJob(token, new Error(reason))
}

/** 還沒收尾的工作數。 */
export function sourcePageJobCount(): number {
  return pageJobs.size
}

/** 從頭到尾開過幾個頁面圖工作（對照組用它證明「一次都沒有多走」）。 */
export function sourcePageJobTotal(): number {
  return pageJobTotal
}

export interface AidokuPageImageRequest {
  url: string
  headers: Record<string, string>
  /** `getPageList` 給這一頁的 context（例如解密 key）；沒有就是 null。 */
  context?: Record<string, string> | null
  /** 走 `process_cover_image`（封面／縮圖）而不是頁面處理。 */
  cover?: boolean
  status: number
  responseHeaders: Record<string, string>
}

/**
 * 把一張頁面圖交給 worker 的 `process_page_image`。位元組走 loopback HTTP：
 * worker `GET /job/<token>` 取原圖，處理完 `POST /result/<token>` 交回。
 *
 * 呼叫端要自己排進 `runSourceExclusive`，並先確認 worker 載著那個源。
 */
export async function processAidokuPageImage(
  sourceKey: string,
  bytes: Uint8Array,
  request: AidokuPageImageRequest,
  timeoutMs: number = IMAGE_TIMEOUT_MS
): Promise<Uint8Array> {
  const token = createSourcePageJob(bytes)
  const result = waitSourcePageJob(token, timeoutMs)
  const task = runTask(
    sourceKey,
    id =>
      `return window.__sourceHost.startProcessPageImage(${id}, ${JSON.stringify(sourceKey)}, ${JSON.stringify(token)}, ${JSON.stringify(request)})`,
    timeoutMs,
    "source processPageImage"
  )
  // worker 自己的例外（解析失敗、POST 失敗）也要叫醒等結果的人。
  task.catch(failure => failSourcePageJob(token, failure instanceof Error ? failure.message : String(failure)))
  return await result
}

/** 丟掉頁面與伺服器（會先等手邊的呼叫做完）。 */
export function disposeSourceHost(): Promise<void> {
  return runPageTask(async () => teardown())
}

/**
 * 把目前的頁面換成空白頁：worker 跟著消失，但**不動**「載著哪個源」的狀態。
 * 下一次呼叫必須自己發現頁面沒了、重建後重載（模擬 WebKit 把頁面收掉）。
 */
export function detachSourceHostPage(): Promise<void> {
  return runPageTask(async () => {
    if (!controller) return
    try {
      await controller.loadURL("about:blank")
    } catch (failure) {
      log("warning", "sourcehost", "切換空白頁失敗", failure)
    }
  })
}

function failPageJobs(message: string): void {
  for (const token of [...pageJobs.keys()]) discardPageJob(token, new SourceHostError(message))
}

function failPending(message: string): void {
  for (const waiter of taskWaiters.values()) waiter.reject(new SourceHostError(message))
  taskWaiters.clear()
}

/** 重建／收尾：丟掉所有 worker、頁面與伺服器，下一次呼叫重新開始。 */
export function resetSourceHost(): Promise<void> {
  return runPageTask(async () => teardown())
}

function teardown(): void {
  slots.clear()
  loadedKeys.clear()
  loadingKeys.clear()
  pendingJobs.clear()
  pendingAix.clear()
  pendingPackages.clear()
  pendingApks.clear()
  failPageJobs("source host reset")
  failPending("source host reset")
  if (controller) {
    try {
      controller.dispose()
    } catch {}
    controller = null
  }
  if (server) {
    try {
      server.stop()
    } catch {}
    server = null
    port = 0
  }
  scheduleIdle()
}
