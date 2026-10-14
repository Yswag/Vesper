// 正文取圖管線：記憶體 LRU 快取、不落地、請求去重與生命週期隔離。
// 快取儲存原始編碼位元組以節省記憶體，並在換話／退出時透過原子 generation 序號隔離清理。

import type { AbortSignal } from "scripting"

import { Convert } from "./convert"
import { formatBytes } from "./format"
import { fetchProcessedImage, toCacheSpec } from "./imagecache"
import { resolveImageRequest, type SourceCallRetry } from "./images"
import { log } from "./log"

/** 上限寫死（之後要調再說，不做設定 UI）：24 頁或 30MB，先到者為限。 */
const MAX_PAGES = 24
const MAX_BYTES = 30 * 1024 * 1024

/** 日誌用的短標籤（LogScreen 要能對回是哪一張圖）。 */
function labelOf(url: string): string {
  return url.length > 40 ? "…" + url.slice(-40) : url
}

/** 快取鍵：URL + modifyImage 雜湊。 */
function keyOf(url: string, modifyImage: string | undefined): string {
  return Convert.hexEncode(Convert.md5(Convert.encodeUtf8(url + "\n" + (modifyImage ?? ""))))
}

export interface PageImageRequest {
  /** 這張圖屬於哪個源。 */
  sourceKey: string
  imageKey: string
  comicId: string
  epId: string
  /** 源的 comic 區塊（呼叫 onImageLoad 用）。 */
  comicModule: unknown
  /** 解析圖片請求時的重試（登入過期自動重登），由呼叫端提供。 */
  retry?: SourceCallRetry
}

/** 正文記憶體快取介面（每個閱讀 session 獨立持有實例）。 */
export interface PageCache {
  /** 取得一頁正文位元組（記憶體 LRU ➔ 網路）。失敗不存入 LRU，支援 signal 取消。 */
  bytes(request: PageImageRequest, signal?: AbortSignal): Promise<Uint8Array>
  /** 放掉整份（換話／退出）。清掉之後，**在飛的請求完成時不會回寫**。 */
  clear(): void
}

export function createPageCache(): PageCache {
  /** `Map` 是插入序，最近用過的往後排就是 LRU。 */
  const pages = new Map<string, Uint8Array>()
  let bytesInCache = 0

  /** 進行中的取圖請求映射表（避免同頁並發重複請求）。 */
  const inflight = new Map<string, Promise<Uint8Array>>()

  /** 世代序號：clear() 時遞增，避免過期請求完成後錯誤回寫已釋放的快取。 */
  let generation = 0

  function take(key: string): Uint8Array | undefined {
    const hit = pages.get(key)
    if (!hit) return undefined
    pages.delete(key)
    pages.set(key, hit)
    return hit
  }

  /** 存進去；超過上限就從最舊的開始丟（單張自己就超過上限時，它自己也會被丟掉）。 */
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
      const resolved = await resolveImageRequest(
        request.comicModule,
        request.imageKey,
        request.comicId,
        request.epId,
        request.retry
      )
      const spec = toCacheSpec(resolved)
      const key = keyOf(spec.url, spec.modifyImage)

      const hit = take(key)
      if (hit) {
        // 量測用（debug，不落地）：翻頁時看到這一行就是記憶體命中。
        log("debug", "image", `正文命中記憶體 ${formatBytes(hit.byteLength)}（${labelOf(spec.url)}）`)
        return hit
      }

      // 同一個鍵同時被要兩次：共用同一個請求（成功只 `keep()` 一次）。
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
          // `clear()` 之後才回來的：位元組照樣給呼叫端，但不回寫（那一份快取已經被放掉了）。
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
      // 失敗不留在 map（下一次要重抓）；成功也移掉（已經在 LRU 了）。
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
    },
  }
}
