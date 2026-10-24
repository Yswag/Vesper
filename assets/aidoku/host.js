// 頁面端的橋：每個源一個 worker（上限與要回收哪個由宿主決定），結果用 script message handler 推回宿主。
// 同一個源仍然序列（宿主那邊排隊），不同源真的並行：一個 worker 卡住只影響它自己的源。

let nextId = 1
/** sourceKey → { worker, pending: Map, dead } */
const workers = new Map()

function ensureWorker(sourceKey) {
  const existing = workers.get(sourceKey)
  if (existing && !existing.dead) return existing

  const worker = new Worker("/worker.js", { type: "module" })
  const entry = { worker, pending: new Map(), dead: false }
  worker.onmessage = (event) => {
    const message = event.data
    const waiter = entry.pending.get(message.id)
    if (!waiter) return
    entry.pending.delete(message.id)
    if (message.ok) waiter.resolve(message.value)
    else waiter.reject(new Error(message.error || "aidoku worker error"))
  }
  worker.onerror = (event) => {
    entry.dead = true
    const error = new Error("worker error: " + (event.message || "unknown"))
    for (const waiter of entry.pending.values()) waiter.reject(error)
    entry.pending.clear()
  }
  workers.set(sourceKey, entry)
  return entry
}

function send(sourceKey, message, transfer) {
  const entry = ensureWorker(sourceKey)
  if (entry.dead) return Promise.reject(new Error("worker is dead"))
  return new Promise((resolve, reject) => {
    const id = nextId++
    entry.pending.set(id, { resolve, reject })
    entry.worker.postMessage({ ...message, id, sourceKey }, transfer || [])
  })
}

function report(taskId, sourceKey, ok, value, error, fatal) {
  try {
    window.webkit.messageHandlers.aidokuResult.postMessage({
      id: taskId,
      sourceKey,
      ok,
      value,
      error,
      fatal: fatal === true,
    })
  } catch (postError) {
    // 宿主沒註冊 handler 時就只留在頁面上
  }
}

/** 載入素材要走 POST body：本機伺服器收到的 `HttpRequest.path` 不帶 query。 */
async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${path} fetch failed: ${response.status}`)
  return response
}

async function dispatch(sourceKey, kind, payload) {
  if (kind === "load") {
    const bytes = await (await postJson("/aix", { sourceKey })).arrayBuffer()
    return await send(sourceKey, { type: "load", settings: payload.settings || {}, bytes }, [bytes])
  }
  if (kind === "loadPackage") {
    const meta = await (await postJson("/manifest", { sourceKey })).json()
    const wasm = await (await postJson("/wasm", { sourceKey })).arrayBuffer()
    return await send(
      sourceKey,
      {
        type: "load",
        settings: meta.settings || {},
        components: { manifest: meta.manifest, settingsJson: meta.settingsJson, wasmBytes: new Uint8Array(wasm) },
      },
      [wasm]
    )
  }
  if (kind === "initialize") return await send(sourceKey, { type: "initialize" })
  if (kind === "notification") return await send(sourceKey, { type: "notification", name: payload.name })
  if (kind === "settingsSnapshot") return await send(sourceKey, { type: "settingsSnapshot" })
  if (kind === "hasImageProcessor") return await send(sourceKey, { type: "hasImageProcessor" })
  if (kind === "processPageImage") {
    return await send(sourceKey, { type: "processPageImage", token: payload.token, request: payload.request })
  }
  if (kind === "selftest") return await send(sourceKey, { type: "selftest" })
  if (kind === "call") return await send(sourceKey, { type: "call", method: payload.method, args: payload.args || [] })
  throw new Error("unknown task: " + kind)
}

function start(taskId, sourceKey, kind, payload) {
  // 這個源的 worker 已經掛了：直接告訴宿主（fatal），讓它只重建這一個源。
  const existing = workers.get(sourceKey)
  if (existing && existing.dead) {
    report(taskId, sourceKey, false, undefined, "worker is dead", true)
    return true
  }
  dispatch(sourceKey, kind, payload).then(
    (value) => report(taskId, sourceKey, true, value, undefined, false),
    (error) => {
      const entry = workers.get(sourceKey)
      report(taskId, sourceKey, false, undefined, String((error && error.message) || error), Boolean(entry && entry.dead))
    }
  )
  return true
}

window.__aidoku = {
  startLoad(taskId, sourceKey, settings) {
    return start(taskId, sourceKey, "load", { settings })
  },
  startLoadPackage(taskId, sourceKey) {
    return start(taskId, sourceKey, "loadPackage", {})
  },
  startInitialize(taskId, sourceKey) {
    return start(taskId, sourceKey, "initialize", {})
  },
  startNotification(taskId, sourceKey, name) {
    return start(taskId, sourceKey, "notification", { name })
  },
  startSettingsSnapshot(taskId, sourceKey) {
    return start(taskId, sourceKey, "settingsSnapshot", {})
  },
  startHasImageProcessor(taskId, sourceKey) {
    return start(taskId, sourceKey, "hasImageProcessor", {})
  },
  startProcessPageImage(taskId, sourceKey, token, request) {
    return start(taskId, sourceKey, "processPageImage", { token, request })
  },
  startSelfTest(taskId, sourceKey) {
    return start(taskId, sourceKey, "selftest", {})
  },
  startCall(taskId, sourceKey, method, args) {
    return start(taskId, sourceKey, "call", { method, args })
  },
  /** 宿主決定回收這個源時叫的：worker 連它的 wasm 一起丟掉。 */
  dropSource(sourceKey) {
    const entry = workers.get(sourceKey)
    if (!entry) return true
    workers.delete(sourceKey)
    entry.dead = true
    for (const waiter of entry.pending.values()) waiter.reject(new Error("worker dropped"))
    entry.pending.clear()
    try {
      entry.worker.terminate()
    } catch (error) {
      // 已經死掉的 worker terminate 會丟錯，忽略
    }
    return true
  },
}
