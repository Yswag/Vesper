// 正文的跨 session 快取池：一章一個目錄，以「話」為淘汰單位。
//
// 不與縮圖（engine/imagecache.ts）共用一池：正文一張 0.06–1.8MB、縮圖 10–80KB，
// 混在一起的話讀完一話就會把最舊的封面擠掉（封面是每次進首頁與書架都要用的），
// 而且兩邊的淘汰語意不同——縮圖是「久沒看就丟」，正文是「最近讀過的那幾話留著」。
//
// 離線章節不走這裡：下載的原圖本來就在磁碟上（engine/offline），
// 那一條路只把超分圖寫進 session 暫存目錄（pagefiles 的 cache/reader）。

import { Convert } from "./convert"
import { appDataRoot, ensureDir, exists, join, listDir, readText, remove, writeText } from "./fs"
import { log } from "./log"
import { createPageIndex, pageName, type PageIndex } from "./pagefiles"

/**
 * 「最後讀過」的標記檔；淘汰靠它排序，不必依賴目錄本身的 mtime。
 * 內容是兩行：毫秒時間戳、這一話的累計位元組。舊版只寫時間戳（沒有第二行），
 * 讀到就當用量未知，照舊量一次再寫回新格式。
 */
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
  /** 這一話的頁面索引（開章時列舉一次建立，之後每一頁都查它）。 */
  readonly pages: PageIndex
  /** 這一話目前在磁碟上佔用的位元組（開章時讀標記／量一次，加上這次寫入的）。 */
  bytes(): number
  /** 寫檔之後記帳（原圖與超分圖都要）。 */
  account(size: number): void
  /** 收攤：把用量寫回標記，下一次開章不必逐檔量。 */
  close(): void
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
  // 整個開章就列舉這一次：清舊檔用它，頁面索引也用它。
  const { kept, droppedBytes, droppedFiles } = dropStalePages(dir, listDir(dir), imageKeys)
  const marker = readMarker(dir)
  let files = kept.filter(entry => !entry.startsWith(".")).length
  // 標記的用量只在檔數對得上時才信：新目錄、舊格式的標記，或目錄被淘汰／清快取刪過又被寫回來，
  // 都量這一次，之後讀標記。
  let used =
    marker.bytes !== null && marker.files === files + droppedFiles
      ? Math.max(0, marker.bytes - droppedBytes)
      : bytesOf(dir, kept)
  // 寫入頻率與以前相同：開章一次（收攤再一次，只寫十幾個位元組）。
  const usedAt = Date.now()
  writeMarker(dir, usedAt, used, files)
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
      // 目錄已經被淘汰或清掉就不寫：寫了會把空目錄建回來。
      if (!exists(dir)) return
      // 時間戳不變：收攤不該把它變成「剛讀過」，淘汰排序看的是開章那一刻。
      writeMarker(dir, usedAt, used, files)
    },
  }
}

/**
 * 這個目錄裡不再對應目前圖片鍵的檔（圖片鍵變了、或頁數變少）。順手清掉中斷寫入的 `.part`。
 * 回傳還留著的檔名（交給索引）與刪掉的位元組、檔數（從標記的用量裡扣、對標記的檔數）。
 */
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
    // `p<index>-<hash8>` 是本體；超分圖是同名前綴再加 `-hi-WxH`（可能帶半邊 `-L/-R`）。
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

/**
 * 標記內容：第一行「最後讀過」、第二行累計位元組、第三行檔數（對不上目錄就不信用量）。
 * 舊格式只有第一行；缺的行一律當未知。
 */
function readMarker(dir: string): { usedAt: number; bytes: number | null; files: number | null } {
  const text = readText(join(dir, USED_MARKER))
  const [head, second, third] = (text ?? "").split("\n")
  const usedAt = Number(head)
  if (Number.isFinite(usedAt) && usedAt > 0) return { usedAt, bytes: countOf(second), files: countOf(third) }
  // 讀不到內容（剛建好、或壞掉）：退回檔案的修改時間。
  return { usedAt: markerMtime(dir), bytes: null, files: null }
}

/** 標記裡的一行非負數字；沒有這一行、空字串或讀不懂都回 null。 */
function countOf(line: string | undefined): number | null {
  if (line === undefined || line === "") return null
  const value = Number(line)
  return Number.isFinite(value) && value >= 0 ? value : null
}

function writeMarker(dir: string, usedAt: number, bytes: number, files: number): void {
  // 寫不進去不是致命的：下一次開章只會多量一次。
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

/** 已列舉過的檔逐一量大小（同步；只在用量未知時用一次）。 */
function bytesOf(dir: string, entries: string[]): number {
  let total = 0
  for (const entry of entries) total += sizeOf(join(dir, entry))
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
 * - `activeDir` 是正在讀的那一話，永遠不刪。開章把它延到「第一頁備好」之後才叫這裡，
 *   排隊期間可能已經換話或關掉了，所以也可以傳一個函式：**真正要刪的時候才問**。
 * - 「最後讀過」讀 `.used` 的內容（不靠 mtime：收攤重寫標記不該把它變成剛讀過）。
 * - 用量照舊逐檔量（結果與以前一致），但**逐話之間讓出一個 macrotask**：
 *   這段同步 I/O 包在 async 函式裡依然佔住主執行緒，一話一話做才不會擋住畫面。
 * - 單章自己就超過上限時，沒有別的話可刪就停在它身上（總量＝這一話的大小），
 *   換下一話之後下一次掃描會把它收掉。
 */
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
    chapters.sort((a, b) => b.usedAt - a.usedAt) // 新的在前
    // 排隊期間可能已經換話、或那個 session 已經關了：現在才決定哪一個不能刪。
    const active = typeof activeDir === "function" ? activeDir() : activeDir

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
        if (item.dir === active) continue
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

/** 讓出一個 macrotask（專案裡沒有現成的共用工具；4ms 的 setTimeout 下限對淘汰來說無所謂）。 */
function yieldToMain(): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, 0))
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
