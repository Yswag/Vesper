import type { AbortSignal } from "scripting"

import { Convert } from "./convert"
import { createEmitter } from "./emitter"
import { appDataRoot, ensureDir, exists, join, listDir, readBytes, readText, remove, writeText } from "./fs"
import { type SourceCallRetry } from "./images"
import type { PageCache } from "./pageimages"
import { log } from "./log"

export interface OfflineKey {
  sourceKey: string
  comicId: string
  epId: string
}

export interface OfflinePage {
  key: string
  bytes: number
}

export interface OfflineChapter {
  key: OfflineKey
  comicTitle?: string
  epTitle?: string
  cover?: string
  imageKeys: string[]
  pages: Record<string, OfflinePage>
  updatedAt: number
}

export type OfflineState = "none" | "partial" | "done"

export interface OfflineStatus {
  state: OfflineState
  completed: number
  total: number
  bytes: number
}


export function offlineRoot(): string {
  return join(appDataRoot(), "offline")
}

export function idOf(key: OfflineKey): string {
  return `${key.sourceKey}\n${key.comicId}\n${key.epId}`
}

function folderOf(key: OfflineKey): string {
  return join(offlineRoot(), Convert.hexEncode(Convert.md5(Convert.encodeUtf8(idOf(key)))))
}

function pageFile(key: OfflineKey, index: number): string {
  return join(folderOf(key), `${index}.bin`)
}

function manifestFile(key: OfflineKey): string {
  return join(folderOf(key), "manifest.json")
}

let index: Map<string, OfflineChapter> | null = null

function parsePages(raw: unknown): Record<string, OfflinePage> {
  const pages: Record<string, OfflinePage> = {}
  if (!raw || typeof raw !== "object") return pages
  for (const [slot, value] of Object.entries(raw as Record<string, any>)) {
    if (!/^\d+$/.test(slot) || !value || typeof value !== "object") continue
    pages[slot] = { key: String(value.key ?? ""), bytes: Number(value.bytes ?? 0) }
  }
  return pages
}

function parseManifest(raw: unknown): OfflineChapter | null {
  if (!raw || typeof raw !== "object") return null
  const item = raw as Record<string, any>
  if (item.sourceKey == null || item.comicId == null || item.epId == null) return null
  return {
    key: { sourceKey: String(item.sourceKey), comicId: String(item.comicId), epId: String(item.epId) },
    comicTitle: item.comicTitle != null ? String(item.comicTitle) : undefined,
    epTitle: item.epTitle != null ? String(item.epTitle) : undefined,
    cover: item.cover != null ? String(item.cover) : undefined,
    imageKeys: Array.isArray(item.imageKeys) ? item.imageKeys.map(String) : [],
    pages: parsePages(item.pages),
    updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : 0,
  }
}

function loadIndex(): Map<string, OfflineChapter> {
  if (index) return index
  const map = new Map<string, OfflineChapter>()
  for (const name of listDir(offlineRoot())) {
    const raw = readText(join(offlineRoot(), name, "manifest.json"))
    if (!raw) continue
    try {
      const chapter = parseManifest(JSON.parse(raw))
      if (chapter) map.set(idOf(chapter.key), chapter)
    } catch {
    }
  }
  index = map
  return map
}


const bus = createEmitter({ debounceMs: 250 })

export const subscribeOffline = bus.subscribe


interface ChapterTally {
  completed: number
  bytes: number
  unwritten: number
}

const tallies = new WeakMap<OfflineChapter, ChapterTally>()

function tallyOf(chapter: OfflineChapter): ChapterTally {
  const cached = tallies.get(chapter)
  if (cached) return cached
  let completed = 0
  chapter.imageKeys.forEach((imageKey, at) => {
    const page = chapter.pages[String(at)]
    if (page && page.key === imageKey) completed++
  })
  let bytes = 0
  for (const page of Object.values(chapter.pages)) bytes += page.bytes
  const tally: ChapterTally = { completed, bytes, unwritten: 0 }
  tallies.set(chapter, tally)
  return tally
}

const MANIFEST_PAGES_PER_WRITE = 10


function writeChapter(chapter: OfflineChapter) {
  const payload = JSON.stringify({
    sourceKey: chapter.key.sourceKey,
    comicId: chapter.key.comicId,
    epId: chapter.key.epId,
    comicTitle: chapter.comicTitle,
    epTitle: chapter.epTitle,
    cover: chapter.cover,
    imageKeys: chapter.imageKeys,
    pages: chapter.pages,
    updatedAt: chapter.updatedAt,
  })
  if (!writeText(manifestFile(chapter.key), payload)) {
    log("warning", "offline", `manifest 寫入失敗：${chapter.key.epId}`)
  }
  loadIndex().set(idOf(chapter.key), chapter)
  const tally = tallies.get(chapter)
  if (tally) tally.unwritten = 0
}

export function beginChapter(
  key: OfflineKey,
  imageKeys: string[],
  meta: { comicTitle?: string; epTitle?: string; cover?: string } = {}
): OfflineChapter {
  const previous = chapterOf(key)
  const pages: Record<string, OfflinePage> = {}
  let kept = 0
  let bytes = 0
  if (previous) {
    for (const [slot, page] of Object.entries(previous.pages)) {
      const at = Number(slot)
      if (imageKeys[at] === page.key && exists(pageFile(key, at))) {
        pages[slot] = page
        kept++
        bytes += page.bytes
      } else remove(pageFile(key, at))
    }
  }
  const chapter: OfflineChapter = {
    key,
    comicTitle: meta.comicTitle,
    epTitle: meta.epTitle,
    cover: meta.cover,
    imageKeys: [...imageKeys],
    pages,
    updatedAt: Date.now(),
  }
  tallies.set(chapter, { completed: kept, bytes, unwritten: 0 })
  writeChapter(chapter)
  bus.emitDebounced()
  return chapter
}

export function savePage(chapter: OfflineChapter, index: number, imageKey: string, bytes: Uint8Array): void {
  const target = pageFile(chapter.key, index)
  ensureDir(folderOf(chapter.key))
  const temp = target + ".part"
  FileManager.writeAsBytesSync(temp, bytes)
  if (exists(target)) remove(target)
  FileManager.renameSync(temp, target)
  const slot = String(index)
  const tally = tallyOf(chapter)
  const previous = chapter.pages[slot]
  if (previous) {
    tally.bytes -= previous.bytes
    if (chapter.imageKeys[index] === previous.key) tally.completed--
  }
  chapter.pages[slot] = { key: imageKey, bytes: bytes.byteLength }
  tally.bytes += bytes.byteLength
  if (chapter.imageKeys[index] === imageKey) tally.completed++
  chapter.updatedAt = Date.now()

  loadIndex().set(idOf(chapter.key), chapter)
  tally.unwritten++
  if (tally.unwritten >= MANIFEST_PAGES_PER_WRITE) writeChapter(chapter)
  bus.emitDebounced()
}

export function flushChapter(chapter: OfflineChapter): void {
  writeChapter(chapter)
}

export function removeChapter(key: OfflineKey): void {
  remove(folderOf(key))
  loadIndex().delete(idOf(key))
  if (!hasOfflineChapters(key.sourceKey, key.comicId)) {
    remove(chapterListFile(key.sourceKey, key.comicId))
    chapterLists.delete(comicGroupKey(key))
    chapterListsChanged++
  }
  bus.emitDebounced()
}


export function chapterOf(key: OfflineKey): OfflineChapter | null {
  return loadIndex().get(idOf(key)) ?? null
}

export function listChapters(): OfflineChapter[] {
  return [...loadIndex().values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function comicGroupKey(key: { sourceKey: string; comicId: string }): string {
  return `${key.sourceKey}\n${key.comicId}`
}

export function comicCount(): number {
  const comics = new Set<string>()
  for (const chapter of loadIndex().values()) comics.add(comicGroupKey(chapter.key))
  return comics.size
}

export function statusOf(key: OfflineKey): OfflineStatus {
  const chapter = chapterOf(key)
  const total = chapter?.imageKeys.length ?? 0
  const tally = chapter ? tallyOf(chapter) : null
  const completed = tally?.completed ?? 0
  const bytes = tally?.bytes ?? 0
  const state: OfflineState = total > 0 && completed >= total ? "done" : completed > 0 ? "partial" : "none"
  return { state, completed, total, bytes }
}

export function isComplete(key: OfflineKey): boolean {
  return statusOf(key).state === "done"
}

export interface ReaderChapter {
  id: string
  title: string
  group?: string
  locked?: boolean
}

export function chaptersForReader(sourceKey: string, comicId: string): ReaderChapter[] {
  return listChapters()
    .filter(chapter => chapter.key.sourceKey === sourceKey && chapter.key.comicId === comicId)
    .filter(chapter => statusOf(chapter.key).state === "done")
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .map(chapter => ({ id: chapter.key.epId, title: chapter.epTitle ?? chapter.key.epId }))
}


export function hasOfflineChapters(sourceKey: string, comicId: string): boolean {
  const group = comicGroupKey({ sourceKey, comicId })
  for (const chapter of loadIndex().values()) if (comicGroupKey(chapter.key) === group) return true
  return false
}

function chapterListFile(sourceKey: string, comicId: string): string {
  const hash = Convert.hexEncode(Convert.md5(Convert.encodeUtf8(comicGroupKey({ sourceKey, comicId }))))
  return join(appDataRoot(), "offline-chapters", `${hash}.json`)
}


const NO_LIST_FILE = -1

interface ChapterListCache {
  mtime: number
  chapters: ReaderChapter[] | null
}

const chapterLists = new Map<string, ChapterListCache>()

let chapterListsChanged = 0

export function chapterListsRevision(): number {
  return chapterListsChanged
}

let chapterListReads = 0

export function debugChapterListReads(): number {
  return chapterListReads
}

function chapterListMtime(path: string): number {
  try {
    if (!FileManager.existsSync(path)) return NO_LIST_FILE
    const value = Number(FileManager.statSync(path).modificationDate ?? 0)
    return Number.isFinite(value) ? value : NO_LIST_FILE
  } catch {
    return NO_LIST_FILE
  }
}

function parseChapterList(raw: string | null): ReaderChapter[] | null {
  if (!raw) return null
  try {
    const item = JSON.parse(raw) as Record<string, any>
    if (item.order !== CHAPTER_LIST_ORDER || !Array.isArray(item.chapters)) return null
    const chapters: ReaderChapter[] = []
    for (const entry of item.chapters) {
      if (!entry || typeof entry !== "object" || entry.id == null) continue
      chapters.push({
        id: String(entry.id),
        title: entry.title != null ? String(entry.title) : String(entry.id),
        group: entry.group != null ? String(entry.group) : undefined,
        locked: entry.locked === true ? true : undefined,
      })
    }
    return chapters
  } catch {
    return null
  }
}

function readChapterList(path: string): ReaderChapter[] | null {
  chapterListReads++
  return parseChapterList(readText(path))
}

const CHAPTER_LIST_ORDER = "reading"

export function saveChapterList(sourceKey: string, comicId: string, chapters: ReaderChapter[]): void {
  const path = chapterListFile(sourceKey, comicId)
  const group = comicGroupKey({ sourceKey, comicId })
  const payload = JSON.stringify({ updatedAt: Date.now(), order: CHAPTER_LIST_ORDER, chapters })
  chapterListsChanged++
  if (!writeText(path, payload)) {
    log("warning", "offline", `章節清單快取寫入失敗：${comicId}`)
    chapterLists.delete(group)
    return
  }
  chapterLists.set(group, { mtime: chapterListMtime(path), chapters: parseChapterList(payload) })
}

export function cacheChapterList(sourceKey: string, comicId: string, chapters: ReaderChapter[]): void {
  if (!hasOfflineChapters(sourceKey, comicId)) return
  saveChapterList(sourceKey, comicId, chapters)
}

export function cachedChapterList(sourceKey: string, comicId: string): ReaderChapter[] | null {
  const group = comicGroupKey({ sourceKey, comicId })
  const path = chapterListFile(sourceKey, comicId)
  const cached = chapterLists.get(group)
  let chapters: ReaderChapter[] | null
  if (cached && cached.mtime === chapterListMtime(path)) chapters = cached.chapters
  else {
    chapters = readChapterList(path)
    chapterLists.set(group, { mtime: chapterListMtime(path), chapters })
    if (cached) chapterListsChanged++
  }
  return chapters ? chapters.map(chapter => ({ ...chapter })) : null
}

export function mergeChapterList(
  list: ReaderChapter[] | null,
  sourceKey: string,
  comicId: string
): ReaderChapter[] {
  const downloaded = chaptersForReader(sourceKey, comicId)
  if (!list) return downloaded
  const known = new Set(list.map(chapter => chapter.id))
  return [...list, ...downloaded.filter(chapter => !known.has(chapter.id))]
}

export function offlinePagePath(key: OfflineKey, index: number, imageKey?: string): string | null {
  const page = chapterOf(key)?.pages[String(index)]
  if (!page) return null
  if (imageKey !== undefined && page.key !== imageKey) return null
  const path = pageFile(key, index)
  return exists(path) ? path : null
}

export function totalBytes(): number {
  let total = 0
  for (const chapter of loadIndex().values()) total += tallyOf(chapter).bytes
  return total
}


export interface ReaderImageRequest {
  sourceKey: string
  comicId: string
  epId: string
  pageIndex: number
  imageKey: string
  comicModule: unknown
  retry?: SourceCallRetry
}

export async function readerImageBytes(
  request: ReaderImageRequest,
  cache: PageCache,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const key: OfflineKey = {
    sourceKey: request.sourceKey,
    comicId: request.comicId,
    epId: request.epId,
  }
  const offline = offlinePagePath(key, request.pageIndex, request.imageKey)
  if (offline) {
    const bytes = readBytes(offline)
    if (!bytes) throw new Error("讀不到離線圖片的位元組")
    return bytes
  }

  return cache.bytes(
    {
      sourceKey: request.sourceKey,
      imageKey: request.imageKey,
      comicId: request.comicId,
      epId: request.epId,
      comicModule: request.comicModule,
      retry: request.retry,
    },
    signal
  )
}


export function offlineImageKeys(key: OfflineKey): string[] | null {
  if (statusOf(key).state === "none") return null
  return [...(chapterOf(key)?.imageKeys ?? [])]
}

export async function readChapterImageKeys(
  key: OfflineKey,
  fetchFromSource: () => Promise<string[]>
): Promise<string[]> {
  const offline = offlineImageKeys(key)
  if (offline) return offline
  try {
    return await fetchFromSource()
  } catch (error) {
    const fallback = offlineImageKeys(key)
    if (fallback) return fallback
    throw error
  }
}
