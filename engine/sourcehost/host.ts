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
const START_TIMEOUT_MS = 5_000
const IMAGE_TIMEOUT_MS = 30_000
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000
const DEFAULT_WORKER_LIMIT = 12
const WORKER_MEMORY_BUDGET = 384 * 1024 * 1024

export type SourceWorkerKind = "aidoku" | "mihon"

export class SourceHostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SourceHostError"
  }
}

export class SourceWorkerError extends SourceHostError {
  constructor(message: string) {
    super(message)
    this.name = "SourceWorkerError"
  }
}

export function isSourceHostError(error: unknown): boolean {
  return error instanceof SourceHostError
}

export function isSourceWorkerError(error: unknown): boolean {
  return error instanceof SourceWorkerError
}

function hostError(error: unknown): SourceHostError {
  if (error instanceof SourceHostError) return error
  return new SourceHostError(error instanceof Error ? error.message : String(error ?? ""))
}

let nextTaskId = 1
const taskWaiters = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()

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
interface WorkerSlot {
  key: string
  lastUsed: number
}

const slots = new Map<string, WorkerSlot>()
const pendingCounts = new Map<string, number>()
const loadedKeys = new Set<string>()
const pendingJobs = new Map<string, number>()
const footprints = new Map<string, number>()
const loadingKeys = new Set<string>()
const pendingAix = new Map<string, Uint8Array>()
const pendingPackages = new Map<string, AidokuPackage>()
const pendingApks = new Map<string, Uint8Array>()

let settingsWriter: ((key: string, name: string, value: unknown) => void) | null = null

export function setSourceSettingWriter(writer: (key: string, name: string, value: unknown) => void): void {
  settingsWriter = writer
}

let generation = 0
let idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS
let workerLimit = DEFAULT_WORKER_LIMIT
let idleTimer: number | null = null
let lastActivity = 0


export type SourcePriority = "user" | "background"

export interface SourceQueueItem {
  priority: SourcePriority
}

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

const sourceQueues = new Map<string, QueuedCall[]>()
const busySources = new Set<string>()
let running = 0
const idleWaiters: (() => void)[] = []
const slotWaiters: (() => void)[] = []

function slotOf(key: string): WorkerSlot {
  const existing = slots.get(key)
  if (existing) return existing
  const created: WorkerSlot = { key, lastUsed: Date.now() }
  slots.set(key, created)
  return created
}

function busyCount(sourceKey: string): number {
  return pendingCounts.get(sourceKey) ?? 0
}

export function sourcePendingJobs(sourceKey: string): number {
  return pendingJobs.get(sourceKey) ?? 0
}

export function sourceWorkerSlots(): string[] {
  return [...slots.keys()]
}

export function sourceWorkerFootprint(sourceKey: string): number {
  return footprints.get(sourceKey) ?? 0
}

function noteFootprint(sourceKey: string, bytes: number): void {
  if (!sourceKey || !slots.has(sourceKey)) return
  if (bytes > 0) footprints.set(sourceKey, bytes)
  else footprints.delete(sourceKey)
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

export function runSourceExclusive<T>(
  sourceKey: string,
  task: () => Promise<T>,
  priority: SourcePriority = "user"
): Promise<T> {
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

async function drainRunning(): Promise<void> {
  while (running > 0) {
    await new Promise<void>(resolve => idleWaiters.push(resolve))
  }
}


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
    idleTimer = null
  }
}

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

export function setSourceIdleTimeout(ms: number): void {
  idleTimeoutMs = Math.max(0, ms)
  scheduleIdle()
}

export function sourceHostAlive(): boolean {
  return controller !== null && server !== null
}

export function sourceHostGeneration(): number {
  return generation
}

export function sourceHostPort(): number {
  return port
}

export function isSourceLoaded(sourceKey: string): boolean {
  return loadedKeys.has(sourceKey)
}

export function sourceWorkerLimit(): number {
  return workerLimit
}

export function setSourceWorkerLimit(limit: number): void {
  workerLimit = Math.max(1, Math.floor(limit))
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

function bodyBytes(request: HttpRequest): Uint8Array | null {
  const raw = (request as any).body
  if (!raw || typeof raw.toArrayBuffer !== "function") return null
  try {
    return new Uint8Array(raw.toArrayBuffer())
  } catch {
    return null
  }
}

function pageJobResponse(request: HttpRequest): HttpResponse {
  const job = pageJobs.get(request.params.token)
  if (!job || job.served || !job.bytes) return HttpResponse.notFound()
  const bytes = job.bytes
  job.served = true
  job.bytes = null
  return staticResponse(bytes, "application/octet-stream")
}

function pageResultResponse(request: HttpRequest): HttpResponse {
  const token = request.params.token
  const job = pageJobs.get(token)
  if (!job || !job.served) return HttpResponse.notFound()
  const bytes = bodyBytes(request)
  if (!bytes) return HttpResponse.badRequest()
  finishPageJob(token, bytes)
  return HttpResponse.raw(200, "OK", { headers: { "Content-Type": "application/octet-stream" } })
}

export interface AidokuPackage {
  manifest: Record<string, unknown>
  settingsJson?: unknown
  settings?: Record<string, unknown>
  wasm: Uint8Array
}

export interface SourceProxyRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string | null
  bodyBase64?: string | null
  engine?: SourceWorkerKind
}

export interface SourceProxyResult {
  status: number
  headers: Record<string, string>
  bytes: Uint8Array
  url: string
}

export interface SourceChallenge {
  sourceKey: string
  url: string
  userAgent: string
  at: number
}

const CHALLENGE_TTL_MS = 120_000

let pendingChallenge: SourceChallenge | null = null

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

function headerOf(headers: Record<string, string>, name: string): string {
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === name)
  return key ? String(headers[key]) : ""
}

function withJarCookies(sourceKey: string | null, url: string, headers: Record<string, string>): void {
  if (!sourceKey) return
  const jar = cookieHeader(sourceKey, url)
  if (!jar) return
  const existing = Object.keys(headers).find(name => name.toLowerCase() === "cookie")
  if (existing) headers[existing] = mergeCookieHeader(headers[existing], jar)
  else headers["cookie"] = jar
}

export async function performProxy(
  request: SourceProxyRequest,
  timeoutMs: number = PROXY_TIMEOUT_MS,
  sourceKey: string | null = null
): Promise<SourceProxyResult> {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (!DROPPED_REQUEST_HEADERS.has(key.toLowerCase())) headers[key] = String(value)
  }

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
  const setCookies = response.headers.getSetCookie()
  if (setCookies.length > 0) {
    outHeaders["X-Nemu-Set-Cookie"] = encodeURIComponent(JSON.stringify(setCookies))
    if (sourceKey && request.engine === "aidoku") absorbSetCookieHeaders(sourceKey, finalUrl, setCookies)
  }

  if (sourceKey && isCloudflareChallenge(response.status, outHeaders, buffer)) {
    pendingChallenge = {
      sourceKey,
      url: finalUrl,
      userAgent: headerOf(headers, "user-agent") || (request.engine === "mihon" ? mihonUserAgent() : ""),
      at: Date.now(),
    }
    log("info", "sourcehost", `${sourceKey} 的代理請求遇到 Cloudflare 挑戰，交給呼叫端過盾`)
  }

  return { status: response.status, headers: outHeaders, bytes: new Uint8Array(buffer), url: finalUrl }
}

function sourceKeyOf(payload: any): string | null {
  return payload && typeof payload.sourceKey === "string" && payload.sourceKey ? payload.sourceKey : null
}

function engineOf(payload: any): SourceWorkerKind | undefined {
  const value = payload?.engine
  return value === "aidoku" || value === "mihon" ? value : undefined
}

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

let proxyInFlight = 0

export function sourceProxyInFlight(): number {
  return proxyInFlight
}

export interface ProxyCall {
  sourceKey: string
  url: string
  status: number
  at: number
  ms: number
  headerNames: string
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

export function takeProxyCalls(): ProxyCall[] {
  const out = proxyCalls.slice()
  proxyCalls.length = 0
  return out
}

const MIHON_SLEEP_CAP_MS = 60_000

let mihonSleeps = 0

async function mihonSleepResponse(request: HttpRequest): Promise<HttpResponse> {
  const requested = Number(jsonBody(request)?.ms)
  const ms = Number.isFinite(requested) ? Math.min(Math.max(0, requested), MIHON_SLEEP_CAP_MS) : 0
  mihonSleeps += 1
  if (ms > 0) await new Promise<void>(resolve => setTimeout(() => resolve(), ms))
  return staticResponse(new Uint8Array(0), "application/octet-stream")
}

export function mihonSleepTotal(): number {
  return mihonSleeps
}

const BATCH_CONCURRENCY = 6

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
    }
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 100))
  }
  throw new Error("source host page did not become ready")
}

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
  requirePro("aidoku")
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
      if (payload?.pending === true) {
        notePendingJobs(String(payload.sourceKey ?? ""), Number(payload.remaining) || 0)
        return true
      }
      if (payload?.footprint === true) {
        noteFootprint(String(payload.sourceKey ?? ""), Number(payload.bytes) || 0)
        return true
      }
      const waiter = taskWaiters.get(payload?.id)
      if (!waiter) return true
      taskWaiters.delete(payload.id)
      if (payload.ok === true) waiter.resolve(payload.value)
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
  slots.clear()
  loadedKeys.clear()
  loadingKeys.clear()
  pendingJobs.clear()
  footprints.clear()
  pendingAix.clear()
  pendingPackages.clear()
  pendingApks.clear()
  touch()
  log("info", "sourcehost", "宿主頁面就緒")
  return controller
}

const AWAKE_INTERVAL_MS = 500
let awakeCount = 0
let awakeTimer: number | null = null

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

async function runTask(sourceKey: string, startScript: (id: number) => string, timeoutMs: number, label: string): Promise<any> {
  const id = nextTaskId++
  const result = new Promise<any>((resolve, reject) => {
    taskWaiters.set(id, { resolve, reject })
    try {
      setTimeout(() => {
        if (taskWaiters.delete(id)) reject(new SourceWorkerError(`${label} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      keepAwake()
    } catch {
    }
  })
  result.then(releaseAwake, releaseAwake)

  let target: WebViewController
  try {
    target = await ensureHost()
    await acquireSlot(sourceKey)
  } catch (failure) {
    taskWaiters.delete(id)
    throw hostError(failure)
  }

  try {
    await withTimeout(Promise.resolve(target.evaluateJavaScript(startScript(id))), START_TIMEOUT_MS, `${label} start`)
  } catch (failure) {
    taskWaiters.delete(id)
    throw hostError(failure)
  }
  return await result
}

async function acquireSlot(sourceKey: string): Promise<void> {
  for (;;) {
    if (slots.has(sourceKey)) return
    const heavy = nextBudgetVictim(victimCandidates(), WORKER_MEMORY_BUDGET)
    if (heavy) {
      log("info", "sourcehost", `worker 記憶體超過預算，回收佔最多的 ${heavy}（${Math.round(sourceWorkerFootprint(heavy) / 1048576)}MB）`)
      await dropWorker(heavy)
      continue
    }
    if (slots.size < workerLimit) {
      slotOf(sourceKey)
      return
    }
    const victim = pickVictim()
    if (victim) {
      log("info", "sourcehost", `worker 已達上限 ${workerLimit}，回收閒置最久的 ${victim}`)
      await dropWorker(victim)
      continue
    }
    await new Promise<void>(resolve => slotWaiters.push(resolve))
  }
}

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

export function nextBudgetVictim(candidates: readonly WorkerVictimCandidate[], budget: number): string | null {
  const total = candidates.reduce((sum, candidate) => sum + candidate.footprint, 0)
  if (total <= budget) return null
  let best: WorkerVictimCandidate | null = null
  for (const candidate of candidates) {
    if (candidate.busy > 0 || candidate.footprint <= 0) continue
    if (!best) {
      best = candidate
      continue
    }
    const holding = candidate.pendingJobs > 0
    const bestHolding = best.pendingJobs > 0
    if (holding !== bestHolding) {
      if (!holding) best = candidate
      continue
    }
    if (candidate.footprint > best.footprint) best = candidate
  }
  return best?.key ?? null
}

export interface WorkerVictimCandidate {
  key: string
  lastUsed: number
  busy: number
  pendingJobs: number
  footprint: number
}

function victimCandidates(): WorkerVictimCandidate[] {
  return [...slots.values()].map(slot => ({
    key: slot.key,
    lastUsed: slot.lastUsed,
    busy: busyCount(slot.key),
    pendingJobs: sourcePendingJobs(slot.key),
    footprint: sourceWorkerFootprint(slot.key),
  }))
}

function pickVictim(): string | null {
  return nextWorkerVictim(victimCandidates())
}

async function dropWorker(sourceKey: string): Promise<void> {
  const droppedJobs = sourcePendingJobs(sourceKey)
  slots.delete(sourceKey)
  loadedKeys.delete(sourceKey)
  loadingKeys.delete(sourceKey)
  pendingJobs.delete(sourceKey)
  footprints.delete(sourceKey)
  pendingAix.delete(sourceKey)
  pendingPackages.delete(sourceKey)
  pendingApks.delete(sourceKey)
  if (droppedJobs > 0) {
    log("info", "sourcehost", `回收 ${sourceKey} 的 worker：直接丟掉 ${droppedJobs} 個還沒跑完的背景 job`)
  }
  if (!controller || !server) return
  try {
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

export function forgetSource(sourceKey: string): void {
  loadedKeys.delete(sourceKey)
  loadingKeys.delete(sourceKey)
  pendingAix.delete(sourceKey)
  pendingPackages.delete(sourceKey)
  pendingApks.delete(sourceKey)
  scheduleIdle()
}

export function dropSource(sourceKey: string): Promise<void> {
  forgetSource(sourceKey)
  return runPageTask(async () => {
    await dropWorker(sourceKey)
  }, false)
}

async function load(sourceKey: string, label: string, start: (id: number) => string, prepare: () => void): Promise<any> {
  await ensureHost()
  loadedKeys.delete(sourceKey)
  pendingJobs.delete(sourceKey)
  footprints.delete(sourceKey)
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

export async function loadMihonExtension(
  apk: Uint8Array,
  apkKey: string,
  prefs: Record<string, unknown> = {},
  userAgent: string = mihonUserAgent()
): Promise<MihonLoaded> {
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
  page: unknown
}

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

export async function probeMihonWorker(apkKey: string, probe: Record<string, unknown>): Promise<any> {
  return await runTask(
    apkKey,
    (id) => `return window.__sourceHost.startMihonProbe(${id}, ${JSON.stringify(apkKey)}, ${JSON.stringify(probe)})`,
    CALL_TIMEOUT_MS,
    "mihon probe"
  )
}

export async function sourceSettingsSnapshot(sourceKey: string): Promise<Record<string, unknown>> {
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

export function waitSourcePageJob(token: string, timeoutMs: number = IMAGE_TIMEOUT_MS): Promise<Uint8Array> {
  const job = pageJobs.get(token)
  if (!job) return Promise.reject(new SourceHostError("source page job not found"))
  return new Promise<Uint8Array>((resolve, reject) => {
    job.resolve = resolve
    job.reject = reject
    job.timer = timerAfter(() => {
      discardPageJob(token, new Error(`source processPageImage timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
}

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

export function failSourcePageJob(token: string, reason: string): void {
  discardPageJob(token, new Error(reason))
}

export function sourcePageJobCount(): number {
  return pageJobs.size
}

export function sourcePageJobTotal(): number {
  return pageJobTotal
}

export interface AidokuPageImageRequest {
  url: string
  headers: Record<string, string>
  context?: Record<string, string> | null
  cover?: boolean
  status: number
  responseHeaders: Record<string, string>
}

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
  task.catch(failure => failSourcePageJob(token, failure instanceof Error ? failure.message : String(failure)))
  return await result
}

export function disposeSourceHost(): Promise<void> {
  return runPageTask(async () => teardown())
}

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

export function resetSourceHost(): Promise<void> {
  return runPageTask(async () => teardown())
}

function teardown(): void {
  slots.clear()
  loadedKeys.clear()
  loadingKeys.clear()
  pendingJobs.clear()
  footprints.clear()
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
