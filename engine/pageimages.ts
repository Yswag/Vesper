import type { AbortSignal } from "scripting"

import { Convert } from "./convert"
import { formatBytes } from "./format"
import { fetchProcessedImage, toCacheSpec } from "./imagecache"
import { resolveImageRequest, type SourceCallRetry } from "./images"
import { log } from "./log"

const MAX_PAGES = 24
const MAX_BYTES = 30 * 1024 * 1024

function labelOf(url: string): string {
  return url.length > 40 ? "…" + url.slice(-40) : url
}

function keyOf(url: string, modifyImage: string | undefined): string {
  return Convert.hexEncode(Convert.md5(Convert.encodeUtf8(url + "\n" + (modifyImage ?? ""))))
}

export interface PageImageRequest {
  sourceKey: string
  imageKey: string
  comicId: string
  epId: string
  comicModule: unknown
  retry?: SourceCallRetry
}

export interface PageCache {
  bytes(request: PageImageRequest, signal?: AbortSignal): Promise<Uint8Array>
  clear(): void
  dropBytes(): void
}

export function createPageCache(): PageCache {
  const pages = new Map<string, Uint8Array>()
  let bytesInCache = 0

  const resolved = new Map<string, { key: string; spec: ReturnType<typeof toCacheSpec> }>()

  const inflight = new Map<string, Promise<Uint8Array>>()

  let generation = 0

  function take(key: string): Uint8Array | undefined {
    const hit = pages.get(key)
    if (!hit) return undefined
    pages.delete(key)
    pages.set(key, hit)
    return hit
  }

  function keep(key: string, bytes: Uint8Array): void {
    const existing = pages.get(key)
    if (existing) {
      pages.delete(key)
      bytesInCache -= existing.byteLength
    }
    pages.set(key, bytes)
    bytesInCache += bytes.byteLength
    while (pages.size > MAX_PAGES || bytesInCache > MAX_BYTES) {
      const oldest = pages.keys().next().value
      if (oldest === undefined) break
      const dropped = pages.get(oldest)
      pages.delete(oldest)
      bytesInCache -= dropped?.byteLength ?? 0
    }
  }

  function forget(key: string, task: Promise<Uint8Array>): void {
    if (inflight.get(key) === task) inflight.delete(key)
  }

  return {
    async bytes(request, signal) {
      let known = resolved.get(request.imageKey)
      if (known) {
        log("debug", "image", `正文略過源解析（同一張圖已解析過）（${labelOf(known.spec.url)}）`)
      } else {
        const spec = toCacheSpec(
          await resolveImageRequest(
            request.comicModule,
            request.imageKey,
            request.comicId,
            request.epId,
            request.retry
          )
        )
        known = { key: keyOf(spec.url, spec.modifyImage), spec }
        resolved.set(request.imageKey, known)
      }
      const { key, spec } = known

      const hit = take(key)
      if (hit) {
        log("debug", "image", `正文命中記憶體 ${formatBytes(hit.byteLength)}（${labelOf(spec.url)}）`)
        return hit
      }

      const pending = inflight.get(key)
      if (pending) {
        log("debug", "image", `正文與進行中的請求共用（${labelOf(spec.url)}）`)
        return pending
      }

      const started = Date.now()
      const at = generation
      const task = fetchProcessedImage(spec, request.sourceKey, signal).then(bytes => {
        if (at === generation) {
          keep(key, bytes)
        } else {
          log("debug", "image", `正文回來時已被清掉（不回寫）（${labelOf(spec.url)}）`)
        }
        log(
          "debug",
          "image",
          `正文冷抓 ${Date.now() - started}ms ${formatBytes(bytes.byteLength)}（${labelOf(spec.url)}）`
        )
        return bytes
      })
      inflight.set(key, task)
      task.then(
        () => forget(key, task),
        () => forget(key, task)
      )
      return task
    },

    clear() {
      generation++
      pages.clear()
      bytesInCache = 0
      inflight.clear()
      resolved.clear()
    },

    dropBytes() {
      generation++
      pages.clear()
      bytesInCache = 0
    },
  }
}
