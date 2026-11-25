// Mihon 的源層 side store：把 SManga／SChapter 的完整欄位與 ext-lib 1.6 的 `memo` 留在磁碟上。
//
// dexvm 的每個 op 都要收完整物件（`details`／`chapters` 要 Manga，`pages` 要 Chapter），
// 但 Vesper 對外只傳 comicId／epId（＝SManga.url／SChapter.url），書庫的資料結構不改。
// 續讀的快速路徑只呼叫 pages、不會先呼叫 details，所以 Chapter 一定要落地，不能只放記憶體。
//
// 佈局：`sources/mihon/<packageId>/memo/<sourceId>/`
//   <md5(comicUrl) 前 16 hex>.json   { v, comicId, manga, chapters[] }
//   _index.json                      { v, used: { comicId: 最後使用毫秒 } }
// 一部作品一個檔（章節幾十 KB，塞進同一個大檔就變成每次開詳情都重寫整份）。
//
// 淘汰：
//   - **書架上的作品永不淘汰**（`isFavorite`）；只在非書架的作品裡挑。
//   - 依「最後使用」淘汰，不是最後寫入：`pages`／`chapters` 讀到記錄也算使用。
//     使用時間只寫進 `_index.json`（幾百筆的小檔），最多每 60 秒落盤一次，
//     不為了記一次使用就重寫整份章節清單。
//   - 上限：每個子源的非書架作品 200 部／8MB；書架的作品照樣保留（書架自己可能就超標）。

import { Convert } from "../engine/convert"
import { join, listDir, readText, remove, writeText } from "../engine/fs"
import { log } from "../engine/log"
import { timerAfter } from "../engine/timers"
import { isFavorite } from "../library/bookshelf"

import type { MihonChapter, MihonManga } from "./mihon"

/** 每個子源非書架作品的上限。 */
const COMIC_LIMIT = 200
/** 每個子源在磁碟上最多佔多少位元組（書架作品不計入淘汰判斷，但照樣計入這個數字）。 */
const BYTES_LIMIT = 8 * 1024 * 1024
/** 每幾次寫入掃一次目錄（掃描要逐檔 statSync，不能每次寫都跑）。 */
const SWEEP_EVERY = 16
/** 記憶體裡留幾部（開詳情 → 進閱讀器這條路會連續問同一部）。 */
const MEMORY_LIMIT = 8
/** 使用時間最多多久落盤一次。 */
const INDEX_FLUSH_MS = 60_000

const INDEX_FILE = "_index.json"

interface ComicRecord {
  comicId: string
  manga: MihonManga
  chapters: MihonChapter[]
}

interface StoredRecord extends ComicRecord {
  v: 1
  at: number
}

interface StoredIndex {
  v: 1
  used: Record<string, number>
}

const memory = new Map<string, ComicRecord>()
/** 每個目錄寫過幾次（決定哪時掃目錄）。 */
const writes = new Map<string, number>()
/** 每個目錄目前的位元組數（第一次用到時掃一次，之後靠加減）。 */
const knownBytes = new Map<string, number>()
/** 每個目錄的最後使用表（記憶體）；dirty 的每 60 秒落盤一次。 */
const usedTable = new Map<string, Map<string, number>>()
const dirtyIndex = new Set<string>()
const flushTimers = new Map<string, number>()

function memoryKey(sourceKey: string, comicId: string): string {
  return `${sourceKey}\n${comicId}`
}

function fileOf(dir: string, comicId: string): string {
  return join(dir, `${Convert.hexEncode(Convert.md5(Convert.encodeUtf8(comicId))).slice(0, 16)}.json`)
}

function indexOf(dir: string): string {
  return join(dir, INDEX_FILE)
}

function remember(sourceKey: string, record: ComicRecord): void {
  const key = memoryKey(sourceKey, record.comicId)
  memory.delete(key)
  memory.set(key, record)
  while (memory.size > MEMORY_LIMIT) {
    const oldest = memory.keys().next().value as string | undefined
    if (oldest === undefined) return
    memory.delete(oldest)
  }
}

// ---------------------------------------------------------------- 使用時間

function usedOf(dir: string): Map<string, number> {
  const known = usedTable.get(dir)
  if (known) return known
  const table = new Map<string, number>()
  const raw = readText(indexOf(dir))
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as StoredIndex
      if (parsed && parsed.v === 1 && parsed.used && typeof parsed.used === "object") {
        for (const [comicId, at] of Object.entries(parsed.used)) {
          if (typeof at === "number" && Number.isFinite(at)) table.set(comicId, at)
        }
      }
    } catch {
      // 壞掉的索引只影響淘汰順序，不影響讀取。
    }
  }
  usedTable.set(dir, table)
  return table
}

/** 記一次使用：只動記憶體，最多每 60 秒落盤。 */
function markUsed(dir: string, comicId: string): void {
  usedOf(dir).set(comicId, Date.now())
  dirtyIndex.add(dir)
  if (flushTimers.has(dir)) return
  const timer = timerAfter(() => {
    flushTimers.delete(dir)
    flushIndex(dir)
  }, INDEX_FLUSH_MS)
  // 不在主佇列時建不了 timer：小檔，當場寫掉就好。
  if (timer === null) flushIndex(dir)
  else flushTimers.set(dir, timer)
}

function flushIndex(dir: string): void {
  if (!dirtyIndex.delete(dir)) return
  const used: Record<string, number> = {}
  for (const [comicId, at] of usedOf(dir)) used[comicId] = at
  const payload: StoredIndex = { v: 1, used }
  writeText(indexOf(dir), JSON.stringify(payload))
}

// ---------------------------------------------------------------- 讀寫

function read(dir: string, comicId: string): ComicRecord | null {
  const text = readText(fileOf(dir, comicId))
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as StoredRecord
    if (!parsed || typeof parsed !== "object" || parsed.v !== 1) return null
    // 檔名只取 md5 前 16 個 hex：撞名或舊檔都可能，內容對不上就當沒有。
    if (parsed.comicId !== comicId) return null
    if (!parsed.manga || !Array.isArray(parsed.chapters)) return null
    return { comicId: parsed.comicId, manga: parsed.manga, chapters: parsed.chapters }
  } catch {
    return null
  }
}

/** 清單回來時只拿得到 Manga（沒有章節）：只放記憶體，開詳情時就帶著 memo 去問源。 */
export function rememberManga(sourceKey: string, manga: MihonManga): void {
  if (!manga.url) return
  const known = memory.get(memoryKey(sourceKey, manga.url))
  remember(sourceKey, { comicId: manga.url, manga, chapters: known?.chapters ?? [] })
}

/**
 * 詳情＋章節回來：寫檔（呼叫 pages 時章節要拿得回來）。
 * 一份作品就是一個檔，寫入次數等於「開過幾次詳情」，不會隨瀏覽量成長。
 */
export function rememberComic(
  dir: string,
  sourceKey: string,
  comicId: string,
  manga: MihonManga,
  chapters: MihonChapter[]
): void {
  const record: ComicRecord = { comicId, manga, chapters }
  remember(sourceKey, record)
  const stored: StoredRecord = { v: 1, at: Date.now(), ...record }
  const text = JSON.stringify(stored)
  const previous = bytesOf(dir)
  writeText(fileOf(dir, comicId), text)
  knownBytes.set(dir, previous + text.length)
  markUsed(dir, comicId)
  const count = (writes.get(dir) ?? 0) + 1
  writes.set(dir, count)
  if (count % SWEEP_EVERY === 0) sweep(dir, sourceKey)
}

/**
 * 要傳給 dexvm 的 Manga：有存過就回完整物件，沒有就只帶 url
 *（多數源只用 url 就夠；真正需要 memo 的源前面一定開過詳情）。
 */
export function mangaOf(dir: string, sourceKey: string, comicId: string): MihonManga {
  const key = memoryKey(sourceKey, comicId)
  const hit = memory.get(key)
  if (hit) {
    memory.delete(key)
    memory.set(key, hit)
    markUsed(dir, comicId)
    return hit.manga
  }
  const stored = read(dir, comicId)
  if (stored) {
    remember(sourceKey, stored)
    markUsed(dir, comicId)
    return stored.manga
  }
  return { title: "", author: "", artist: "", description: "", genre: "", status: 0, thumbnailUrl: "", url: comicId }
}

/** 要傳給 dexvm 的 Chapter：同樣是「有存過就完整，沒有就只帶 url」。 */
export function chapterOf(dir: string, sourceKey: string, comicId: string, chapterUrl: string): MihonChapter {
  const key = memoryKey(sourceKey, comicId)
  let record = memory.get(key)
  if (!record) {
    const stored = read(dir, comicId)
    if (stored) {
      remember(sourceKey, stored)
      record = stored
    }
  }
  if (record) markUsed(dir, comicId)
  const hit = record?.chapters.find(chapter => chapter.url === chapterUrl)
  if (hit) return hit
  // 只有 url：`pages` 幾乎都只用 url；要 memo 的源（例如 Kagane）在詳情那一步已寫檔。
  log("debug", "mihon", `${comicId} 的章節 ${chapterUrl} 沒有存過，只帶 url 去問`)
  return { name: "", url: chapterUrl, dateUpload: 0, scanlator: "" }
}

/** 這個子源目前存了哪些作品（診斷用）。 */
export function storedComics(dir: string): string[] {
  return listDir(dir).filter(name => name.endsWith(".json") && name !== INDEX_FILE)
}

/** 這個子源目前用了多少位元組（含索引檔）。 */
export function bytesOf(dir: string): number {
  return knownBytes.get(dir) ?? measure(dir)
}

// ---------------------------------------------------------------- 淘汰

/** 一個候選作品的用量。 */
export interface EvictionCandidate {
  comicId: string
  /** 最後使用（毫秒）。 */
  used: number
  bytes: number
}

/**
 * 決定要丟哪些作品（純函式）：書架上的一個都不丟，其餘依「最後使用」由舊到新，
 * 直到數量與位元組都回到上限內。書架自己超過上限時就是全留。
 */
export function planEviction(
  candidates: readonly EvictionCandidate[],
  isShelved: (comicId: string) => boolean,
  limit: number,
  bytesLimit: number
): string[] {
  const rest = candidates.filter(candidate => !isShelved(candidate.comicId)).sort((a, b) => a.used - b.used)
  let count = candidates.length
  let bytes = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0)
  const dropped: string[] = []
  for (const candidate of rest) {
    if (count <= limit && bytes <= bytesLimit) break
    dropped.push(candidate.comicId)
    count -= 1
    bytes -= candidate.bytes
  }
  return dropped
}

function measure(dir: string): number {
  let total = 0
  for (const name of listDir(dir)) {
    try {
      total += Number(FileManager.statSync(join(dir, name)).size ?? 0)
    } catch {
      // 量不到就不算。
    }
  }
  knownBytes.set(dir, total)
  return total
}

function sweep(dir: string, sourceKey: string): void {
  flushIndex(dir)
  const names = storedComics(dir)
  if (names.length <= COMIC_LIMIT && bytesOf(dir) <= BYTES_LIMIT) return
  const used = usedOf(dir)

  // 以索引為權威清單；索引裡沒有的檔（上次沒落盤就結束）用檔案時間當使用時間。
  const byFile = new Map<string, string>()
  for (const comicId of used.keys()) byFile.set(fileOf(dir, comicId).split("/").pop() ?? "", comicId)
  const known: EvictionCandidate[] = []
  const orphans: Array<{ name: string }> = []
  for (const name of names) {
    const path = join(dir, name)
    let size = 0
    let mtime = 0
    try {
      const stat = FileManager.statSync(path)
      size = Number(stat.size ?? 0)
      mtime = Number(stat.modificationDate ?? 0)
    } catch {
      remove(path)
      continue
    }
    const comicId = byFile.get(name)
    if (comicId === undefined) orphans.push({ name })
    else known.push({ comicId, used: used.get(comicId) ?? mtime, bytes: size })
  }

  const shelved = new Set(known.filter(candidate => isFavorite(sourceKey, candidate.comicId)).map(candidate => candidate.comicId))
  const dropped = planEviction(known, comicId => shelved.has(comicId), COMIC_LIMIT, BYTES_LIMIT)

  for (const comicId of dropped) {
    if (remove(fileOf(dir, comicId))) used.delete(comicId)
  }
  // 沒有索引紀錄的檔一律丟：既查不到書架狀態，也記不得哪時用過。
  for (const orphan of orphans) remove(join(dir, orphan.name))
  measure(dir)
  dirtyIndex.add(dir)
  flushIndex(dir)
  if (dropped.length > 0 || orphans.length > 0) {
    log(
      "info",
      "mihon",
      `memo 清掉 ${dropped.length + orphans.length} 部（留 ${storedComics(dir).length} 部，其中書架 ${shelved.size} 部 / ${Math.round(
        bytesOf(dir) / 1024
      )}KB）`
    )
  }
}

/** 子源被移除／重新安裝：記憶體不再相信舊記錄（磁碟由安裝流程自己處理）。 */
export function forget(sourceKey: string): void {
  for (const key of [...memory.keys()]) {
    if (key.startsWith(`${sourceKey}\n`)) memory.delete(key)
  }
}

/** 探針用：立刻跑一次淘汰（平常由每 16 次寫入觸發）。 */
export function sweepNow(dir: string, sourceKey: string): void {
  sweep(dir, sourceKey)
}
