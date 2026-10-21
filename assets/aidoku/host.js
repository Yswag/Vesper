// 頁面端的橋：工作丟給 worker，結果用 script message handler 推回宿主。
// 不能在 worker 做同步 XHR 時讓宿主呼叫 evaluateJavaScript —— 那會互相卡死。

const worker = new Worker("/worker.js", { type: "module" })

let nextId = 1
const pending = new Map()
let workerDead = false

worker.onmessage = (event) => {
  const message = event.data
  const entry = pending.get(message.id)
  if (!entry) return
  pending.delete(message.id)
  if (message.ok) entry.resolve(message.value)
  else entry.reject(new Error(message.error || "aidoku worker error"))
}

worker.onerror = (event) => {
  workerDead = true
  const error = new Error("worker error: " + (event.message || "unknown"))
  for (const entry of pending.values()) entry.reject(error)
  pending.clear()
}

function send(message, transfer) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    worker.postMessage({ ...message, id }, transfer || [])
  })
}

function report(taskId, ok, value, error, fatal) {
  try {
    window.webkit.messageHandlers.aidokuResult.postMessage({ id: taskId, ok, value, error, fatal: fatal === true })
  } catch (postError) {
    // 宿主沒註冊 handler 時就只留在頁面上
  }
}

async function dispatch(kind, payload) {
  if (kind === "load") {
    const response = await fetch(payload.url || "/aix")
    if (!response.ok) throw new Error("aix fetch failed: " + response.status)
    const bytes = await response.arrayBuffer()
    return await send(
      { type: "load", sourceKey: payload.sourceKey, bytes, settings: payload.settings || {} },
      [bytes]
    )
  }
  if (kind === "loadPackage") {
    const metaResponse = await fetch("/manifest")
    if (!metaResponse.ok) throw new Error("manifest fetch failed: " + metaResponse.status)
    const meta = await metaResponse.json()
    const wasmResponse = await fetch("/wasm")
    if (!wasmResponse.ok) throw new Error("wasm fetch failed: " + wasmResponse.status)
    const wasm = await wasmResponse.arrayBuffer()
    return await send(
      {
        type: "load",
        sourceKey: payload.sourceKey,
        settings: meta.settings || {},
        components: { manifest: meta.manifest, settingsJson: meta.settingsJson, wasmBytes: new Uint8Array(wasm) },
      },
      [wasm]
    )
  }
  if (kind === "initialize") return await send({ type: "initialize" })
  if (kind === "settingsSnapshot") return await send({ type: "settingsSnapshot" })
  if (kind === "hasImageProcessor") return await send({ type: "hasImageProcessor" })
  if (kind === "processPageImage") return await send({ type: "processPageImage", token: payload.token, request: payload.request })
  if (kind === "selftest") return await send({ type: "selftest" })
  if (kind === "call") return await send({ type: "call", method: payload.method, args: payload.args || [] })
  throw new Error("unknown task: " + kind)
}

function start(taskId, kind, payload) {
  // worker 已經掛了：直接告訴宿主（fatal），讓它重建而不是等到逾時。
  if (workerDead) {
    report(taskId, false, undefined, "worker is dead", true)
    return true
  }
  dispatch(kind, payload).then(
    (value) => report(taskId, true, value, undefined, false),
    (error) => report(taskId, false, undefined, String((error && error.message) || error), workerDead)
  )
  return true
}

window.__aidoku = {
  startLoad(taskId, sourceKey, url, settings) {
    return start(taskId, "load", { sourceKey, url, settings })
  },
  startLoadPackage(taskId, sourceKey) {
    return start(taskId, "loadPackage", { sourceKey })
  },
  startInitialize(taskId) {
    return start(taskId, "initialize", {})
  },
  startSettingsSnapshot(taskId) {
    return start(taskId, "settingsSnapshot", {})
  },
  startHasImageProcessor(taskId) {
    return start(taskId, "hasImageProcessor", {})
  },
  startProcessPageImage(taskId, token, request) {
    return start(taskId, "processPageImage", { token, request })
  },
  startSelfTest(taskId) {
    return start(taskId, "selftest", {})
  },
  startCall(taskId, method, args) {
    return start(taskId, "call", { method, args })
  },
}
