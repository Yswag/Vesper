// 書架收藏與閱讀進度持久化模組。
// 儲存於 library.json（去抖 500ms 寫入，退出前 flush，無檔案權限時退守 KV）。

import { createEmitter } from "../engine/emitter"
import { appDataRoot, hasFileAccess, join, readText, writeText } from "../engine/fs"
import { kv } from "../engine/storage"
import type { ComicStatus } from "../sources/operations"

export interface Favorite {
  sourceKey: string
  comicId: string
  title: string
  cover?: string
  addedAt: number
}

export interface Progress {
  sourceKey: string
  comicId: string
  title: string
  cover?: string
  epId: string
  epTitle: string
  /** 上次閱讀到的領先可見頁（0 起算）。 */
  page?: number
  /** 當前章節總頁數。 */
  pageCount?: number
  /** 是否於離線模式下閱讀。 */
  offline?: boolean
  /**
   * 已讀過的章節 ID（去重、保留標記順序；沒有已讀就是 undefined）。
   * 只標過已讀、還沒開過閱讀器的漫畫也有一筆沒有 `epId` 的紀錄放這個欄位——那不是閱讀歷史。
   */
  readEpIds?: string[]
  updatedAt: number
}

/**
 * 一部作品的追更快取：上一次檢查時源給的最新一話。
 * `checkedAt` 是 TTL 的唯一依據；`status`／`updateTime` 用來決定 TTL 有多長。
 */
export interface ComicUpdateRecord {
  sourceKey: string
  comicId: string
  latestEpId: string
  latestEpTitle: string
  chapterCount: number
  checkedAt: number
  status?: ComicStatus
  updateTime?: string
}

interface Library {
  version: number
  favorites: Favorite[]
  progress: Record<string, Progress>
  updates: Record<string, ComicUpdateRecord>
}

const VERSION = 1
const FLUSH_DELAY = 500
/** 沒有檔案授權時的備援位置（不讓書架默默不落盤）。 */
const KV_KEY = "venera:library"

let cache: Library | null = null
let timer: ReturnType<typeof setTimeout> | null = null

/**
 * 變更通知匯流排（去抖 250ms 合併頻繁的滑動進度更新）。
 */
const bus = createEmitter({ debounceMs: 250 })

export const subscribeLibrary = bus.subscribe

/** 即時通知變更（用於收藏等需要即時反饋的操作）。 */
function notifyNow() {
  bus.cancelPending()
  bus.emit()
}

function libraryPath(): string {
  return join(appDataRoot(), "library.json")
}

/**
 * 讀進來的東西一律過這裡：缺欄位補預設，壞掉的追更紀錄整筆丟掉（壞一筆不該擋住整份書架）。
 */
function normalize(parsed: Partial<Library>): Library {
  return {
    version: parsed.version ?? VERSION,
    favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
    progress: parsed.progress && typeof parsed.progress === "object" ? parsed.progress : {},
    updates: cleanUpdates(parsed.updates),
  }
}

function load(): Library {
  if (cache) return cache

  // 優先嘗試直接讀取檔案（如果系統已經有權限，不必等 ensureFileAccess 非同步返回）
  let raw: string | null = null
  try {
    raw = readText(libraryPath())
  } catch {
    raw = null
  }

  // 檔案讀不到時才嘗試從 KV 讀取
  if (!raw) {
    raw = stringifyKv()
  }

  if (raw) {
    try {
      cache = normalize(JSON.parse(raw) as Partial<Library>)
      return cache
    } catch {
      // 壞檔就從空的開始，不擋啟動
    }
  }
  cache = { version: VERSION, favorites: [], progress: {}, updates: {} }
  return cache
}

/** 當權限確認後，重新同步並載入磁碟上的 library.json（防止剛啟動時權限未結算導致載入空資料） */
export function reloadLibraryFromDisk(): void {
  const raw = readText(libraryPath())
  if (!raw) return
  try {
    cache = normalize(JSON.parse(raw) as Partial<Library>)
    bus.emitDebounced()
  } catch {
    // 忽略格式錯誤
  }
}

function schedule() {
  // ⚠️ 比 `null`，不能只寫 `if (timer)`：Scripting 的 setTimeout 回傳 number，第一個是 `0`（falsy）。
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    flushLibrary()
  }, FLUSH_DELAY)
}

/** 立即落盤（退出前呼叫）。 */
export function flushLibrary() {
  if (!cache) return
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  const payload = JSON.stringify(cache, null, 2)
  // 如果能寫檔案就寫檔案（包含直接寫成功），否則才存 KV
  const wrote = writeText(libraryPath(), payload)
  if (!wrote) {
    kv.set(KV_KEY, payload)
  }
}

function stringifyKv(): string | null {
  const raw = kv.get(KV_KEY)
  return typeof raw === "string" ? raw : null
}

function keyOf(sourceKey: string, comicId: string): string {
  return `${sourceKey}:${comicId}`
}

/** 追更快取只收真的認得的紀錄：沒有 sourceKey／comicId 的整筆丟掉，其餘缺欄位補中性值。 */
function cleanUpdates(raw: unknown): Record<string, ComicUpdateRecord> {
  const updates: Record<string, ComicUpdateRecord> = {}
  if (!raw || typeof raw !== "object") return updates
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = value as Partial<ComicUpdateRecord> | null
    if (!entry || typeof entry !== "object") continue
    if (typeof entry.sourceKey !== "string" || typeof entry.comicId !== "string") continue
    updates[key] = {
      sourceKey: entry.sourceKey,
      comicId: entry.comicId,
      latestEpId: typeof entry.latestEpId === "string" ? entry.latestEpId : "",
      latestEpTitle: typeof entry.latestEpTitle === "string" ? entry.latestEpTitle : "",
      chapterCount: typeof entry.chapterCount === "number" ? entry.chapterCount : 0,
      checkedAt: typeof entry.checkedAt === "number" ? entry.checkedAt : 0,
      status: entry.status,
      updateTime: typeof entry.updateTime === "string" ? entry.updateTime : undefined,
    }
  }
  return updates
}

/** 去重（保留原順序）、丟掉空字串；沒有就回 undefined，空陣列不進 library.json。 */
function cleanIds(ids: readonly string[] | undefined): string[] | undefined {
  const unique = new Set<string>()
  for (const id of ids ?? []) if (id) unique.add(id)
  return unique.size > 0 ? [...unique] : undefined
}

function withReadIds(entry: Progress, ids: readonly string[] | undefined): Progress {
  return { ...entry, readEpIds: cleanIds(ids) }
}

/**
 * 一部漫畫的紀錄。只標已讀、還沒讀過的話先立一筆沒有 `epId` 的殼：
 * 已讀清單要有地方放，但這種殼不算閱讀歷史（`listProgress` 會濾掉）。
 */
function recordFor(library: Library, sourceKey: string, comicId: string): Progress {
  const key = keyOf(sourceKey, comicId)
  const existing = library.progress[key]
  if (existing) return existing
  const record: Progress = { sourceKey, comicId, title: "", epId: "", epTitle: "", updatedAt: Date.now() }
  library.progress[key] = record
  return record
}

// ------------------------------------------------------------------ 收藏

export function listFavorites(): Favorite[] {
  return [...load().favorites].sort((a, b) => b.addedAt - a.addedAt)
}

export function isFavorite(sourceKey: string, comicId: string): boolean {
  return load().favorites.some(item => item.sourceKey === sourceKey && item.comicId === comicId)
}

export function toggleFavorite(entry: Omit<Favorite, "addedAt">): boolean {
  const library = load()
  const index = library.favorites.findIndex(
    item => item.sourceKey === entry.sourceKey && item.comicId === entry.comicId
  )
  if (index >= 0) {
    library.favorites.splice(index, 1)
    schedule()
    notifyNow()
    return false
  }
  library.favorites.push({ ...entry, addedAt: Date.now() })
  schedule()
  notifyNow()
  return true
}

export function removeFavorite(sourceKey: string, comicId: string) {
  const library = load()
  library.favorites = library.favorites.filter(
    item => !(item.sourceKey === sourceKey && item.comicId === comicId)
  )
  schedule()
  notifyNow()
}

// ------------------------------------------------------------------ 進度

export function getProgress(sourceKey: string, comicId: string): Progress | undefined {
  return load().progress[keyOf(sourceKey, comicId)]
}

/**
 * 最近閱讀，新的在前。首頁與書架的「繼續閱讀」都用這個。
 * 沒有 `epId` 的紀錄只是已讀清單的殼，不是閱讀歷史，不列出來。
 */
export function listProgress(): Progress[] {
  return Object.values(load().progress)
    .filter(entry => Boolean(entry.epId))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 儲存閱讀進度。翻到最後一頁時順手把這一話結算成已讀。
 * `notify: false`＝只落盤不通知：閱讀中逐頁寫進度用，離開時再 `notifyLibrary()` 一次，
 * 否則每跨一頁背景的書架／首頁／詳情頁都會跟著重繪。
 */
export function setProgress(entry: Omit<Progress, "updatedAt">, options: { notify?: boolean } = {}) {
  const library = load()
  const key = keyOf(entry.sourceKey, entry.comicId)
  const previous = library.progress[key]
  const finished =
    entry.page !== undefined &&
    entry.pageCount !== undefined &&
    entry.pageCount > 0 &&
    entry.page === entry.pageCount - 1
  // 換話／開啟章節時呼叫端不一定帶已讀清單：一律沿用上一筆，別把已讀洗掉。
  const readEpIds = cleanIds(entry.readEpIds ?? previous?.readEpIds)
  library.progress[key] = withReadIds(
    { ...entry, updatedAt: Date.now() },
    finished && entry.epId ? [...(readEpIds ?? []), entry.epId] : readEpIds
  )
  schedule()
  if (options.notify !== false) bus.emitDebounced()
}

/** 補送一次變更通知（搭配 `setProgress(…, { notify: false })`）。 */
export function notifyLibrary(): void {
  bus.emitDebounced()
}

/**
 * 標記／取消標記已讀（可一次多話）。沒有實際變更就不落盤、也不通知。
 * 已讀清單清空、而且那筆紀錄本來就只是殼時，整筆一起收掉。
 */
export function markChapterRead(sourceKey: string, comicId: string, epIds: string[], isRead: boolean): void {
  const ids = cleanIds(epIds)
  if (!ids) return
  const library = load()
  const key = keyOf(sourceKey, comicId)
  const existing = library.progress[key]
  const current = cleanIds(existing?.readEpIds) ?? []
  const next = isRead
    ? (cleanIds([...current, ...ids]) ?? [])
    : current.filter(id => !ids.includes(id))
  if (next.length === current.length) return

  if (next.length === 0 && existing !== undefined && !existing.epId) {
    delete library.progress[key]
  } else {
    library.progress[key] = withReadIds(existing ?? recordFor(library, sourceKey, comicId), next)
  }
  // 手動標記要立刻反映在畫面上，不等 250ms 的滑動進度去抖。
  schedule()
  notifyNow()
}

/** 一鍵全部已讀（原有已讀清單保留）。 */
export function markAllChaptersRead(sourceKey: string, comicId: string, allEpIds: string[]): void {
  markChapterRead(sourceKey, comicId, allEpIds, true)
}

/** 已讀章節集合（呼叫端要算未讀數／比對目錄時用）。 */
export function readChapterIds(sourceKey: string, comicId: string): Set<string> {
  return new Set(cleanIds(getProgress(sourceKey, comicId)?.readEpIds) ?? [])
}

export function isChapterRead(sourceKey: string, comicId: string, epId: string): boolean {
  return readChapterIds(sourceKey, comicId).has(epId)
}

/**
 * 清掉閱讀歷史。已讀清單是另一件事：刪歷史不該讓看過的章節變回未讀，
 * 所以只把閱讀位置（`epId`／頁碼）抹掉，已讀清單原樣留著。
 */
export function clearProgress(sourceKey: string, comicId: string) {
  const library = load()
  const key = keyOf(sourceKey, comicId)
  const entry = library.progress[key]
  if (!entry) return
  const readEpIds = cleanIds(entry.readEpIds)
  if (readEpIds) {
    library.progress[key] = {
      sourceKey,
      comicId,
      title: "",
      epId: "",
      epTitle: "",
      readEpIds,
      updatedAt: Date.now(),
    }
  } else {
    delete library.progress[key]
  }
  schedule()
  bus.emitDebounced()
}

// ------------------------------------------------------------------ 追更快取

export function getComicUpdate(sourceKey: string, comicId: string): ComicUpdateRecord | undefined {
  return load().updates[keyOf(sourceKey, comicId)]
}

/** 寫入一部作品的最新一話（同作品覆寫）。 */
export function setComicUpdate(record: ComicUpdateRecord): void {
  const library = load()
  library.updates[keyOf(record.sourceKey, record.comicId)] = record
  schedule()
  bus.emitDebounced()
}

/** 整份追更快取（拷貝；呼叫端排序／筛選不會改到 cache）。 */
export function allComicUpdates(): Record<string, ComicUpdateRecord> {
  return { ...load().updates }
}

export function removeComicUpdate(sourceKey: string, comicId: string): void {
  const library = load()
  const key = keyOf(sourceKey, comicId)
  if (library.updates[key] === undefined) return
  delete library.updates[key]
  schedule()
  bus.emitDebounced()
}
