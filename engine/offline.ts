// 離線儲存層：負責已下載漫畫章節之磁碟落地、manifest 管理與離線優先取圖。
// 目錄位於 <documents>/offline/，章節以 (sourceKey, comicId, epId) 雜湊隔離。

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

/** 單頁的紀錄：圖片鍵（源更新過這一章的圖時對得出來）與位元組數。 */
export interface OfflinePage {
  key: string
  bytes: number
}

export interface OfflineChapter {
  key: OfflineKey
  comicTitle?: string
  epTitle?: string
  cover?: string
  /** 這一章的圖片鍵；陣列位置就是頁索引。 */
  imageKeys: string[]
  /** 頁索引（字串）→ 該頁的紀錄。有紀錄才代表那一頁存在。 */
  pages: Record<string, OfflinePage>
  updatedAt: number
}

export type OfflineState = "none" | "partial" | "done"

export interface OfflineStatus {
  state: OfflineState
  /** 已完成的張數（只算「索引還在、圖片鍵也還對得上」的頁）。 */
  completed: number
  total: number
  bytes: number
}

// ------------------------------------------------------------------ 路徑與索引

export function offlineRoot(): string {
  return join(appDataRoot(), "offline")
}

/** 章節鍵的識別字串（全 App 一份：索引、下載管理員、下載頁都用它）。 */
export function idOf(key: OfflineKey): string {
  return `${key.sourceKey}\n${key.comicId}\n${key.epId}`
}

/** 章節資料夾（以 key 雜湊避免路徑特殊字元衝突）。 */
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

/** 記憶體索引；第一次用到時掃一次目錄（跟書架一樣，只有一份真相在盤上）。 */
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
      // 壞掉的 manifest 就當那一章不存在，不擋其他章
    }
  }
  index = map
  return map
}

// ------------------------------------------------------------------ 變更通知

/** 變更通知匯流排（去抖 250ms 避免單頁下載密集重繪）。 */
const bus = createEmitter({ debounceMs: 250 })

export const subscribeOffline = bus.subscribe

// ------------------------------------------------------------------ 寫入

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
}

/**
 * 初始化或續傳章節：比對並記錄 imageKeys 清單，清理不相符之過期檔案。
 */
export function beginChapter(
  key: OfflineKey,
  imageKeys: string[],
  meta: { comicTitle?: string; epTitle?: string; cover?: string } = {}
): OfflineChapter {
  const previous = chapterOf(key)
  const pages: Record<string, OfflinePage> = {}
  if (previous) {
    for (const [slot, page] of Object.entries(previous.pages)) {
      const at = Number(slot)
      if (imageKeys[at] === page.key && exists(pageFile(key, at))) pages[slot] = page
      else remove(pageFile(key, at))
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
  writeChapter(chapter)
  bus.emitDebounced()
  return chapter
}

/** 寫入單頁檔案（先寫 .part 再原子重命名）。 */
export function savePage(chapter: OfflineChapter, index: number, imageKey: string, bytes: Uint8Array): void {
  const target = pageFile(chapter.key, index)
  ensureDir(folderOf(chapter.key))
  const temp = target + ".part"
  FileManager.writeAsBytesSync(temp, bytes)
  if (exists(target)) remove(target)
  FileManager.renameSync(temp, target)
  chapter.pages[String(index)] = { key: imageKey, bytes: bytes.byteLength }
  chapter.updatedAt = Date.now()
  writeChapter(chapter)
  bus.emitDebounced()
}

/** 刪掉一整章（manifest 與所有頁面檔案）。 */
export function removeChapter(key: OfflineKey): void {
  remove(folderOf(key))
  loadIndex().delete(idOf(key))
  // 最後一章刪掉時清單快取也收掉（不留孤兒檔）。落點選這裡而不是下載管理員：索引在上一行才更新完，
  // 刪完立刻看剩下的章最準；下載任務晚到的 manifest 寫回只會讓這部暫時少一份快取，下次線上就補回來。
  if (!hasOfflineChapters(key.sourceKey, key.comicId)) remove(chapterListFile(key.sourceKey, key.comicId))
  bus.emitDebounced()
}

// ------------------------------------------------------------------ 查詢

export function chapterOf(key: OfflineKey): OfflineChapter | null {
  return loadIndex().get(idOf(key)) ?? null
}

export function listChapters(): OfflineChapter[] {
  return [...loadIndex().values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 一部漫畫的識別（離線書架依這個分組；格式只寫在這裡）。 */
export function comicGroupKey(key: { sourceKey: string; comicId: string }): string {
  return `${key.sourceKey}\n${key.comicId}`
}

/** 有離線內容的漫畫數（書架分頁的數字）。 */
export function comicCount(): number {
  const comics = new Set<string>()
  for (const chapter of loadIndex().values()) comics.add(comicGroupKey(chapter.key))
  return comics.size
}

function completedOf(chapter: OfflineChapter): number {
  let done = 0
  chapter.imageKeys.forEach((imageKey, at) => {
    const page = chapter.pages[String(at)]
    if (page && page.key === imageKey) done++
  })
  return done
}

function bytesOf(chapter: OfflineChapter): number {
  let total = 0
  for (const page of Object.values(chapter.pages)) total += page.bytes
  return total
}

export function statusOf(key: OfflineKey): OfflineStatus {
  const chapter = chapterOf(key)
  const total = chapter?.imageKeys.length ?? 0
  const completed = chapter ? completedOf(chapter) : 0
  const bytes = chapter ? bytesOf(chapter) : 0
  const state: OfflineState = total > 0 && completed >= total ? "done" : completed > 0 ? "partial" : "none"
  return { state, completed, total, bytes }
}

export function isComplete(key: OfflineKey): boolean {
  return statusOf(key).state === "done"
}

/** 閱讀器的章節項（`id` = epId；ReaderScreen 的 `ChapterRef` 同形狀，清單快取也用這個）。 */
export interface ReaderChapter {
  id: string
  title: string
  group?: string
  locked?: boolean
}

/**
 * 取得指定漫畫已完成下載的章節清單（依下載時間排序）。
 */
export function chaptersForReader(sourceKey: string, comicId: string): ReaderChapter[] {
  return listChapters()
    .filter(chapter => chapter.key.sourceKey === sourceKey && chapter.key.comicId === comicId)
    .filter(chapter => statusOf(chapter.key).state === "done")
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .map(chapter => ({ id: chapter.key.epId, title: chapter.epTitle ?? chapter.key.epId }))
}

// ------------------------------------------------------------------ 章節清單快取
//
// 每部漫畫一份「源給的完整章節清單」。它是快取，不是真相：線上拿到就覆寫，
// 已下載的章永遠留在顯示清單裡（見 `mergeChapterList`）。
// 刻意不放進 `offline/`：`loadIndex()` 會把底下每個項目當章節掃 manifest。

/** 這部漫畫有任何離線內容嗎（只掃既有 manifest，不碰磁碟格式）。 */
export function hasOfflineChapters(sourceKey: string, comicId: string): boolean {
  const group = comicGroupKey({ sourceKey, comicId })
  for (const chapter of loadIndex().values()) if (comicGroupKey(chapter.key) === group) return true
  return false
}

function chapterListFile(sourceKey: string, comicId: string): string {
  const hash = Convert.hexEncode(Convert.md5(Convert.encodeUtf8(comicGroupKey({ sourceKey, comicId }))))
  return join(appDataRoot(), "offline-chapters", `${hash}.json`)
}

/** 覆寫這部漫畫的章節清單快取（照源給的順序）。 */
export function saveChapterList(sourceKey: string, comicId: string, chapters: ReaderChapter[]): void {
  const payload = JSON.stringify({ updatedAt: Date.now(), chapters })
  if (!writeText(chapterListFile(sourceKey, comicId), payload)) {
    log("warning", "offline", `章節清單快取寫入失敗：${comicId}`)
  }
}

/**
 * 線上取得清單時記下來。這部完全沒有離線內容就不留檔——不替每部瀏覽過的漫畫存檔。
 * （下載開始時走 `saveChapterList`：那時第一話還沒落地，這個守衛會把它擋掉。）
 */
export function cacheChapterList(sourceKey: string, comicId: string, chapters: ReaderChapter[]): void {
  if (!hasOfflineChapters(sourceKey, comicId)) return
  saveChapterList(sourceKey, comicId, chapters)
}

/** 這部漫畫上一次線上取得的章節清單；沒有、或讀不懂就回 null（呼叫端一律要能退回下載清單）。 */
export function cachedChapterList(sourceKey: string, comicId: string): ReaderChapter[] | null {
  const raw = readText(chapterListFile(sourceKey, comicId))
  if (!raw) return null
  try {
    const item = JSON.parse(raw) as Record<string, any>
    if (!Array.isArray(item.chapters)) return null
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

/**
 * 顯示用的章節清單＝`list`（最新的線上或快取）原順序，加上不在裡面、但已下載完的章
 * （照下載時間附在最後）。`list` 為 null 就等同現在的 `chaptersForReader()`。
 * 清單變動永遠不刪下載檔：源把一話拿掉，手機上那一話照樣看得到。
 */
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

/** 這一頁的離線檔路徑；沒有、或圖片鍵對不上（源換過這一章的圖）就回 null。 */
export function offlinePagePath(key: OfflineKey, index: number, imageKey?: string): string | null {
  const page = chapterOf(key)?.pages[String(index)]
  if (!page) return null
  if (imageKey !== undefined && page.key !== imageKey) return null
  const path = pageFile(key, index)
  return exists(path) ? path : null
}

/** 所有離線章節的佔用位元組（下載頁要顯示的數字）。 */
export function totalBytes(): number {
  let total = 0
  for (const chapter of loadIndex().values()) total += bytesOf(chapter)
  return total
}

// ------------------------------------------------------------------ 閱讀器取圖

export interface ReaderImageRequest {
  sourceKey: string
  comicId: string
  epId: string
  /** 這一張在章節裡的頁索引（＝閱讀器的頁碼）。 */
  pageIndex: number
  imageKey: string
  /** 源的 comic 區塊；只有沒命中離線時才會被問 onImageLoad。 */
  comicModule: unknown
  /**
   * 解析圖片請求時的重試（登入過期自動重登）。由呼叫端提供——engine 不認識源的型別。
   */
  retry?: SourceCallRetry
}

/**
 * 閱讀器正文取圖位元組（離線檔案 ➔ 正文記憶體 LRU ➔ 網路）。
 */
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

  // 沒命中離線 → 正文管線（解析源的請求 → 記憶體 → 網路，onResponse / modifyImage 都在那一步）。
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

// ------------------------------------------------------------------ 開章

/** 離線層記下的頁面清單（含頁序）；一張都沒抓到就回 null（等於這一章不在離線層）。 */
export function offlineImageKeys(key: OfflineKey): string[] | null {
  if (statusOf(key).state === "none") return null
  return [...(chapterOf(key)?.imageKeys ?? [])]
}

/**
 * 取得章節圖片鍵清單（離線存在時直接採用 manifest，否則向線上請求）。
 */
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
