// Mihon（keiyoushi）擴充執行器：在 module worker 裡用 dexvm-wasm 解譯 apk。
// dexvm 的 `host.http` 是同步 import，所以這裡走同步 XHR 到宿主的 `/proxy`；
// 圖片位元組不經 messageHandlers，改用 `/result/<token>`。

import { createDexvm } from "./dexvm-host.js"

let sourceKey = ""
let vm = null
let vmHandle = null
let logCount = 0
let lastLog = ""

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
  const body = { sourceKey, url: request.url, method: request.method || "GET", headers }
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
    headers: parseHeaderLines(xhr.getAllResponseHeaders()),
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

async function load(prefs) {
  const startedAt = Date.now()
  const apk = fetchApk()
  const fetchedAt = Date.now()

  const response = await fetch("/mihon/dexvm_bridge.wasm")
  if (!response.ok) throw new Error(`dexvm wasm fetch failed: ${response.status}`)
  const wasm = await response.arrayBuffer()
  const wasmAt = Date.now()

  vm = await createDexvm({ wasmBytes: wasm, http: proxySync, log: note, evalJs, sleep: sleepSync })
  vmHandle = null
  const instanceAt = Date.now()

  const opened = vm.call("open", { apkBase64: toBase64(apk), prefs: prefs || {} })
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
  const payload = Object.assign({}, args || {})
  if (op !== "open" && op !== "cookies") payload.handle = vmHandle
  return vm.call(op, payload)
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
    return await load(message.prefs)
  }
  if (message.type === "call") return call(message.op, message.args)
  if (message.type === "fetchImage") return await fetchImage(message.token, message.request)
  if (message.type === "stats") return { logCount, lastLog }
  // 測試縫（比照 detachAidokuHostPage）：實機上找不到穩定能讓 dexvm panic 的 apk，
  // 所以由 worker 自己模擬 trap 與 eval_js，讓探針驗得到那兩條路。
  if (message.type === "probe") {
    if (message.case === "trap") {
      const error = new Error("simulated trap")
      error.kind = "trap"
      throw error
    }
    if (message.case === "eval") return JSON.parse(evalJs(String(message.src)))
    throw new Error("unknown probe case: " + message.case)
  }
  throw new Error("unknown message: " + message.type)
}

/** `kind === 'trap'`：wasm 實例已作廢，宿主只會丟掉這個源重載（AidokuWorkerError）。 */
self.onmessage = (event) => {
  const message = event.data
  handle(message).then(
    (value) => self.postMessage({ id: message.id, ok: true, value }),
    (error) =>
      self.postMessage({
        id: message.id,
        ok: false,
        error: String((error && error.message) || error),
        kind: (error && error.kind) || "internal",
        fatal: (error && error.kind) === "trap",
      })
  )
}
