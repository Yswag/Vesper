import { Convert } from "../engine/convert"
import { join, listDir, readText, remove, writeText } from "../engine/fs"
import { log } from "../engine/log"
import { timerAfter } from "../engine/timers"
import { isFavorite } from "../library/bookshelf"

import type { MihonChapter, MihonManga } from "./mihon"

const COMIC_LIMIT = 200
const BYTES_LIMIT = 8 * 1024 * 1024
const SWEEP_EVERY = 16
const MEMORY_LIMIT = 8
const BROWSED_LIMIT = 600
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
const browsed = new Map<string, MihonManga>()
const writes = new Map<string, number>()
const knownBytes = new Map<string, number>()
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
    }
  }
  usedTable.set(dir, table)
  return table
}

function markUsed(dir: string, comicId: string): void {
  usedOf(dir).set(comicId, Date.now())
  dirtyIndex.add(dir)
  if (flushTimers.has(dir)) return
  const timer = timerAfter(() => {
    flushTimers.delete(dir)
    flushIndex(dir)
  }, INDEX_FLUSH_MS)
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


function read(dir: string, comicId: string): ComicRecord | null {
  const text = readText(fileOf(dir, comicId))
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as StoredRecord
    if (!parsed || typeof parsed !== "object" || parsed.v !== 1) return null
    if (parsed.comicId !== comicId) return null
    if (!parsed.manga || !Array.isArray(parsed.chapters)) return null
    return { comicId: parsed.comicId, manga: parsed.manga, chapters: parsed.chapters }
  } catch {
    return null
  }
}

export function rememberManga(sourceKey: string, manga: MihonManga): void {
  if (!manga.url) return
  const key = memoryKey(sourceKey, manga.url)
  browsed.delete(key)
  browsed.set(key, manga)
  while (browsed.size > BROWSED_LIMIT) {
    const oldest = browsed.keys().next().value as string | undefined
    if (oldest === undefined) break
    browsed.delete(oldest)
  }
  const known = memory.get(key)
  if (known) memory.set(key, { ...known, manga })
}

function withBrowsedCover(sourceKey: string, manga: MihonManga): MihonManga {
  if (manga.thumbnailUrl) return manga
  const listed = browsed.get(memoryKey(sourceKey, manga.url))
  return listed?.thumbnailUrl ? { ...manga, thumbnailUrl: listed.thumbnailUrl } : manga
}

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

export function mangaOf(dir: string, sourceKey: string, comicId: string): MihonManga {
  const key = memoryKey(sourceKey, comicId)
  const hit = memory.get(key)
  if (hit) {
    memory.delete(key)
    memory.set(key, hit)
    markUsed(dir, comicId)
    return withBrowsedCover(sourceKey, hit.manga)
  }
  const stored = read(dir, comicId)
  if (stored) {
    remember(sourceKey, stored)
    markUsed(dir, comicId)
    return withBrowsedCover(sourceKey, stored.manga)
  }
  const listed = browsed.get(key)
  if (listed) return listed
  return { title: "", author: "", artist: "", description: "", genre: "", status: 0, thumbnailUrl: "", url: comicId }
}

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
  log("debug", "mihon", `${comicId} 的章節 ${chapterUrl} 沒有存過，只帶 url 去問`)
  return { name: "", url: chapterUrl, dateUpload: 0, scanlator: "" }
}

export function storedComics(dir: string): string[] {
  return listDir(dir).filter(name => name.endsWith(".json") && name !== INDEX_FILE)
}

export function bytesOf(dir: string): number {
  return knownBytes.get(dir) ?? measure(dir)
}


export interface EvictionCandidate {
  comicId: string
  used: number
  bytes: number
}

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

export function forget(sourceKey: string): void {
  for (const table of [memory, browsed]) {
    for (const key of [...table.keys()]) {
      if (key.startsWith(`${sourceKey}\n`)) table.delete(key)
    }
  }
}

export function sweepNow(dir: string, sourceKey: string): void {
  sweep(dir, sourceKey)
}
