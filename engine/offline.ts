// 離線層：下載章節的落地，以及閱讀器取圖的優先序。
//
// 為什麼自己一層（不沿用縮圖快取）：快取鍵只認 URL 與 modifyImage，回答不了「這章下載了沒、
// 佔多少」，而且設定頁的「清除縮圖快取」是整個目錄刪掉——下載的東西被它清掉會被當成 bug。
// 所以在 <documents>/Vesper/offline/ 另存一份，自己的目錄與鍵。
//
// 識別＝(sourceKey, comicId, epId) + 頁索引；頁索引就是 loadEp 陣列的位置，閱讀器的頁碼也是它。
// 每章一份 manifest：圖片鍵、張數、已完成張數、總位元組與時間。
//
// 取圖優先序：離線 → 正文記憶體管線（記憶體 LRU → 網路）。離線命中時**不問源的 onImageLoad**——
// 那支函式是拿 URL 用的，飛航模式下解析不出來，這是不打網路就能讀的關鍵。

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

/** 一章一個資料夾；資料夾名用鍵的雜湊（comicId / epId 可能含斜線等路徑字元）。 */
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

/** 去抖 250ms：下載時每抓完一張就變一次，畫面合併成一次重繪（毫秒數是這裡決定的，見 emitter.ts）。 */
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
 * 開始（或續傳）一章：記下這一章的圖片鍵。
 * 已經抓到、而且圖片鍵還對得上的頁留著（重跑只補缺的）；對不上或超出的頁連檔案一起清掉。
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

/** 存一頁的最終位元組（先寫 .part 再改名，跟縮圖快取同一招）。 */
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

/** 閱讀器的章節項（`id` = epId；ReaderScreen 的 `ChapterRef` 同形狀）。 */
export interface ReaderChapter {
  id: string
  title: string
}

/**
 * 這一部能離線讀的章節（只列下載完的），照下載順序排（`updatedAt` 升冪）。
 * 離線入口的閱讀器換話清單吃這一份；下載順序就當閱讀順序。
 */
export function chaptersForReader(sourceKey: string, comicId: string): ReaderChapter[] {
  return listChapters()
    .filter(chapter => chapter.key.sourceKey === sourceKey && chapter.key.comicId === comicId)
    .filter(chapter => statusOf(chapter.key).state === "done")
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .map(chapter => ({ id: chapter.key.epId, title: chapter.epTitle ?? chapter.key.epId }))
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
 * 閱讀器取一張正文圖的**位元組**：離線（本機檔案讀成位元組）→ 正文管線（記憶體 LRU → 網路）。
 * 離線命中時直接回傳離線檔的內容，**不會**呼叫源的圖片解析。
 *
 * `cache` 由呼叫端提供（一份快取＝一次閱讀，見 `engine/pageimages.ts`）：這裡不持有任何跨呼叫的狀態。
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
 * 開一章要的頁面清單（閱讀器開章的唯一入口）。
 *
 * 這一章在離線層就**直接**用離線層記下的清單——`loadEp` 需要網路，飛航模式下根本解析不出來，
 * 而圖其實都在。清單的來源與下載時同一份，所以頁數、頁碼與閱讀進度都跟線上一樣。
 * 沒有離線檔才問源；問源失敗但離線層有東西時（例如剛好在中斷與重跑之間）也退回離線。
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
