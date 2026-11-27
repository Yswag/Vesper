// 頁面端的橋：每個源一個 worker（上限與要回收哪個由宿主決定），結果用 script message handler 推回宿主。
// 同一個源仍然序列（宿主那邊排隊），不同源真的並行：一個 worker 卡住只影響它自己的源。

let nextId = 1
/** sourceKey → { worker, pending: Map, dead, script } */
const workers = new Map()
/** 這個源用哪一種 worker（載入時由宿主決定；回收後重建仍然用它）。 */
const kinds = new Map()

function workerScript(sourceKey) {
  return kinds.get(sourceKey) === "mihon" ? "/mihon/worker.js" : "/worker.js"
}

function ensureWorker(sourceKey) {
  const script = workerScript(sourceKey)
  const existing = workers.get(sourceKey)
  if (existing && !existing.dead && existing.script === script) return existing
  if (existing) dropEntry(existing)

  const worker = new Worker(script, { type: "module" })
  const entry = { worker, pending: new Map(), dead: false, script, key: sourceKey, pendingJobs: 0 }
  worker.onmessage = (event) => {
    const message = event.data
    // worker 自己回報背景 job 還有幾個：宿主靠它排回收順序。
    if (message.type === "pending") {
      entry.pendingJobs = Math.max(0, Number(message.remaining) || 0)
      reportPending(entry.key, entry.pendingJobs)
      return
    }
    // worker 自己回報 wasm 記憶體：宿主超過預算時先收佔最多的。
    if (message.type === "footprint") {
      reportFootprint(entry.key, Math.max(0, Number(message.bytes) || 0))
      return
    }
    const waiter = entry.pending.get(message.id)
    if (!waiter) return
    if (message.ok) {
      entry.pending.delete(message.id)
      waiter.resolve(message.value)
      return
    }
    // 實例已經作廢（dexvm 的 trap）：這支 worker 留著也只會一直回同樣的錯，直接收掉。
    if (message.fatal === true) {
      failWorker(entry, message.error || "worker failed")
      return
    }
    entry.pending.delete(message.id)
    waiter.reject(new Error(message.error || "source worker error"))
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

function dropEntry(entry) {
  entry.dead = true
  entry.pendingJobs = 0
  for (const waiter of entry.pending.values()) waiter.reject(new Error("worker dropped"))
  entry.pending.clear()
  try {
    entry.worker.terminate()
  } catch (error) {
    // 已經死掉的 worker terminate 會丟錯，忽略
  }
}

/** 這個 worker 自己說它壞到救不回來：整支收掉，手邊的呼叫全部當致命錯誤（= 只丟這個源）。 */
function failWorker(entry, message) {
  entry.dead = true
  entry.pendingJobs = 0
  const error = new Error(message)
  error.fatal = true
  for (const waiter of [...entry.pending.values()]) waiter.reject(error)
  entry.pending.clear()
  try {
    entry.worker.terminate()
  } catch (terminateError) {
    // 已經死掉的 worker terminate 會丟錯，忽略
  }
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

function report(taskId, sourceKey, ok, value, error, fatal) {  try {
    window.webkit.messageHandlers.sourceResult.postMessage({
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

/** 背景 job 的剩餘數：不帶 taskId，宿主收到就只記在對應的源上。 */
function reportPending(sourceKey, remaining) {
  try {
    window.webkit.messageHandlers.sourceResult.postMessage({ pending: true, sourceKey, remaining })
  } catch (postError) {
    // 宿主沒註冊 handler 時就只留在頁面上
  }
}

function reportFootprint(sourceKey, bytes) {
  try {
    window.webkit.messageHandlers.sourceResult.postMessage({ footprint: true, sourceKey, bytes })
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
  if (kind === "loadMihon") {
    // apk 由 worker 自己用同步 XHR 向宿主拿（位元組不經 messageHandlers）。
    return await send(sourceKey, {
      type: "load",
      prefs: payload.prefs || {},
      userAgent: payload.userAgent || "",
    })
  }
  if (kind === "mihonCall") {
    return await send(sourceKey, { type: "call", op: payload.op, args: payload.args || {} })
  }
  if (kind === "mihonFetchImage") {
    return await send(sourceKey, { type: "fetchImage", token: payload.token, request: payload.request })
  }
  if (kind === "mihonProbe") {
    return await send(sourceKey, { type: "probe", ...payload.probe })
  }
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

function start(taskId, sourceKey, kind, payload, workerKind) {
  if (workerKind) kinds.set(sourceKey, workerKind)
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
      const fatal = Boolean((error && error.fatal) || (entry && entry.dead))
      report(taskId, sourceKey, false, undefined, String((error && error.message) || error), fatal)
    }
  )
  return true
}

window.__sourceHost = {
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
  startLoadMihon(taskId, sourceKey, prefs, userAgent) {
    return start(taskId, sourceKey, "loadMihon", { prefs, userAgent }, "mihon")
  },
  startMihonCall(taskId, sourceKey, op, args) {
    return start(taskId, sourceKey, "mihonCall", { op, args })
  },
  startMihonFetchImage(taskId, sourceKey, token, request) {
    return start(taskId, sourceKey, "mihonFetchImage", { token, request })
  },
  startMihonProbe(taskId, sourceKey, probe) {
    return start(taskId, sourceKey, "mihonProbe", { probe })
  },
  /** 宿主決定回收這個源時叫的：worker 連它的 wasm 一起丟掉。 */
  dropSource(sourceKey) {
    const entry = workers.get(sourceKey)
    if (!entry) return true
    workers.delete(sourceKey)
    dropEntry(entry)
    return true
  },
}
