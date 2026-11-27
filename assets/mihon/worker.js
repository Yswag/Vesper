// Mihon（keiyoushi）擴充執行器：在 module worker 裡用 dexvm-wasm 解譯 apk。
// dexvm 的 `host.http` 是同步 import，所以這裡走同步 XHR 到宿主的 `/proxy`；
// 圖片位元組不經 messageHandlers，改用 `/result/<token>`。

import { createDexvm } from "./dexvm-host.js"

let sourceKey = ""
let vm = null
let vmHandle = null
let vmTrap = null
/** 現在跑的是哪個 op：代理日誌用它分辨是哪一個呼叫弄出來的網址。 */
let currentOp = ""
let logCount = 0
let lastLog = ""
/** 背景 job 的排程器狀態：一個計時器一次一步，主 op 進來就讓位。 */
let pendingTimer = null
const PENDING_STEP_JOBS = 1
/**
 * 要跑背景 job 前先讓 worker 閒這麼久。runPending 是同步的（job 的 HTTP 也同步），
 * 它一跑就會把接下來的主 op 擋在後面；閱讀時呼叫一個接一個，不能讓它插隊。
 */
const PENDING_QUIET_MS = 400

function toBase64(bytes) {
  const chunk = 0x8000
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

function fromBase64(text) {
  const binary = atob(String(text || ""))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** XHR 的回應標頭是「Name: value」逐行；dexvm 要 [[k, v]]。 */
function parseHeaderLines(raw) {
  const pairs = []
  for (const line of String(raw || "").split(/\r?\n/)) {
    const index = line.indexOf(":")
    if (index > 0) pairs.push([line.slice(0, index).trim(), line.slice(index + 1).trim()])
  }
  return pairs
}

/** 代理回應的標頭；Set-Cookie 由宿主放在 `X-Nemu-Set-Cookie`（XHR 讀不到原本那個），這裡拆回一筆一個。 */
function responseHeaders(xhr) {
  const pairs = parseHeaderLines(xhr.getAllResponseHeaders()).filter(
    ([name]) => name.toLowerCase() !== "x-nemu-set-cookie"
  )
  const packed = xhr.getResponseHeader("X-Nemu-Set-Cookie")
  if (!packed) return pairs
  try {
    for (const value of JSON.parse(decodeURIComponent(packed))) pairs.push(["Set-Cookie", String(value)])
  } catch (error) {
    note(4, `bad X-Nemu-Set-Cookie: ${(error && error.message) || error}`)
  }
  return pairs
}

/** dexvm 的 `host.http`：同步進、同步出，回的是 JSON 字串（不是物件）。 */
function proxySync(requestJson) {
  let request
  try {
    request = JSON.parse(requestJson)
  } catch (error) {
    return JSON.stringify({ error: "bad request json" })
  }
  const headers = {}
  for (const pair of request.headers || []) {
    if (!Array.isArray(pair) || pair.length < 2) continue
    headers[String(pair[0])] = String(pair[1])
  }
  // 引擎別：宿主據此決定要不要把回應 cookie 收進它的 jar（Mihon 的 jar 在 dexvm 的 Java 端，宿主不收）。
  const body = { sourceKey, engine: "mihon", op: currentOp, url: request.url, method: request.method || "GET", headers }
  if (request.bodyBase64) body.bodyBase64 = request.bodyBase64

  const xhr = new XMLHttpRequest()
  try {
    xhr.open("POST", "/proxy", false)
    xhr.responseType = "arraybuffer"
    xhr.setRequestHeader("Content-Type", "application/json")
    xhr.send(JSON.stringify(body))
  } catch (error) {
    return JSON.stringify({ error: String((error && error.message) || error) })
  }
  if (xhr.status === 0) return JSON.stringify({ error: "proxy request did not reach the host" })
  const bytes = xhr.response ? new Uint8Array(xhr.response) : new Uint8Array(0)
  return JSON.stringify({
    status: xhr.status,
    headers: responseHeaders(xhr),
    bodyBase64: toBase64(bytes),
    finalUrl: xhr.getResponseHeader("X-Nemu-Final-Url") || request.url,
  })
}

/** dexvm 的 `host.eval_js`：來源用 QuickJs.evaluate 跑的字串，回 JSON 字串。
 *  indirect eval 回的是 completion value，單一運算式與整段程式兩種寫法都對。
 */
function evalJs(src) {
  try {
    const value = (0, eval)(String(src))
    return JSON.stringify({ ok: true, value: value === undefined ? null : value })
  } catch (error) {
    return JSON.stringify({ ok: false, error: String((error && error.message) || error) })
  }
}

/** dexvm 的同步 sleep：宿主等滿 ms 才回，worker 阻塞在同步 XHR 上，不忙等。 */
function sleepSync(ms) {
  const xhr = new XMLHttpRequest()
  xhr.open("POST", "/mihon/sleep", false)
  xhr.setRequestHeader("Content-Type", "application/json")
  xhr.send(JSON.stringify({ ms }))
}

function note(level, message) {
  logCount += 1
  lastLog = String(message || "")
  if (level >= 4) console.warn("[dexvm]", lastLog)
}

/** apk 由宿主依 sourceKey 供檔：worker 自己用同步 XHR 拿位元組。 */
function fetchApk() {
  const xhr = new XMLHttpRequest()
  xhr.open("POST", "/mihon/apk", false)
  xhr.responseType = "arraybuffer"
  xhr.setRequestHeader("Content-Type", "application/json")
  xhr.send(JSON.stringify({ sourceKey }))
  if (xhr.status !== 200 || !xhr.response) throw new Error(`apk fetch failed: ${xhr.status}`)
  return new Uint8Array(xhr.response)
}

async function load(prefs, userAgent) {
  const startedAt = Date.now()
  cancelPendingStep()
  vmTrap = null
  const apk = fetchApk()
  const fetchedAt = Date.now()

  const response = await fetch("/mihon/dexvm_bridge.wasm")
  if (!response.ok) throw new Error(`dexvm wasm fetch failed: ${response.status}`)
  const wasm = await response.arrayBuffer()
  const wasmAt = Date.now()

  vm = await createDexvm({ wasmBytes: wasm, http: proxySync, log: note, evalJs, sleep: sleepSync })
  lastFootprint = 0
  vmHandle = null
  const instanceAt = Date.now()

  // 預設 UA 由宿主給（Mihon 的 `defaultUserAgentProvider()`）：dexvm 只在 header
  // 缺漏或空白時才填，擴充自己宣告的（configureHeaders／headersBuilder）優先。
  const options = { apkBase64: toBase64(apk), prefs: prefs || {} }
  if (typeof userAgent === "string" && userAgent.trim()) options.defaultUserAgent = userAgent.trim()
  const opened = vm.call("open", options)
  vmHandle = opened.handle
  return {
    manifest: opened.manifest,
    timings: {
      apk: fetchedAt - startedAt,
      wasm: wasmAt - fetchedAt,
      instantiate: instanceAt - wasmAt,
      open: Date.now() - instanceAt,
    },
  }
}

function call(op, args) {
  if (!vm) throw new Error("extension not loaded")
  // 背景 job 把實例弄死了（wasm 的 trap）：之後的每一通都走自癒（宿主丟掉這個 worker 重載）。
  if (vmTrap) {
    const error = new Error(vmTrap)
    error.kind = "trap"
    throw error
  }
  const payload = Object.assign({}, args || {})
  if (op !== "open" && op !== "cookies") payload.handle = vmHandle
  return vm.call(op, payload)
}

let lastFootprint = 0

/** wasm 記憶體只長不縮：變了就告訴頁面，宿主超過預算時先收佔最多的 worker。 */
function reportFootprint() {
  if (!vm) return
  const bytes = vm.exports.memory.buffer.byteLength
  if (bytes === lastFootprint) return
  lastFootprint = bytes
  self.postMessage({ type: "footprint", bytes })
}

/** 告訴頁面這邊還剩幾個背景 job（宿主要用它排回收順序）。 */
function reportPending(remaining) {
  self.postMessage({ type: "pending", remaining })
}

function cancelPendingStep() {
  if (pendingTimer === null) return
  clearTimeout(pendingTimer)
  pendingTimer = null
}

/** `delayMs` 是 dexvm 給的 nextDueMs；再跟「閒置夠久」取大，主 op 一直在跑就不會輪到它。 */
function schedulePendingStep(delayMs) {
  cancelPendingStep()
  pendingTimer = setTimeout(runPendingStep, Math.max(0, delayMs, PENDING_QUIET_MS))
}

/**
 * 跑一步背景 job：`maxJobs` 給 1，讓宿主在這之間進得來。
 * 這條路不走宿主的任務通道，所以不算呼叫逾時、也不會讓 failWorker 誤判。
 */
function runPendingStep() {
  pendingTimer = null
  if (!vm) return
  let result
  try {
    // 代理日誌靠這個分辨「主 op 的請求」與「背景 job 的請求」。
    currentOp = "runPending"
    result = call("runPending", { maxJobs: PENDING_STEP_JOBS })
  } catch (error) {
    if ((error && error.kind) === "trap") vmTrap = String((error && error.message) || error)
    reportPending(0)
    return
  }
  const remaining = Number(result && result.remaining) || 0
  reportPending(remaining)
  reportFootprint()
  if (remaining > 0) schedulePendingStep(Number(result && result.nextDueMs) || 0)
}

async function fetchImage(token, request) {
  const image = call("fetchImage", request)
  const bytes = fromBase64(image.base64)
  const response = await fetch(`/result/${encodeURIComponent(String(token || ""))}`, {
    method: "POST",
    body: bytes,
  })
  if (!response.ok) throw new Error(`result post failed: ${response.status}`)
  return { bytes: bytes.byteLength, mime: image.mime || null, url: image.url || null }
}

async function handle(message) {
  if (message.type === "load") {
    sourceKey = typeof message.sourceKey === "string" ? message.sourceKey : ""
    return await load(message.prefs, message.userAgent)
  }
  if (message.type === "call") {
    currentOp = String(message.op || "")
    return call(message.op, message.args)
  }
  if (message.type === "fetchImage") {
    currentOp = "fetchImage"
    return await fetchImage(message.token, message.request)
  }
  if (message.type === "stats") return { logCount, lastLog }
  // 測試縫（比照 detachSourceHostPage）：實機上找不到穩定能讓 dexvm panic 的 apk，
  // 所以由 worker 自己模擬 trap 與 eval_js，讓探針驗得到那兩條路。
  if (message.type === "probe") {
    if (message.case === "trap") {
      const error = new Error("simulated trap")
      error.kind = "trap"
      throw error
    }
    if (message.case === "eval") return JSON.parse(evalJs(String(message.src)))
    if (message.case === "memory") return { wasm: vm ? vm.exports.memory.buffer.byteLength : 0 }
    throw new Error("unknown probe case: " + message.case)
  }
  throw new Error("unknown message: " + message.type)
}

/** `kind === 'trap'`：wasm 實例已作廢，宿主只會丟掉這個源重載（SourceWorkerError）。 */
self.onmessage = (event) => {
  const message = event.data
  // 宿主的呼叫優先：先把背景 job 的計時器收掉，回完再從頭排。
  const hostOp = message.type === "call" || message.type === "fetchImage"
  if (hostOp) cancelPendingStep()
  handle(message).then(
    (value) => {
      self.postMessage({ id: message.id, ok: true, value })
      reportFootprint()
      if (hostOp) schedulePendingStep(0)
    },
    (error) => {
      self.postMessage({
        id: message.id,
        ok: false,
        error: String((error && error.message) || error),
        kind: (error && error.kind) || "internal",
        fatal: (error && error.kind) === "trap",
      })
      reportFootprint()
      if (hostOp) schedulePendingStep(0)
    }
  )
}
