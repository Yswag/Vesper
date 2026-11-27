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
const CLEAN_INTERVAL = 60 * 60 * 1000
let cleaning = false

let compositor: ImageCompositor | null = null

export function setImageCompositor(next: ImageCompositor) {
  compositor = next
}

function cacheDir(): string {
  return join(appDataRoot(), "cache", "images")
}

function hashKey(value: string): string {
  return Convert.hexEncode(Convert.md5(Convert.encodeUtf8(value)))
}

function cachePath(spec: ImageRequestSpec): string {
  return join(cacheDir(), hashKey(spec.url + "\n" + (spec.modifyImage ?? "")) + ".bin")
}

export interface ImageRequestSpec {
  url: string
  headers: Record<string, string>
  onResponse?: (bytes: any, response?: ImageResponseInfo) => any
  modifyImage?: string
  onLoadFailed?: () => unknown
  fetch?: (signal?: AbortSignal) => Promise<Uint8Array>
}

export function toCacheSpec(request: ImageRequest): ImageRequestSpec {
  return {
    url: absoluteUrl(request.url),
    headers: request.headers,
    onResponse: request.onResponse,
    modifyImage: request.modifyImage,
    onLoadFailed: request.onLoadFailed,
    fetch: request.fetch,
  }
}

export async function fetchProcessedImage(
  spec: ImageRequestSpec,
  sourceKey: string,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (typeof spec.fetch === "function") {
    const fetched = await spec.fetch(signal)
    const bytes = fetched instanceof Uint8Array ? fetched : new Uint8Array(fetched)
    return spec.modifyImage ? await applyModifyImage(spec.modifyImage, bytes) : bytes
  }

  const response = await fetchImageBytes(spec.url, spec.headers, sourceKey, signal)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`)
  }

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

const RETRY_LIMIT = 5

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

export async function applyModifyImage(script: string, bytes: Uint8Array): Promise<Uint8Array> {
  if (!compositor) throw new Error("合成器未註冊")
  const data = Data.fromUint8Array(bytes)
  if (!data) throw new Error("位元組無法轉成 Data")
  const decoded = UIImage.fromData(data)
  if (!decoded) throw new Error("圖片無法解碼")
  return compositor(runModifyImage(script, decoded))
}

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

const THUMB_MAX_EDGE = 1024
const THUMB_QUALITY = 0.82
const THUMB_EXTS = [".thumb.jpg", ".thumb.png"]
const thumbInflight = new Map<string, Promise<string>>()

function thumbBase(spec: ImageRequestSpec): string {
  return join(cacheDir(), hashKey(spec.url + "\n" + (spec.modifyImage ?? "")))
}

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
      }
    }
    return { count, totalBytes }
  } catch {
    return { count: 0, totalBytes: 0 }
  }
}

function noteWritten(size: number) {
  if (cacheBytes >= 0) cacheBytes += size
}

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

        if (maxAgeMs > 0 && now - stat.modificationDate > maxAgeMs) {
          FileManager.removeSync(fullPath)
          removedCount++
          freedBytes += stat.size
        } else {
          validFiles.push({ path: fullPath, size: stat.size, mtime: stat.modificationDate })
          totalSize += stat.size
        }
      } catch {
      }
    }

    if (maxSizeBytes > 0 && totalSize > maxSizeBytes) {
      const targetSize = Math.floor(maxSizeBytes * 0.8)
      validFiles.sort((a, b) => a.mtime - b.mtime)

      for (const item of validFiles) {
        if (totalSize <= targetSize) break
        try {
          FileManager.removeSync(item.path)
          removedCount++
          freedBytes += item.size
          totalSize -= item.size
        } catch {
        }
      }
    }

    if (removedCount > 0) {
      log("info", "cache", `縮圖自動清理完成：刪除 ${removedCount} 個檔案，釋放 ${Math.round(freedBytes / (1024 * 1024))} MB`)
    }

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

export function purgeLegacyImageCacheOnce(): void {
  if (kv.contains(PURGE_FLAG)) return
  remove(cacheDir())
  kv.set(PURGE_FLAG, true)
}

export function cacheFileCount(): number | null {
  try {
    const dir = cacheDir()
    if (!exists(dir)) return 0
    return FileManager.readDirectorySync(dir).length
  } catch {
    return null
  }
}

export { cacheDir }
