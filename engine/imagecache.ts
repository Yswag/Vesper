// 縮圖磁碟快取（封面／頭像／留言圖）。
// 負責縮圖抓取、onResponse 與 modifyImage 後處理及磁碟快取管理。
// 正文圖片走記憶體管線（engine/pageimages.ts），不在此落地。

import type { AbortSignal } from "scripting"

import { Convert } from "./convert"
import { clearDisplayCache } from "./displaycache"
import { appDataRoot, ensureDir, exists, join, readBytes, remove, writeBytes } from "./fs"
import { fetchImageBytes } from "./http"
import { readImageSize } from "./imagesize"
import { runModifyImage, type ImageCompositor } from "./imageprocess"
import { absoluteUrl, normalizeImageConfig, type ImageRequest, type ImageResponseInfo } from "./images"
import { log } from "./log"
import { kv } from "./storage"
import { getMaxAgeDays, getMaxSizeBytes } from "../app/cacheSetting"

const inflight = new Map<string, Promise<string>>()
/**
 * 快取目前佔用的位元組（-1＝還沒量過）。寫入時累加，只有超標或到期才真的掃目錄——
 * 每 N 次寫入就 `statSync` 整個資料夾，書架幾千張時那一下會卡住主執行緒。
 * 上次量到的值存在 KV，重開 App 也不必先掃一遍。
 */
const CACHE_BYTES_KEY = "vesper.imagecache.bytes"
function storedBytes(): number {
  const raw = kv.get(CACHE_BYTES_KEY)
  return typeof raw === "number" && raw >= 0 ? raw : -1
}
let cacheBytes = storedBytes()
const LAST_SCAN_KEY = "vesper.imagecache.scan"
function storedScanAt(): number {
  const raw = kv.get(LAST_SCAN_KEY)
  return typeof raw === "number" && raw > 0 ? raw : 0
}
let lastScanAt = storedScanAt()
/** 天數策略最多這麼久掃一次。 */
const CLEAN_INTERVAL = 60 * 60 * 1000
let cleaning = false

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

/** 快取鍵包含 URL 與 modifyImage 腳本，避免後處理參數變更時命中錯誤快取。 */
function cachePath(spec: ImageRequestSpec): string {
  return join(cacheDir(), hashKey(spec.url + "\n" + (spec.modifyImage ?? "")) + ".bin")
}

export interface ImageRequestSpec {
  url: string
  headers: Record<string, string>
  /** 源用來改寫回應位元組（例如 ccc 用 AES-CBC 解密整張圖）。 */
  onResponse?: (bytes: any, response?: ImageResponseInfo) => any
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
 * 抓取圖片並依序套用 onResponse 與 modifyImage 後處理（不觸及磁碟快取）。
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
    const transformed = await spec.onResponse(body, { status: response.status, headers: response.headers })
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

/** 請求重試上限。 */
const RETRY_LIMIT = 5

/** 跑源的 onLoadFailed 並把結果正規化；不是普通物件（含 null）就當作放棄。 */
async function askRetry(handler: () => unknown, fallbackUrl: string): Promise<ImageRequestSpec | null> {
  try {
    const result = await handler()
    if (!result || typeof result !== "object" || Array.isArray(result)) return null
    return normalizeImageConfig(fallbackUrl, result)
  } catch (error) {
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
        // 原圖落地後順手做一份顯示用小圖，之後整格網格都讀小的。
        try {
          makeThumbnail(path, spec)
        } catch (error) {
          log("warning", "image", "縮圖降採樣失敗，先顯示原圖", error)
        }

        noteWritten(bytes.byteLength)
        scheduleImageCacheCleanup()
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

// ------------------------------------------------------------------ 縮圖降採樣
/**
 * 縮圖長邊上限（像素）：3 欄網格一格約 330px、詳情頁封面約 1050px，1024 兩邊都夠。
 * 原圖 1500×2100 解成點陣約 12MB，降到 1024 寬只剩約 1 MB。
 */
const THUMB_MAX_EDGE = 1024
const THUMB_QUALITY = 0.82
const THUMB_EXTS = [".thumb.jpg", ".thumb.png"]
const thumbInflight = new Map<string, Promise<string>>()

function thumbBase(spec: ImageRequestSpec): string {
  return join(cacheDir(), hashKey(spec.url + "\n" + (spec.modifyImage ?? "")))
}

/** 已存在的縮圖（PNG／JPEG 兩種副檔名都要找）。 */
function existingThumb(spec: ImageRequestSpec): string | null {
  const base = thumbBase(spec)
  for (const ext of THUMB_EXTS) {
    if (exists(base + ext)) return base + ext
  }
  return null
}

function isPng(bytes: Uint8Array | null): boolean {
  return (
    !!bytes &&
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
}

/**
 * 由已快取的原圖做一份降採樣小圖；原本就比上限小就什麼都不做（回 null）。
 * 先讀檔頭判斷尺寸，夠小就不必把整張解開。
 */
function makeThumbnail(fullPath: string, spec: ImageRequestSpec): string | null {
  const bytes = readBytes(fullPath)
  if (!bytes) return null

  const size = readImageSize(bytes)
  if (size && Math.max(size.width, size.height) <= THUMB_MAX_EDGE) return null

  const image = UIImage.fromFile(fullPath)
  if (!image) return null
  const longEdge = Math.max(image.width, image.height)
  if (!(longEdge > THUMB_MAX_EDGE)) return null

  const ratio = THUMB_MAX_EDGE / longEdge
  const thumb = image.preparingThumbnail({
    width: Math.max(1, Math.round(image.width * ratio)),
    height: Math.max(1, Math.round(image.height * ratio)),
  })
  if (!thumb) return null

  // 透明來源（PNG 頭像、留言圖）存 PNG，其餘存 JPEG。
  const png = isPng(bytes)
  const data = png ? thumb.toPNGData() : thumb.toJPEGData(THUMB_QUALITY)
  if (!data) return null

  const bytesOut = data.toUint8Array()
  if (!bytesOut) return null

  const path = thumbBase(spec) + (png ? ".thumb.png" : ".thumb.jpg")
  if (!writeBytes(path, bytesOut)) return null
  noteWritten(bytesOut.byteLength)
  scheduleImageCacheCleanup()
  return path
}

/**
 * 顯示用小圖的本地路徑：原圖（`cachedImagePath`）＋降採樣縮圖。
 * 舊快取沒有縮圖時當場補一份（每張圖只做一次），做不出來就退回原圖。
 */
export function cachedThumbnailPath(spec: ImageRequestSpec, sourceKey: string): Promise<string> {
  const base = thumbBase(spec)
  const pending = thumbInflight.get(base)
  if (pending) return pending

  const task = (async () => {
    const full = await cachedImagePath(spec, sourceKey)
    const cached = existingThumb(spec)
    if (cached) return cached
    try {
      return makeThumbnail(full, spec) ?? full
    } catch (error) {
      log("warning", "image", "縮圖降採樣失敗，改用原圖", error)
      return full
    }
  })()

  thumbInflight.set(base, task)
  void task
    .catch(() => {})
    .finally(() => {
      if (thumbInflight.get(base) === task) thumbInflight.delete(base)
    })
  return task
}

export function clearImageCache() {
  remove(cacheDir())
  clearDisplayCache()
  cacheBytes = 0
  lastScanAt = Date.now()
  kv.set(CACHE_BYTES_KEY, 0)
  kv.set(LAST_SCAN_KEY, lastScanAt)
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

/** 寫入之後累加帳面（還沒量過就不知道總量，等掃描過再說）。 */
function noteWritten(size: number) {
  if (cacheBytes >= 0) cacheBytes += size
}

/**
 * 問一次「該不該掃」：沒有任何策略就不管；量過且沒超標、也還沒到掃描間隔就跳過。
 * 真正的掃描在背景做，不卡寫入路徑。
 *
 * 入口（`index.tsx`）也在第一個畫面出現之後叫這一個——開機要跟寫入後走同一條守衛，
 * 不要直接 `autoCleanImageCache()`（那條無條件掃目錄）。
 */
export function scheduleImageCacheCleanup(): void {
  const maxBytes = getMaxSizeBytes()
  const maxAgeDays = getMaxAgeDays()
  if (maxBytes === 0 && maxAgeDays === 0) return
  const now = Date.now()
  const unknown = cacheBytes < 0
  const overLimit = maxBytes > 0 && cacheBytes >= maxBytes
  const ageDue = maxAgeDays > 0 && now - lastScanAt >= CLEAN_INTERVAL
  if (!unknown && !overLimit && !ageDue) return
  void autoCleanImageCache()
}

/**
 * 依據設定的策略（保留天數與容量上限）執行自動清理。
 * - 過期天數：刪除 modificationDate 超過 maxAgeDays 的檔案。
 * - 容量超標：依修改時間由舊到新刪除，降水位線至 80%。
 * 安全機制：跳過 .part 檔與 inflight 中的路徑。
 */
export async function autoCleanImageCache(): Promise<{ removedCount: number; freedBytes: number }> {
  if (cleaning) return { removedCount: 0, freedBytes: 0 }
  cleaning = true
  try {
    const dir = cacheDir()
    if (!exists(dir)) {
      cacheBytes = 0
      lastScanAt = Date.now()
      return { removedCount: 0, freedBytes: 0 }
    }

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

    // 記帳：以後就靠這個數字決定要不要再掃。
    cacheBytes = totalSize
    lastScanAt = Date.now()
    kv.set(CACHE_BYTES_KEY, totalSize)
    kv.set(LAST_SCAN_KEY, lastScanAt)

    return { removedCount, freedBytes }
  } catch (error) {
    log("warning", "cache", "縮圖自動清理過程發生錯誤", error)
    return { removedCount: 0, freedBytes: 0 }
  } finally {
    cleaning = false
  }
}

const PURGE_FLAG = "vesper.imagecache.purged-legacy"

/** 一次性清理舊版混合正文的快取目錄（以 Storage 旗標標記只執行一次）。 */
export function purgeLegacyImageCacheOnce(): void {
  if (kv.contains(PURGE_FLAG)) return
  remove(cacheDir())
  kv.set(PURGE_FLAG, true)
}

/** 取得縮圖快取檔案總數，讀取失敗回傳 null。 */
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
