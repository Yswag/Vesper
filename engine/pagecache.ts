// 正文的跨 session 快取池：一章一個目錄，以「話」為淘汰單位。
//
// 不與縮圖（engine/imagecache.ts）共用一池：正文一張 0.06–1.8MB、縮圖 10–80KB，
// 混在一起的話讀完一話就會把最舊的封面擠掉（封面是每次進首頁與書架都要用的），
// 而且兩邊的淘汰語意不同——縮圖是「久沒看就丟」，正文是「最近讀過的那幾話留著」。
//
// 離線章節不走這裡：下載的原圖本來就在磁碟上（engine/offline），
// 那一條路只把超分圖寫進 session 暫存目錄（pagefiles 的 cache/reader）。

import { Convert } from "./convert"
import { appDataRoot, ensureDir, exists, join, listDir, remove, writeText } from "./fs"
import { log } from "./log"
import { pageName } from "./pagefiles"

/** 「最後讀過」的標記檔；淘汰靠它排序，不必依賴目錄本身的 mtime。 */
const USED_MARKER = ".used"

/** 池的根目錄（與離線 session 的 `cache/reader` 分開）。 */
export function pageCacheRoot(): string {
  return join(appDataRoot(), "cache", "pages")
}

/** 一章一個目錄；三個 id 一起雜湊，不必担心非法字元與長度。 */
export function chapterCacheDir(
  ref: { sourceKey: string; comicId: string; epId: string },
  root: string = pageCacheRoot()
): string {
  const key = [ref.sourceKey, ref.comicId, ref.epId].join("\n")
  return join(root, Convert.hexEncode(Convert.md5(Convert.encodeUtf8(key))).slice(0, 16))
}

export interface ChapterCache {
  readonly dir: string
  /** 這一話目前在磁碟上佔用的位元組（開章時量的＋這次寫入的）。 */
  bytes(): number
  /** 寫檔之後記帳（原圖與超分圖都要）。 */
  account(size: number): void
}

/**
 * 取得這一話的快取目錄：建立、更新「最後讀過」、清掉圖片鍵對不上的舊檔。
 * 同一話重開會拿到同一個目錄，這就是跨 session 命中的來源。
 */
export function openChapterCache(
  ref: { sourceKey: string; comicId: string; epId: string },
  imageKeys: string[],
  root: string = pageCacheRoot()
): ChapterCache {
  const dir = chapterCacheDir(ref, root)
  ensureDir(dir)
  writeText(join(dir, USED_MARKER), String(Date.now()))
  dropStalePages(dir, imageKeys)
  let used = dirBytes(dir)
  return {
    dir,
    bytes: () => used,
    account: size => {
      used += size
    },
  }
}

/** 這個目錄裡不再對應目前圖片鍵的檔（圖片鍵變了、或頁數變少）。順手清掉中斷寫入的 `.part`。 */
function dropStalePages(dir: string, imageKeys: string[]): void {
  const valid = new Set(imageKeys.map((key, index) => pageName(index, key)))
  for (const entry of listDir(dir)) {
    if (entry.startsWith(".")) continue
    if (entry.endsWith(".part")) {
      remove(join(dir, entry))
      continue
    }
    // `p<index>-<hash8>` 是本體；超分圖是同名前綴再加 `-hi-WxH`（可能帶半邊 `-L/-R`）。
    const match = /^(p\d+-[0-9a-f]{8})/.exec(entry)
    if (match && valid.has(match[1])) continue
    remove(join(dir, entry))
  }
}

function dirBytes(dir: string): number {
  let total = 0
  for (const entry of listDir(dir)) {
    try {
      const stat = FileManager.statSync(join(dir, entry))
      if (stat.type === "file" || stat.type === "NSFileTypeRegular") total += stat.size
    } catch {
      // 剛被刪掉或讀不到：不算進去
    }
  }
  return total
}

export interface PageCacheLimits {
  /** 保留幾話（含正在讀的這一話）；0＝不限。 */
  chapters: number
  /** 容量上限（位元組）；0＝不限。 */
  bytes: number
}

export interface PageCacheSweep {
  removedChapters: number
  freedBytes: number
}

/** 同時只跑一次（開章會觸發，換話很快時不必疊著掃）。 */
let sweeping = false

/**
 * 淘汰：先看話數，再看容量（回收目標 80%，避免每寫一張就刪一次）。
 *
 * - `activeDir` 是正在讀的那一話，永遠不刪。
 * - 單章自己就超過上限時，沒有別的話可刪就停在它身上（總量＝這一話的大小），
 *   換下一話之後下一次掃描會把它收掉。
 */
export async function sweepPageCache(
  activeDir: string | null,
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
    const chapters = entries
      .map(name => {
        const dir = join(root, name)
        return { dir, usedAt: usedAt(dir), bytes: dirBytes(dir) }
      })
      .sort((a, b) => b.usedAt - a.usedAt) // 新的在前

    let total = chapters.reduce((sum, item) => sum + item.bytes, 0)

    const drop = (item: { dir: string; bytes: number }) => {
      if (!remove(item.dir)) return false
      total -= item.bytes
      result.removedChapters++
      result.freedBytes += item.bytes
      return true
    }

    /** 最舊、又不是正在讀的那一個。 */
    const oldestDroppable = () => {
      for (let index = chapters.length - 1; index >= 0; index--) {
        const item = chapters[index]
        if (item.dir === activeDir) continue
        chapters.splice(index, 1)
        return item
      }
      return null
    }

    // 1. 話數上限
    const maxChapters = limits.chapters > 0 ? limits.chapters : Number.POSITIVE_INFINITY
    while (chapters.length > maxChapters) {
      const victim = oldestDroppable()
      if (!victim) break
      drop(victim)
    }

    // 2. 容量上限（降到 80%）
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

function usedAt(dir: string): number {
  try {
    const stat = FileManager.statSync(join(dir, USED_MARKER))
    return stat.modificationDate ?? 0
  } catch {
    return 0
  }
}

/** 目前佔用（設定頁用）。 */
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

/** 全部清掉（設定頁的「清除」）。 */
export function clearPageCache(root: string = pageCacheRoot()): void {
  remove(root)
}
