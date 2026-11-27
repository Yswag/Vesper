import { Convert } from "./convert"
import { appDataRoot, ensureDir, exists, join, listDir, readText, remove, writeText } from "./fs"
import { log } from "./log"
import { createPageIndex, pageName, type PageIndex } from "./pagefiles"

const USED_MARKER = ".used"

const KEYS_MARKER = ".keys"

export function pageCacheRoot(): string {
  return join(appDataRoot(), "cache", "pages")
}

export function chapterCacheDir(
  ref: { sourceKey: string; comicId: string; epId: string },
  root: string = pageCacheRoot()
): string {
  const key = [ref.sourceKey, ref.comicId, ref.epId].join("\n")
  return join(root, Convert.hexEncode(Convert.md5(Convert.encodeUtf8(key))).slice(0, 16))
}

export function cachedChapterImageKeys(
  ref: { sourceKey: string; comicId: string; epId: string },
  root: string = pageCacheRoot()
): string[] | null {
  const dir = chapterCacheDir(ref, root)
  const imageKeys = readImageKeys(dir)
  if (!imageKeys) return null
  const pages = createPageIndex(dir)
  return imageKeys.every((key, index) => pages.find(pageName(index, key)) !== null) ? imageKeys : null
}

function readImageKeys(dir: string): string[] | null {
  const text = readText(join(dir, KEYS_MARKER))
  if (!text) return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    return parsed.every(key => typeof key === "string") ? (parsed as string[]) : null
  } catch {
    return null
  }
}

function writeImageKeys(dir: string, imageKeys: string[]): void {
  const path = join(dir, KEYS_MARKER)
  const text = JSON.stringify(imageKeys)
  if (readText(path) !== text) writeText(path, text)
}

export interface ChapterCache {
  readonly dir: string
  readonly pages: PageIndex
  bytes(): number
  account(size: number): void
  close(): void
}

export function openChapterCache(
  ref: { sourceKey: string; comicId: string; epId: string },
  imageKeys: string[],
  root: string = pageCacheRoot()
): ChapterCache {
  const dir = chapterCacheDir(ref, root)
  ensureDir(dir)
  const { kept, droppedBytes, droppedFiles } = dropStalePages(dir, listDir(dir), imageKeys)
  const marker = readMarker(dir)
  let files = kept.filter(entry => !entry.startsWith(".")).length
  let used =
    marker.bytes !== null && marker.files === files + droppedFiles
      ? Math.max(0, marker.bytes - droppedBytes)
      : bytesOf(dir, kept)
  const usedAt = Date.now()
  writeMarker(dir, usedAt, used, files)
  writeImageKeys(dir, imageKeys)
  const pages = createPageIndex(dir, kept)
  return {
    dir,
    pages,
    bytes: () => used,
    account: size => {
      used += size
      files += 1
    },
    close: () => {
      if (!exists(dir)) return
      writeMarker(dir, usedAt, used, files)
    },
  }
}

function dropStalePages(
  dir: string,
  entries: string[],
  imageKeys: string[]
): { kept: string[]; droppedBytes: number; droppedFiles: number } {
  const valid = new Set(imageKeys.map((key, index) => pageName(index, key)))
  const kept: string[] = []
  let droppedBytes = 0
  let droppedFiles = 0
  for (const entry of entries) {
    if (entry.startsWith(".")) {
      kept.push(entry)
      continue
    }
    if (entry.endsWith(".part")) {
      remove(join(dir, entry))
      continue
    }
    const match = /^(p\d+-[0-9a-f]{8})/.exec(entry)
    if (match && valid.has(match[1])) {
      kept.push(entry)
      continue
    }
    droppedBytes += sizeOf(join(dir, entry))
    droppedFiles += 1
    remove(join(dir, entry))
  }
  return { kept, droppedBytes, droppedFiles }
}

function readMarker(dir: string): { usedAt: number; bytes: number | null; files: number | null } {
  const text = readText(join(dir, USED_MARKER))
  const [head, second, third] = (text ?? "").split("\n")
  const usedAt = Number(head)
  if (Number.isFinite(usedAt) && usedAt > 0) return { usedAt, bytes: countOf(second), files: countOf(third) }
  return { usedAt: markerMtime(dir), bytes: null, files: null }
}

function countOf(line: string | undefined): number | null {
  if (line === undefined || line === "") return null
  const value = Number(line)
  return Number.isFinite(value) && value >= 0 ? value : null
}

function writeMarker(dir: string, usedAt: number, bytes: number, files: number): void {
  writeText(join(dir, USED_MARKER), `${usedAt}\n${bytes}\n${files}`)
}

function markerMtime(dir: string): number {
  try {
    return FileManager.statSync(join(dir, USED_MARKER)).modificationDate ?? 0
  } catch {
    return 0
  }
}

function sizeOf(path: string): number {
  try {
    const stat = FileManager.statSync(path)
    return stat.type === "file" || stat.type === "NSFileTypeRegular" ? stat.size : 0
  } catch {
    return 0
  }
}

function dirBytes(dir: string): number {
  return bytesOf(dir, listDir(dir))
}

function bytesOf(dir: string, entries: string[]): number {
  let total = 0
  for (const entry of entries) total += sizeOf(join(dir, entry))
  return total
}

export interface PageCacheLimits {
  chapters: number
  bytes: number
}

export interface PageCacheSweep {
  removedChapters: number
  freedBytes: number
}

let sweeping = false

export async function sweepPageCache(
  activeDir: string | null | (() => string | null),
  limits: PageCacheLimits,
  root: string = pageCacheRoot()
): Promise<PageCacheSweep> {
  const result: PageCacheSweep = { removedChapters: 0, freedBytes: 0 }
  if (sweeping) return result
  if (limits.chapters <= 0 && limits.bytes <= 0) return result

  if (!exists(root)) return result

  sweeping = true
  try {
    const entries = await FileManager.readDirectory(root)
    const chapters: Array<{ dir: string; usedAt: number; bytes: number }> = []
    for (const name of entries) {
      const dir = join(root, name)
      chapters.push({ dir, usedAt: readMarker(dir).usedAt, bytes: dirBytes(dir) })
      await yieldToMain()
    }
    chapters.sort((a, b) => b.usedAt - a.usedAt)
    const active = typeof activeDir === "function" ? activeDir() : activeDir

    let total = chapters.reduce((sum, item) => sum + item.bytes, 0)

    const drop = (item: { dir: string; bytes: number }) => {
      if (!remove(item.dir)) return false
      total -= item.bytes
      result.removedChapters++
      result.freedBytes += item.bytes
      return true
    }

    const oldestDroppable = () => {
      for (let index = chapters.length - 1; index >= 0; index--) {
        const item = chapters[index]
        if (item.dir === active) continue
        chapters.splice(index, 1)
        return item
      }
      return null
    }

    const maxChapters = limits.chapters > 0 ? limits.chapters : Number.POSITIVE_INFINITY
    while (chapters.length > maxChapters) {
      const victim = oldestDroppable()
      if (!victim) break
      drop(victim)
    }

    if (limits.bytes > 0) {
      const target = Math.floor(limits.bytes * 0.8)
      while (total > target) {
        const victim = oldestDroppable()
        if (!victim) break
        if (!drop(victim)) continue
      }
    }
  } catch (error) {
    log("warning", "cache", "正文快取淘汰失敗", error)
  } finally {
    sweeping = false
  }

  if (result.removedChapters > 0) {
    log("info", "cache", `正文快取淘汰 ${result.removedChapters} 話，釋放 ${Math.round(result.freedBytes / 1024 / 1024)}MB`)
  }
  return result
}

function yieldToMain(): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, 0))
}

export async function pageCacheUsage(root: string = pageCacheRoot()): Promise<{ chapters: number; bytes: number }> {
  if (!exists(root)) return { chapters: 0, bytes: 0 }
  try {
    const entries = await FileManager.readDirectory(root)
    let bytes = 0
    for (const name of entries) bytes += dirBytes(join(root, name))
    return { chapters: entries.length, bytes }
  } catch {
    return { chapters: 0, bytes: 0 }
  }
}

export function clearPageCache(root: string = pageCacheRoot()): void {
  remove(root)
}
