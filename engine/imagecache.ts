// 縮圖磁碟快取（封面／頭像／留言圖）。**正文不在這裡**——正文走 `engine/pageimages.ts`
// 的記憶體管線（看過短時間不會重看，不該長期佔著磁碟）。
//
// 為什麼不直接用 <Image imageUrl>：它不能帶 Referer / Cookie，而漫畫站的圖幾乎都會擋。
// 所以一律由我們自己抓位元組，存成本地檔案再顯示——順便就是快取。
//
// 來源要求的兩段後處理都在這條路上：onResponse（改寫位元組，例如 ccc 的 AES）與
// modifyImage（重排圖片，例如 jm 的條帶）。合成器由 UI 層注入——engine 不碰 UI 框架；
// 沒注入時遇到 modifyImage 就明確失敗，而不是默默顯示未處理的圖。
//
// 清理由 `clearImageCache()`（設定頁的「清除縮圖快取」）負責。

import type { AbortSignal } from "scripting"

import { Convert } from "./convert"
import { appDataRoot, ensureDir, exists, join, remove } from "./fs"
import { fetchImageBytes } from "./http"
import { runModifyImage, type ImageCompositor } from "./imageprocess"
import { absoluteUrl, normalizeImageConfig, type ImageRequest } from "./images"
import { log } from "./log"
import { kv } from "./storage"
import { getMaxAgeDays, getMaxSizeBytes } from "../app/cacheSetting"

const inflight = new Map<string, Promise<string>>()
/** 寫入計數器：每累積 50 次寫入觸發一次非同步清理檢查。 */
let writeCounter = 0

let compositor: ImageCompositor | null = null

/** 由入口註冊一次。 */
export function setImageCompositor(next: ImageCompositor) {
  compositor = next
}

function cacheDir(): string {
  return join(appDataRoot(), "cache", "images")
}

function hashKey(value: string): string {
  return Convert.hexEncode(Convert.md5(Convert.encodeUtf8(value)))
}

/**
 * 快取鍵要含 modifyImage 的內容：同一張圖在不同 epId 下的重排參數可能不同，源更新也會改腳本。
 * 只用 URL 當鍵的話，「圖錯了但快取住了」會很難追。
 */
function cachePath(spec: ImageRequestSpec): string {
  return join(cacheDir(), hashKey(spec.url + "\n" + (spec.modifyImage ?? "")) + ".bin")
}

export interface ImageRequestSpec {
  url: string
  headers: Record<string, string>
  /** 源用來改寫回應位元組（例如 ccc 用 AES-CBC 解密整張圖）。 */
  onResponse?: (bytes: any) => any
  /** 源用來重排圖片（Venera 的 Image API 腳本字串）。 */
  modifyImage?: string
  /** 抓圖失敗時叫一次，回一組新的設定（或 null 放棄）；Venera 的語意是一次性。 */
  onLoadFailed?: () => unknown
}

/** 源的圖片設定 → 快取層吃的規格（URL 一律絕對化）。離線層與閱讀器都走這一個。 */
export function toCacheSpec(request: ImageRequest): ImageRequestSpec {
  return {
    url: absoluteUrl(request.url),
    headers: request.headers,
    onResponse: request.onResponse,
    modifyImage: request.modifyImage,
    onLoadFailed: request.onLoadFailed,
  }
}

/**
 * 網路 → `onResponse` → `modifyImage`：源的兩段後處理都在這裡，**不碰磁碟**。
 *
 * 兩個消費端共用（舊的磁碟快取、正文的記憶體管線 `pageimages.ts`），
 * 所以「圖抓到了但後處理沒跑」不可能發生——後處理是這支函式的一部分，拆不掉。
 * `signal` 只有真的有給才生效（不給＝不可取消，舊路徑行為不變）。
 */
export async function fetchProcessedImage(
  spec: ImageRequestSpec,
  sourceKey: string,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const response = await fetchImageBytes(spec.url, spec.headers, sourceKey, signal)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`)
  }

  // onResponse：源自己改寫位元組（解密、去頭…）。契約是收發 ArrayBuffer，
  // 但實務上源也會回 Uint8Array，兩種都要吃。
  let body: any = response.body
  if (typeof spec.onResponse === "function") {
    const transformed = await spec.onResponse(body)
    if (transformed != null) body = transformed
  }

  let bytes: Uint8Array = body instanceof Uint8Array ? body : new Uint8Array(body)
  if (spec.modifyImage) {
    try {
      bytes = await applyModifyImage(spec.modifyImage, bytes)
    } catch (error) {
      throw new Error(`modifyImage：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return bytes
}

/** 跟 Venera 一樣：重試上限，但因為 onLoadFailed 是一次性的，通常只會用到一次。 */
const RETRY_LIMIT = 5

/** 跑源的 onLoadFailed 並把結果正規化；不是普通物件（含 null）就當作放棄。 */
async function askRetry(handler: () => unknown, fallbackUrl: string): Promise<ImageRequestSpec | null> {
  try {
    const result = await handler()
    if (!result || typeof result !== "object" || Array.isArray(result)) return null
    return normalizeImageConfig(fallbackUrl, result)
  } catch (error) {
    // Venera 會讓 onLoadFailed 的錯直接往外傳；我們記一筆然後回報原本的錯誤，比較好追。
    log("warning", "image", "onLoadFailed 丟錯", error)
    return null
  }
}

/** 解碼 → 跑源的 modifyImage → 合成。給圖片管線用。 */
export async function applyModifyImage(script: string, bytes: Uint8Array): Promise<Uint8Array> {
  if (!compositor) throw new Error("合成器未註冊")
  const data = Data.fromUint8Array(bytes)
  if (!data) throw new Error("位元組無法轉成 Data")
  const decoded = UIImage.fromData(data)
  if (!decoded) throw new Error("圖片無法解碼")
  return compositor(runModifyImage(script, decoded))
}

/**
 * 取得圖片的本地檔案路徑；已快取就直接回傳。
 * 同一個 URL 同時被要求多次時只會抓一次。
 */
export function cachedImagePath(spec: ImageRequestSpec, sourceKey: string): Promise<string> {
  const path = cachePath(spec)
  if (exists(path)) return Promise.resolve(path)

  const pending = inflight.get(path)
  if (pending) return pending

  const task = (async () => {
    let current = spec
    let onLoadFailed = typeof spec.onLoadFailed === "function" ? spec.onLoadFailed : null
    let retryLimit = RETRY_LIMIT

    for (;;) {
      try {
        const bytes = await fetchProcessedImage(current, sourceKey)
        ensureDir(cacheDir())
        const temp = path + ".part"
        FileManager.writeAsBytesSync(temp, bytes)
        if (exists(path)) remove(path)
        FileManager.renameSync(temp, path)

        writeCounter++
        if (writeCounter >= 50) {
          writeCounter = 0
          void autoCleanImageCache()
        }
        return path
      } catch (error) {
        if (retryLimit < 0 || !onLoadFailed) throw error
        const handler = onLoadFailed
        // 一次性：Venera 呼叫完就丟掉，新的設定要自己再帶一個才會繼續重試。
        onLoadFailed = null
        const next = await askRetry(handler, spec.url)
        if (!next) throw error
        current = next
        retryLimit--
      }
    }
  })()

  inflight.set(path, task)
  task
    .catch(error => {
      log("warning", "image", `抓圖失敗 ${spec.url.slice(0, 80)}`, error)
    })
    .finally(() => {
      inflight.delete(path)
    })
  return task
}

export function clearImageCache() {
  remove(cacheDir())
}

/**
 * 取得快取的檔案數與總位元組數（非同步遍歷統計）。
 */
export async function getCacheStats(): Promise<{ count: number; totalBytes: number }> {
  try {
    const dir = cacheDir()
    if (!exists(dir)) return { count: 0, totalBytes: 0 }
    const files = await FileManager.readDirectory(dir)
    let totalBytes = 0
    let count = 0
    for (const file of files) {
      if (file.endsWith(".part")) continue
      try {
        const stat = FileManager.statSync(join(dir, file))
        if (stat.type === "file" || stat.type === "NSFileTypeRegular") {
          totalBytes += stat.size
          count++
        }
      } catch {
        // 檔案可能剛被刪除或暫不可讀
      }
    }
    return { count, totalBytes }
  } catch {
    return { count: 0, totalBytes: 0 }
  }
}

/**
 * 依據設定的策略（保留天數與容量上限）執行自動清理。
 * - 過期天數：刪除 modificationDate 超過 maxAgeDays 的檔案。
 * - 容量超標：依修改時間由舊到新刪除，降水位線至 80%。
 * 安全機制：跳過 .part 檔與 inflight 中的路徑。
 */
export async function autoCleanImageCache(): Promise<{ removedCount: number; freedBytes: number }> {
  try {
    const dir = cacheDir()
    if (!exists(dir)) return { removedCount: 0, freedBytes: 0 }

    const maxAgeDays = getMaxAgeDays()
    const maxSizeBytes = getMaxSizeBytes()
    if (maxAgeDays === 0 && maxSizeBytes === 0) {
      return { removedCount: 0, freedBytes: 0 }
    }

    const files = await FileManager.readDirectory(dir)
    const now = Date.now()
    const maxAgeMs = maxAgeDays > 0 ? maxAgeDays * 24 * 60 * 60 * 1000 : 0
    const inflightPaths = new Set(inflight.keys())

    type CachedFile = { path: string; size: number; mtime: number }
    const validFiles: CachedFile[] = []
    let totalSize = 0
    let removedCount = 0
    let freedBytes = 0

    for (const file of files) {
      if (file.endsWith(".part")) continue
      const fullPath = join(dir, file)
      if (inflightPaths.has(fullPath)) continue

      try {
        const stat = FileManager.statSync(fullPath)
        if (stat.type !== "file" && stat.type !== "NSFileTypeRegular") continue

        // 1. 檢查是否時間過期
        if (maxAgeMs > 0 && now - stat.modificationDate > maxAgeMs) {
          FileManager.removeSync(fullPath)
          removedCount++
          freedBytes += stat.size
        } else {
          validFiles.push({ path: fullPath, size: stat.size, mtime: stat.modificationDate })
          totalSize += stat.size
        }
      } catch {
        // 忽略單一檔案讀取錯誤
      }
    }

    // 2. 檢查容量是否超標，若超標則由舊至新刪除直到降至 80% 容量
    if (maxSizeBytes > 0 && totalSize > maxSizeBytes) {
      const targetSize = Math.floor(maxSizeBytes * 0.8)
      // 依 mtime 由舊到新（升序）
      validFiles.sort((a, b) => a.mtime - b.mtime)

      for (const item of validFiles) {
        if (totalSize <= targetSize) break
        try {
          FileManager.removeSync(item.path)
          removedCount++
          freedBytes += item.size
          totalSize -= item.size
        } catch {
          // 忽略刪除錯誤
        }
      }
    }

    if (removedCount > 0) {
      log("info", "cache", `縮圖自動清理完成：刪除 ${removedCount} 個檔案，釋放 ${Math.round(freedBytes / (1024 * 1024))} MB`)
    }

    return { removedCount, freedBytes }
  } catch (error) {
    log("warning", "cache", "縮圖自動清理過程發生錯誤", error)
    return { removedCount: 0, freedBytes: 0 }
  }
}

/** 舊版的圖片快取（正文與縮圖混在同一個目錄、鍵不含種類）。 */
const PURGE_FLAG = "vesper.imagecache.purged-legacy"

/**
 * 一次性清空舊的圖片快取。
 *
 * 那一版正文也寫在這裡（鍵不含圖片種類），分不出哪些檔案是正文——沒必要寫遷移邏輯，
 * 整個目錄清掉讓縮圖自己重建。**只做一次**（旗標記在 Storage），啟動時呼叫。
 */
export function purgeLegacyImageCacheOnce(): void {
  if (kv.contains(PURGE_FLAG)) return
  remove(cacheDir())
  kv.set(PURGE_FLAG, true)
}

/**
 * 縮圖快取目錄裡有幾個檔案；讀不到回 `null`。
 *
 * **回數字不回字串**：這裡是 engine，不該產生給人看的文案 —— 那句話由畫面用 `t()` 組。
 */
export function cacheFileCount(): number | null {
  try {
    const dir = cacheDir()
    if (!exists(dir)) return 0
    return FileManager.readDirectorySync(dir).length
  } catch {
    return null
  }
}

/** 縮圖快取目錄（探針拿它算「這個鍵的檔案在不在」）。 */
export { cacheDir }
