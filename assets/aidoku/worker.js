// Aidoku 源執行器：在 module worker 裡跑 wasm 源。同步 XHR 經 /proxy 交給宿主發請求。

import { createLoadSource } from "./rt/runtime.bundle.js"
import { createCanvasImports, createHostImage, getHostImageData } from "./rt/canvas.js"

const loadSource = createLoadSource({ createCanvasImports, createHostImage, getHostImageData })

let current = null
let currentSettings = {}

const DEFAULT_TYPES = new Set([
  "select",
  "picker",
  "multi-select",
  "multi-single-select",
  "switch",
  "slider",
  "stepper",
  "segment",
  "text",
  "editable-list",
])

/** 從 settings.json 的 schema 抽預設值（group/page 往下掘）。 */
function extractDefaults(schema) {
  const defaults = {}
  if (!Array.isArray(schema)) return defaults
  const stack = [{ list: schema, index: 0, depth: 0 }]
  let visited = 0
  while (stack.length > 0 && visited < 1024) {
    const frame = stack[stack.length - 1]
    if (frame.index >= frame.list.length) {
      stack.pop()
      continue
    }
    const node = frame.list[frame.index++]
    visited += 1
    if (!node || typeof node !== "object") continue
    if (node.type === "group" || node.type === "page") {
      if (Array.isArray(node.items) && frame.depth < 8) {
        stack.push({ list: node.items, index: 0, depth: frame.depth + 1 })
      }
      continue
    }
    if (typeof node.type !== "string" || !DEFAULT_TYPES.has(node.type)) continue
    if (typeof node.key !== "string" || node.key.length === 0) continue
    if (node.default === undefined) continue
    defaults[node.key] = node.default
  }
  return defaults
}

/** 使用者值疊上去：只認真的有給值的 key（undefined 不能蓋掉預設）。 */
function applyUserSettings(settings, user) {
  if (!user || typeof user !== "object") return settings
  for (const key of Object.keys(user)) {
    if (user[key] !== undefined) settings[key] = user[key]
  }
  return settings
}

/** schema 預設 → 使用者值 → manifest 預設（只在 undefined 時補）。 */
function buildSettings(schema, manifest, user) {
  const settings = extractDefaults(schema)
  applyUserSettings(settings, user)
  applyManifestDefaults(settings, manifest)
  return settings
}

function parseHeaders(raw) {
  const headers = {}
  for (const line of String(raw || "").split(/\r?\n/)) {
    const index = line.indexOf(":")
    if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim()
  }
  return headers
}

const httpBridge = {
  request(request) {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/proxy", false)
    xhr.responseType = "arraybuffer"
    xhr.setRequestHeader("Content-Type", "application/json")
    xhr.send(
      JSON.stringify({
        url: request.url,
        method: request.method || "GET",
        headers: request.headers || {},
        body: request.body == null ? null : request.body,
      })
    )
    const buffer = xhr.response
    const bytes = buffer ? new Uint8Array(buffer) : null
    const headers = parseHeaders(xhr.getAllResponseHeaders())
    return {
      status: xhr.status,
      headers,
      body: bytes ? new TextDecoder("utf-8").decode(bytes) : "",
      bytes,
      url: headers["x-nemu-final-url"] || request.url,
    }
  },
}

function applyManifestDefaults(settings, manifest) {
  const config = manifest && manifest.config ? manifest.config : {}
  const info = manifest && manifest.info ? manifest.info : {}
  if (config.allowsBaseUrlSelect && Array.isArray(info.urls) && info.urls.length > 0 && settings.url === undefined) {
    settings.url = info.urls[0]
  }
  if (Array.isArray(info.languages) && info.languages.length > 0 && settings.languages === undefined) {
    settings.languages = config.languageSelectType === "multi" ? info.languages : [info.languages[0]]
  }
}

async function handle(message) {
  if (message.type === "selftest") {
    const response = httpBridge.request({ url: "https://example.com/", method: "GET", headers: {}, body: null })
    return { status: response.status, length: (response.body || "").length }
  }

  if (message.type === "load") {
    // 兩種輸入：`.aix` 原檔（bytes），或已解開的檔案（components）。
    const input = message.components
      ? {
          manifest: message.components.manifest,
          settingsJson: message.components.settingsJson,
          wasmBytes: new Uint8Array(message.components.wasmBytes),
        }
      : new Uint8Array(message.bytes)
    const user = message.settings || {}
    // 先墊一份：載入期間源就可能讀設定（正式載入後會用真正解析出來的 schema 重算）。
    if (message.components) {
      currentSettings = buildSettings(message.components.settingsJson, message.components.manifest, user)
    }
    const source = await loadSource(input, message.sourceKey, {
      httpBridge,
      settingsGetter: (key) => currentSettings[key],
      settingsSetter: () => {},
    })
    current = source
    currentSettings = buildSettings(source.settingsJson, source.manifest, user)
    return { manifest: source.manifest, settingsJson: source.settingsJson ?? null, defaults: currentSettings }
  }

  // 唯讀：驗證「使用者值真的進到源看到的設定裡」用（探針）。
  if (message.type === "settingsSnapshot") {
    return { ...currentSettings }
  }

  if (message.type === "initialize") {
    if (!current) throw new Error("source not loaded")
    current.initialize()
    return true
  }

  // 源有沒有 `process_page_image`：有就代表頁面圖要解密／解拼。
  if (message.type === "hasImageProcessor") {
    return Boolean(current?.hasImageProcessor)
  }

  // 頁面圖位元組走 loopback HTTP（worker 裡是 async fetch，主執行緒不會被凍住）。
  if (message.type === "processPageImage") {
    if (!current) throw new Error("source not loaded")
    if (!current.hasImageProcessor) throw new Error("source has no process_page_image")
    const token = encodeURIComponent(String(message.token || ""))
    const input = await fetch(`/job/${token}`)
    if (!input.ok) throw new Error(`job fetch failed: ${input.status}`)
    const bytes = new Uint8Array(await input.arrayBuffer())

    const meta = message.request || {}
    const processed = await current.processPageImage(
      bytes,
      null,
      String(meta.url || ""),
      meta.headers || {},
      Number(meta.status || 200),
      meta.responseHeaders || {}
    )
    if (!processed) throw new Error("process_page_image returned no image")

    const output = await fetch(`/result/${token}`, { method: "POST", body: processed })
    if (!output.ok) throw new Error(`result post failed: ${output.status}`)
    return true
  }

  if (message.type === "call") {
    if (!current) throw new Error("source not loaded")
    const method = current[message.method]
    if (typeof method !== "function") throw new Error("unknown method: " + message.method)
    return await method.apply(current, message.args || [])
  }

  throw new Error("unknown message: " + message.type)
}

self.onmessage = (event) => {
  const message = event.data
  handle(message).then(
    (value) => self.postMessage({ id: message.id, ok: true, value }),
    (error) => self.postMessage({ id: message.id, ok: false, error: String((error && error.message) || error) })
  )
}
