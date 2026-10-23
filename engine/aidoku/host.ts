// Aidoku 源宿主：本機 HttpServer 服務頁面與 runtime，WebView 內的 module worker 執行 wasm 源。
// 與超分分開：各自的 server 與 WebView（超分頁面需要 COOP/COEP，這裡不需要）。
//
// 生命週期：第一次用到才開 → 常駐 → 閒置逾時 dispose。所有碰宿主的動作都排同一條隊列，
// 所以 dispose／重建不會落在請求中間。

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

/** 宿主／worker 這一層壞掉（不是源自己回錯）。呼叫端據此決定要不要重建重試。 */
export class AidokuHostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AidokuHostError"
  }
}

export function isAidokuHostError(error: unknown): boolean {
  return error instanceof AidokuHostError
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
let pendingAix: Uint8Array | null = null
let pendingPackage: AidokuPackage | null = null
/** worker 裡現在載著哪一份源（重載判斷用；dispose 後歸零）。 */
let loadedKey: string | null = null
/** 載入中的源：載入期間源就可能寫設定，这时 loadedKey 還不是它。 */
let loadingKey: string | null = null

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

// ---------------------------------------------------------------- 隊列與閒置回收

let queue: Promise<unknown> = Promise.resolve()

/** 不更新活動時間的入列（閒置回收自己用，否則排隊就等於把時鐘歸零）。 */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/** 所有碰宿主的動作（載入、呼叫、重建、dispose）都排這條隊列：銷毀不會落在請求中間。 */
export function runAidokuExclusive<T>(task: () => Promise<T>): Promise<T> {
  touch()
  return enqueue(task)
}

function touch(): void {
  lastActivity = Date.now()
  scheduleIdle()
}

function scheduleIdle(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (!controller && !server) return
  const remaining = Math.max(0, lastActivity + idleTimeoutMs - Date.now())
  const start = (): void => {
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
  start()
}

/** 排到隊列尾端才真的拆；輪到它時再確認一次（排隊期間可能又有請求進來）。 */
async function disposeWhenIdle(): Promise<void> {
  await enqueue(async () => {
    if (Date.now() - lastActivity < idleTimeoutMs) {
      scheduleIdle()
      return
    }
    resetAidokuHost()
    log("info", "aidoku", `宿主閒置 ${Math.round(idleTimeoutMs / 1000)} 秒，已釋放`)
  })
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
    loadedKey ?? loadingKey
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
  instance.registerAsyncHandler("/aix", async () => {
    if (!pendingAix) return HttpResponse.notFound()
    return staticResponse(pendingAix, "application/octet-stream")
  })
  instance.registerAsyncHandler("/manifest", async () => {
    if (!pendingPackage) return HttpResponse.notFound()
    const payload = JSON.stringify({
      manifest: pendingPackage.manifest,
      settingsJson: pendingPackage.settingsJson ?? null,
      settings: pendingPackage.settings ?? {},
    })
    return staticResponse(new TextEncoder().encode(payload), "application/json; charset=utf-8")
  })
  instance.registerAsyncHandler("/wasm", async () => {
    if (!pendingPackage) return HttpResponse.notFound()
    return staticResponse(pendingPackage.wasm, "application/octet-stream")
  })
  instance.registerAsyncHandler("/proxy", proxyResponse)
  instance.registerAsyncHandler("/settings", async request => {
    const payload = jsonBody(request)
    const key = typeof payload?.sourceKey === "string" ? payload.sourceKey : ""
    const name = typeof payload?.key === "string" ? payload.key : ""
    if (!key || !name) return HttpResponse.badRequest()
    // 只接目前這一份源（載入中的也算），避免交叉寫到別的源。
    if (key !== loadedKey && key !== loadingKey) return HttpResponse.badRequest()
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

async function ensureHost(): Promise<WebViewController> {
  if (controller) return controller

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
      else if (payload.fatal === true) waiter.reject(new AidokuHostError(String(payload.error ?? "aidoku worker failed")))
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
  touch()
  log("info", "aidoku", "宿主頁面就緒")
  return controller
}

/** 先把工作丟給頁面（立即返回），結果由 script message handler 推回來。 */
async function runTask(startScript: (id: number) => string, timeoutMs: number, label: string): Promise<any> {
  const id = nextTaskId++
  // 計時器要在呼叫當下（主佇列）就建好：`ensureHost()` 回來時可能已經不是主佇列，
  // 那時建 timer 會丟「Timer requires its active script on the main JS execution queue」。
  const result = new Promise<any>((resolve, reject) => {
    taskWaiters.set(id, { resolve, reject })
    try {
      setTimeout(() => {
        if (taskWaiters.delete(id)) reject(new AidokuHostError(`${label} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    } catch {
      // 連這裡都建不了就沒有逾時。
    }
  })

  let target: WebViewController
  try {
    target = await ensureHost()
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

async function load(sourceKey: string, start: (id: number) => string): Promise<any> {
  await ensureHost()
  loadedKey = null
  loadingKey = sourceKey
  try {
    const result = await runTask(start, LOAD_TIMEOUT_MS, "aidoku load")
    loadedKey = sourceKey
    return result
  } finally {
    loadingKey = null
  }
}

/** 從 `.aix` 原封不動載入（探針與舊路徑用）。 */
export async function loadAidokuSource(
  aix: Uint8Array,
  sourceKey: string,
  settings: Record<string, unknown> = {}
): Promise<any> {
  pendingAix = aix
  pendingPackage = null
  return await load(sourceKey, (id) =>
    `return window.__aidoku.startLoad(${id}, ${JSON.stringify(sourceKey)}, "/aix", ${JSON.stringify(settings)})`
  )
}

/** 從解開的檔案載入：manifest 走 `/manifest`、wasm 走 `/wasm`。 */
export async function loadAidokuPackage(pkg: AidokuPackage, sourceKey: string): Promise<any> {
  pendingAix = null
  pendingPackage = pkg
  return await load(sourceKey, (id) => `return window.__aidoku.startLoadPackage(${id}, ${JSON.stringify(sourceKey)})`)
}

/** worker 裡現在載著哪一份源（引擎用它判斷要不要重載）。 */
export function loadedAidokuSourceKey(): string | null {
  return loadedKey
}

/** worker 現在的 `currentSettings`（schema 預設 ＋ 使用者值 ＋ manifest 預設）：只讀。 */
export async function aidokuSettingsSnapshot(): Promise<Record<string, unknown>> {
  const value = await runTask(
    (id) => `return window.__aidoku.startSettingsSnapshot(${id})`,
    CALL_TIMEOUT_MS,
    "aidoku settingsSnapshot"
  )
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

export async function initializeAidokuSource(): Promise<boolean> {
  return await runTask((id) => `return window.__aidoku.startInitialize(${id})`, CALL_TIMEOUT_MS, "aidoku initialize")
}

/** 源設定完成後的通知（`handle_notification`）；源沒匯出就是 no-op。 */
export async function notifyAidoku(notification: string): Promise<void> {
  await runTask(
    (id) => `return window.__aidoku.startNotification(${id}, ${JSON.stringify(notification)})`,
    CALL_TIMEOUT_MS,
    "aidoku notification"
  )
}

/** 源有沒有 `process_page_image`（頁面圖要解密／解拼）：載入後問一次。 */
export async function hasImageProcessorAidoku(): Promise<boolean> {
  const value = await runTask(
    (id) => `return window.__aidoku.startHasImageProcessor(${id})`,
    CALL_TIMEOUT_MS,
    "aidoku hasImageProcessor"
  )
  return value === true
}

export async function selfTestAidoku(): Promise<any> {
  return await runTask((id) => `return window.__aidoku.startSelfTest(${id})`, CALL_TIMEOUT_MS, "aidoku selftest")
}

export async function callAidoku(method: string, args: unknown[] = [], timeoutMs: number = CALL_TIMEOUT_MS): Promise<any> {
  return await runTask(
    (id) => `return window.__aidoku.startCall(${id}, ${JSON.stringify(method)}, ${JSON.stringify(args)})`,
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
  bytes: Uint8Array,
  request: AidokuPageImageRequest,
  timeoutMs: number = IMAGE_TIMEOUT_MS
): Promise<Uint8Array> {
  const token = createAidokuPageJob(bytes)
  const result = waitAidokuPageJob(token, timeoutMs)
  const task = runTask(
    id =>
      `return window.__aidoku.startProcessPageImage(${id}, ${JSON.stringify(token)}, ${JSON.stringify(request)})`,
    timeoutMs,
    "aidoku processPageImage"
  )
  // worker 自己的例外（解析失敗、POST 失敗）也要叫醒等結果的人。
  task.catch(failure => failAidokuPageJob(token, failure instanceof Error ? failure.message : String(failure)))
  return await result
}

export function disposeAidokuHost(): Promise<void> {
  return enqueue(async () => resetAidokuHost())
}

/**
 * 把目前的頁面換成空白頁：worker 跟著消失，但**不動**「載著哪個源」的狀態。
 * 下一次呼叫必須自己發現頁面沒了、重建後重載（模擬 WebKit 把頁面收掉）。
 */
export function detachAidokuHostPage(): Promise<void> {
  return enqueue(async () => {
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

/** 隊列內重建：丟掉頁面與伺服器，下一次呼叫重新開始。 */
export function resetAidokuHost(): void {
  loadedKey = null
  pendingAix = null
  pendingPackage = null
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
