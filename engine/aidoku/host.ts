// Aidoku 源宿主：本機 HttpServer 服務頁面與 runtime，WebView 內每個源一個 module worker 跑 wasm。
// 與超分分開：各自的 server 與 WebView（超分頁面需要 COOP/COEP，這裡不需要）。
//
// 生命週期：第一次用到才開 → 常駐 → 閒置逾時 dispose。每個源一條隊列（同一個源序列，不同源並行）；
// 頁面層級的動作（建頁、重建、dispose）會先等所有源的隊列排空，所以不會拆在請求中間。

import { Script, fetch } from "scripting"

import { cookieHeader, mergeCookieHeader } from "../cookies"
import { join, readBytes } from "../fs"
import { log } from "../log"
import { isCloudflareChallenge } from "../cloudflareDetect"

const CALL_TIMEOUT_MS = 15_000
const LOAD_TIMEOUT_MS = 30_000
const PROXY_TIMEOUT_MS = 15_000
/** 把工作丟進頁面這一步的逾時：頁面死了就不該等到呼叫本身的逾時。 */
const START_TIMEOUT_MS = 5_000
const IMAGE_TIMEOUT_MS = 30_000
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000
/** 同時最多幾個源的 worker（Aidoku 原版的 maxConcurrentTasks 也是 3）。 */
const WORKER_LIMIT = 3

/** 宿主這一層壞掉（頁面沒了、伺服器起不來）。呼叫端據此重建整個宿主再重試。 */
export class AidokuHostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AidokuHostError"
  }
}

/** 只有某個源的 worker 壞了／逾時：丟掉它就夠了，其他源與頁面不受影響。 */
export class AidokuWorkerError extends AidokuHostError {
  constructor(message: string) {
    super(message)
    this.name = "AidokuWorkerError"
  }
}

export function isAidokuHostError(error: unknown): boolean {
  return error instanceof AidokuHostError
}

/** 這個源自己的 worker 掛了（而不是頁面沒了）。 */
export function isAidokuWorkerError(error: unknown): boolean {
  return error instanceof AidokuWorkerError
}

function hostError(error: unknown): AidokuHostError {
  if (error instanceof AidokuHostError) return error
  return new AidokuHostError(error instanceof Error ? error.message : String(error ?? ""))
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
/** 載入中的源：載入期間源就可能寫設定，這時 loadedKeys 裡還不是它。 */
const loadingKeys = new Set<string>()
/** 還沒被 worker 取走的載入素材（依源分開，兩個源同時載入也不會互相蓋掉）。 */
const pendingAix = new Map<string, Uint8Array>()
const pendingPackages = new Map<string, AidokuPackage>()

/** 源自己寫設定（`defaults.set`）的落地函式；由 `sources/aidoku.ts` 注冊。 */
let settingsWriter: ((key: string, name: string, value: unknown) => void) | null = null

export function setAidokuSettingWriter(writer: (key: string, name: string, value: unknown) => void): void {
  settingsWriter = writer
}

/** 頁面被建立過幾次（探針用它數「只重建一次」）。 */
let generation = 0
let idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS
/** setTimeout 的第一個 handle 是 0，所以不能用 truthy 判斷。 */
let idleTimer: number | null = null
let lastActivity = 0

// ---------------------------------------------------------------- 隊列

/** 每個源一條隊列：同一個源的呼叫序列，不同的源真的同時跑。 */
const sourceQueues = new Map<string, Promise<unknown>>()
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

function bumpPending(sourceKey: string, delta: number): void {
  const next = busyCount(sourceKey) + delta
  if (next <= 0) pendingCounts.delete(sourceKey)
  else pendingCounts.set(sourceKey, next)
}

/**
 * 一次源呼叫排進這個源自己的隊列。
 * 呼叫數在**入列時**就加一：回收一個源之前要看它手上有沒有還沒跑的呼叫。
 */
export function runAidokuExclusive<T>(sourceKey: string, task: () => Promise<T>): Promise<T> {
  slotOf(sourceKey)
  bumpPending(sourceKey, 1)
  touch(sourceKey)
  const execute = async (): Promise<T> => {
    await pageGate
    running += 1
    try {
      return await task()
    } finally {
      running -= 1
      bumpPending(sourceKey, -1)
      wake()
    }
  }
  const previous = sourceQueues.get(sourceKey) ?? Promise.resolve()
  const run = previous.then(execute)
  sourceQueues.set(
    sourceKey,
    run.then(
      () => undefined,
      () => undefined
    )
  )
  return run
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
      log("info", "aidoku", `宿主閒置 ${Math.round(idleTimeoutMs / 1000)} 秒，已釋放`)
    }
  })
  scheduleIdle()
}

/** 閒置多久之後 dispose（預設 10 分鐘；探針用短的值）。 */
export function setAidokuIdleTimeout(ms: number): void {
  idleTimeoutMs = Math.max(0, ms)
  scheduleIdle()
}

/** 頁面與伺服器都在。 */
export function aidokuHostAlive(): boolean {
  return controller !== null && server !== null
}

/** 頁面被建立過幾次。 */
export function aidokuHostGeneration(): number {
  return generation
}

/** 宿主伺服器的埠號（沒開就是 0）。 */
export function aidokuHostPort(): number {
  return port
}

/** 這個源的 worker 裡載著它的源嗎（引擎用它判斷要不要重載）。 */
export function isAidokuLoaded(sourceKey: string): boolean {
  return loadedKeys.has(sourceKey)
}

function assetPath(name: string): string {
  return join(Script.directory, "assets/aidoku", name)
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

function readAsset(name: string, contentType: string): HttpResponse {
  const bytes = readBytes(assetPath(name))
  if (!bytes) return HttpResponse.notFound()
  return staticResponse(bytes, contentType)
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

export interface AidokuProxyRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string | null
}

export interface AidokuProxyResult {
  status: number
  headers: Record<string, string>
  bytes: Uint8Array
  /** 重新導向後的真實位址。 */
  url: string
}

/** 代理請求撞到的 Cloudflare 挑戰（由呼叫端決定何時去過盾）。 */
export interface AidokuChallenge {
  sourceKey: string
  url: string
  userAgent: string
  at: number
}

/** 沒人去處理的挑戰不要留太久，不然下一次同名源的呼叫會莫名多過一次盾。 */
const CHALLENGE_TTL_MS = 120_000

let pendingChallenge: AidokuChallenge | null = null

/** 取走這個源待處理的挑戰；別的源的不算，也不清掉。 */
export function takeAidokuChallenge(sourceKey: string): AidokuChallenge | null {
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
  request: AidokuProxyRequest,
  timeoutMs: number = PROXY_TIMEOUT_MS,
  sourceKey: string | null = null
): Promise<AidokuProxyResult> {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (!DROPPED_REQUEST_HEADERS.has(key.toLowerCase())) headers[key] = String(value)
  }

  // 過盾拿到的 cf_clearance 存在 jar 裡；源自己從設定組的 Cookie 只會在畫面那幾條路徑拿到，
  // 所以代理這一層一定要補上（同名以 jar 為準，才不會被舊值卡住）。
  withJarCookies(sourceKey, request.url, headers)

  const method = String(request.method || "GET").toUpperCase()
  const init: any = { method, headers, redirect: "follow" }
  if (request.body != null && method !== "GET" && method !== "HEAD") {
    init.body = request.body
  }

  const response = await withTimeout(fetch(request.url, init), timeoutMs, "aidoku proxy")
  const buffer = await response.arrayBuffer()

  const outHeaders: Record<string, string> = {}
  response.headers.forEach((value: string, key: string) => {
    if (!DROPPED_REQUEST_HEADERS.has(key.toLowerCase())) outHeaders[key] = value
  })
  const finalUrl = response.url || request.url
  outHeaders["X-Nemu-Final-Url"] = finalUrl

  if (sourceKey && isCloudflareChallenge(response.status, outHeaders, buffer)) {
    pendingChallenge = {
      sourceKey,
      url: finalUrl,
      userAgent: headers["user-agent"] ?? headers["User-Agent"] ?? "",
      at: Date.now(),
    }
    log("info", "aidoku", `${sourceKey} 的代理請求遇到 Cloudflare 挑戰，交給呼叫端過盾`)
  }

  return { status: response.status, headers: outHeaders, bytes: new Uint8Array(buffer), url: finalUrl }
}

/** 請求信封裡的源：worker 自己帶過來，代理層不再猜「目前載著誰」。 */
function sourceKeyOf(payload: any): string | null {
  return payload && typeof payload.sourceKey === "string" && payload.sourceKey ? payload.sourceKey : null
}

/** HTTP 入口：只負責把 worker 的 JSON 信封轉成一次 performProxy。 */
async function proxyResponse(request: HttpRequest): Promise<HttpResponse> {
  const payload = jsonBody(request)
  const target: string | null = payload && typeof payload.url === "string" ? payload.url : null
  if (!target) return HttpResponse.badRequest()

  const result = await performProxy(
    {
      url: target,
      method: payload.method,
      headers: payload.headers,
      body: payload.body,
    },
    PROXY_TIMEOUT_MS,
    sourceKeyOf(payload)
  )

  return HttpResponse.raw(result.status, "OK", {
    headers: result.headers,
    body: Data.fromArrayBuffer(result.bytes.buffer as ArrayBuffer)!,
  })
}

async function waitForHostReady(target: WebViewController): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const ready = await target.evaluateJavaScript("return typeof window.__aidoku === 'object'")
      if (ready === true) return
    } catch {
      // 頁面還沒起來，繼續等
    }
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 100))
  }
  throw new Error("aidoku host page did not become ready")
}

// 大檔的 minified JS 存成 .js.txt（同 engines/upscale）：避免型別服務去解析它。
const RUNTIME_FILES: Record<string, string> = {
  "runtime.bundle.js": "runtime.bundle.js.txt",
  "canvas.js": "canvas.js",
  "postcard.js": "postcard.js",
  "types.js": "types.js",
  "serde.js": "serde.js",
}

async function ensureServer(): Promise<number> {
  if (server && port) return port

  const instance = new HttpServer()
  instance.registerHandler("/", () => readAsset("host.html", "text/html; charset=utf-8"))
  instance.registerHandler("/host.js", () => readAsset("host.js", "text/javascript; charset=utf-8"))
  instance.registerHandler("/worker.js", () => readAsset("worker.js", "text/javascript; charset=utf-8"))
  for (const [served, file] of Object.entries(RUNTIME_FILES)) {
    instance.registerHandler(`/rt/${served}`, () => readAsset(`rt/${file}`, "text/javascript; charset=utf-8"))
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
  if (error) throw new AidokuHostError(`aidoku host server failed: ${error}`)
  port = instance.port ?? 0
  server = instance
  log("info", "aidoku", `宿主伺服器啟動於埠號 ${port}`)
  return port
}

let creatingHost: Promise<WebViewController> | null = null

async function ensureHost(): Promise<WebViewController> {
  if (controller) return controller
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
    await target.addScriptMessageHandler("aidokuResult", (payload: any) => {
      const waiter = taskWaiters.get(payload?.id)
      if (!waiter) return true
      taskWaiters.delete(payload.id)
      if (payload.ok === true) waiter.resolve(payload.value)
      // 只有那個源的 worker 壞了：剩下的源與頁面都還能用。
      else if (payload.fatal === true) waiter.reject(new AidokuWorkerError(String(payload.error ?? "aidoku worker failed")))
      else waiter.reject(new Error(String(payload.error ?? "aidoku error")))
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
  pendingAix.clear()
  pendingPackages.clear()
  touch()
  log("info", "aidoku", "宿主頁面就緒")
  return controller
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
        if (taskWaiters.delete(id)) reject(new AidokuWorkerError(`${label} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    } catch {
      // 連這裡都建不了就沒有逾時。
    }
  })

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
      log("info", "aidoku", `worker 已達上限 ${WORKER_LIMIT}，回收閒置最久的 ${victim}`)
      await dropWorker(victim)
      continue
    }
    await new Promise<void>(resolve => slotWaiters.push(resolve))
  }
}

/** 最久沒用而且手上沒有呼叫的源（沒有就回 null：全都忙）。 */
function pickVictim(): string | null {
  let victim: WorkerSlot | null = null
  for (const slot of slots.values()) {
    if (busyCount(slot.key) > 0) continue
    if (!victim || slot.lastUsed < victim.lastUsed) victim = slot
  }
  return victim ? victim.key : null
}

/** 叫頁面把這個 worker 收掉，並把它的狀態清除。 */
async function dropWorker(sourceKey: string): Promise<void> {
  slots.delete(sourceKey)
  loadedKeys.delete(sourceKey)
  loadingKeys.delete(sourceKey)
  pendingAix.delete(sourceKey)
  pendingPackages.delete(sourceKey)
  if (!controller || !server) return
  try {
    // 頁面真的沒了也不用管：下一次呼叫會自己重建，到時這份狀態就不算數了。
    const target = controller
    await withTimeout(
      Promise.resolve(target.evaluateJavaScript(`return window.__aidoku.dropSource(${JSON.stringify(sourceKey)})`)),
      START_TIMEOUT_MS,
      "aidoku dropSource"
    )
  } catch (failure) {
    log("warning", "aidoku", `收掉 ${sourceKey} 的 worker 失敗`, failure)
  }
}

/**
 * 丟掉這個源的載入狀態（檔案換掉、設定改掉、移除時叫）：下一次呼叫重載。
 * 只動這個源的紀錄，其他源的 worker 不受影響；worker 本身留著（重載就是重載）。
 */
export function forgetAidokuSource(sourceKey: string): void {
  loadedKeys.delete(sourceKey)
  loadingKeys.delete(sourceKey)
  pendingAix.delete(sourceKey)
  pendingPackages.delete(sourceKey)
  scheduleIdle()
}

/** 真的把這個源的 worker 收掉（自癒用：worker 自己卡住或死了）。 */
export function dropAidokuSource(sourceKey: string): Promise<void> {
  forgetAidokuSource(sourceKey)
  // 不等別的源排空：這個動作只碰自己那一個 worker，而且呼叫端已經把它的隊列放掉了。
  return runPageTask(async () => {
    await dropWorker(sourceKey)
  }, false)
}

async function load(sourceKey: string, start: (id: number) => string, prepare: () => void): Promise<any> {
  await ensureHost()
  loadedKeys.delete(sourceKey)
  loadingKeys.add(sourceKey)
  prepare()
  try {
    const result = await runTask(sourceKey, start, LOAD_TIMEOUT_MS, "aidoku load")
    loadedKeys.add(sourceKey)
    return result
  } finally {
    loadingKeys.delete(sourceKey)
    pendingAix.delete(sourceKey)
    pendingPackages.delete(sourceKey)
  }
}

/** 從 `.aix` 原封不動載入（探針與舊路徑用）。 */
export async function loadAidokuSource(
  aix: Uint8Array,
  sourceKey: string,
  settings: Record<string, unknown> = {}
): Promise<any> {
  return await load(
    sourceKey,
    (id) => `return window.__aidoku.startLoad(${id}, ${JSON.stringify(sourceKey)}, ${JSON.stringify(settings)})`,
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
    (id) => `return window.__aidoku.startLoadPackage(${id}, ${JSON.stringify(sourceKey)})`,
    () => {
      pendingPackages.set(sourceKey, pkg)
      pendingAix.delete(sourceKey)
    }
  )
}

/** worker 現在的 `currentSettings`（schema 預設 ＋ 使用者值 ＋ manifest 預設）：只讀。 */
export async function aidokuSettingsSnapshot(sourceKey: string): Promise<Record<string, unknown>> {
  const value = await runTask(
    sourceKey,
    (id) => `return window.__aidoku.startSettingsSnapshot(${id}, ${JSON.stringify(sourceKey)})`,
    CALL_TIMEOUT_MS,
    "aidoku settingsSnapshot"
  )
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

export async function initializeAidokuSource(sourceKey: string): Promise<boolean> {
  return await runTask(
    sourceKey,
    (id) => `return window.__aidoku.startInitialize(${id}, ${JSON.stringify(sourceKey)})`,
    CALL_TIMEOUT_MS,
    "aidoku initialize"
  )
}

/** 源設定完成後的通知（`handle_notification`）；源沒匯出就是 no-op。 */
export async function notifyAidoku(sourceKey: string, notification: string): Promise<void> {
  await runTask(
    sourceKey,
    (id) => `return window.__aidoku.startNotification(${id}, ${JSON.stringify(sourceKey)}, ${JSON.stringify(notification)})`,
    CALL_TIMEOUT_MS,
    "aidoku notification"
  )
}

/** 源有沒有 `process_page_image`（頁面圖要解密／解拼）：載入後問一次。 */
export async function hasImageProcessorAidoku(sourceKey: string): Promise<boolean> {
  const value = await runTask(
    sourceKey,
    (id) => `return window.__aidoku.startHasImageProcessor(${id}, ${JSON.stringify(sourceKey)})`,
    CALL_TIMEOUT_MS,
    "aidoku hasImageProcessor"
  )
  return value === true
}

export async function selfTestAidoku(sourceKey: string): Promise<any> {
  return await runTask(
    sourceKey,
    (id) => `return window.__aidoku.startSelfTest(${id}, ${JSON.stringify(sourceKey)})`,
    CALL_TIMEOUT_MS,
    "aidoku selftest"
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
    (id) => `return window.__aidoku.startCall(${id}, ${JSON.stringify(sourceKey)}, ${JSON.stringify(method)}, ${JSON.stringify(args)})`,
    timeoutMs,
    `aidoku ${method}`
  )
}

/** 建立一個頁面圖工作（`processAidokuPageImage` 與協定層測試共用）。 */
export function createAidokuPageJob(bytes: Uint8Array): string {
  pageJobTotal += 1
  const token = `${Date.now().toString(36)}-${nextPageJobId++}-${Math.random().toString(36).slice(2, 8)}`
  pageJobs.set(token, {
    bytes,
    served: false,
    resolve: () => {},
    reject: () => {},
    timer: null,
  })
  return token
}

/** 等工作結果；逾時就 reject 並把工作從表裡拿掉。 */
export function waitAidokuPageJob(token: string, timeoutMs: number = IMAGE_TIMEOUT_MS): Promise<Uint8Array> {
  const job = pageJobs.get(token)
  if (!job) return Promise.reject(new AidokuHostError("aidoku page job not found"))
  return new Promise<Uint8Array>((resolve, reject) => {
    job.resolve = resolve
    job.reject = reject
    job.timer = setTimeout(() => {
      discardPageJob(token, new Error(`aidoku processPageImage timed out after ${timeoutMs}ms`))
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
export function failAidokuPageJob(token: string, reason: string): void {
  discardPageJob(token, new Error(reason))
}

/** 還沒收尾的工作數。 */
export function aidokuPageJobCount(): number {
  return pageJobs.size
}

/** 從頭到尾開過幾個頁面圖工作（對照組用它證明「一次都沒有多走」）。 */
export function aidokuPageJobTotal(): number {
  return pageJobTotal
}

export interface AidokuPageImageRequest {
  url: string
  headers: Record<string, string>
  status: number
  responseHeaders: Record<string, string>
}

/**
 * 把一張頁面圖交給 worker 的 `process_page_image`。位元組走 loopback HTTP：
 * worker `GET /job/<token>` 取原圖，處理完 `POST /result/<token>` 交回。
 *
 * 呼叫端要自己排進 `runAidokuExclusive`，並先確認 worker 載著那個源。
 */
export async function processAidokuPageImage(
  sourceKey: string,
  bytes: Uint8Array,
  request: AidokuPageImageRequest,
  timeoutMs: number = IMAGE_TIMEOUT_MS
): Promise<Uint8Array> {
  const token = createAidokuPageJob(bytes)
  const result = waitAidokuPageJob(token, timeoutMs)
  const task = runTask(
    sourceKey,
    id =>
      `return window.__aidoku.startProcessPageImage(${id}, ${JSON.stringify(sourceKey)}, ${JSON.stringify(token)}, ${JSON.stringify(request)})`,
    timeoutMs,
    "aidoku processPageImage"
  )
  // worker 自己的例外（解析失敗、POST 失敗）也要叫醒等結果的人。
  task.catch(failure => failAidokuPageJob(token, failure instanceof Error ? failure.message : String(failure)))
  return await result
}

/** 丟掉頁面與伺服器（會先等手邊的呼叫做完）。 */
export function disposeAidokuHost(): Promise<void> {
  return runPageTask(async () => teardown())
}

/**
 * 把目前的頁面換成空白頁：worker 跟著消失，但**不動**「載著哪個源」的狀態。
 * 下一次呼叫必須自己發現頁面沒了、重建後重載（模擬 WebKit 把頁面收掉）。
 */
export function detachAidokuHostPage(): Promise<void> {
  return runPageTask(async () => {
    if (!controller) return
    try {
      await controller.loadURL("about:blank")
    } catch (failure) {
      log("warning", "aidoku", "切換空白頁失敗", failure)
    }
  })
}

function failPageJobs(message: string): void {
  for (const token of [...pageJobs.keys()]) discardPageJob(token, new AidokuHostError(message))
}

function failPending(message: string): void {
  for (const waiter of taskWaiters.values()) waiter.reject(new AidokuHostError(message))
  taskWaiters.clear()
}

/** 重建／收尾：丟掉所有 worker、頁面與伺服器，下一次呼叫重新開始。 */
export function resetAidokuHost(): Promise<void> {
  return runPageTask(async () => teardown())
}

function teardown(): void {
  slots.clear()
  loadedKeys.clear()
  loadingKeys.clear()
  pendingAix.clear()
  pendingPackages.clear()
  failPageJobs("aidoku host reset")
  failPending("aidoku host reset")
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
