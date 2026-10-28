// 書架收藏與閱讀進度（存於 library.json）：落盤管線（去抖、KV 退守、通知）與各操作的語意都在這支，
// 寫入一律走 `mutate()`，呼叫端只講「這次要不要通知」。

import { createEmitter } from "../engine/emitter"
import { appDataRoot, join, readText, writeText } from "../engine/fs"
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

/**
 * 讀進來的東西一律過這裡：缺欄位補預設，壞掉的追更紀錄整筆丟掉（壞一筆不該擋住整份書架）。
 */
function normalize(raw: unknown): Library {
  const parsed = (raw && typeof raw === "object" ? raw : {}) as Partial<Library>
  return {
    version: parsed.version ?? VERSION,
    favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
    progress: parsed.progress && typeof parsed.progress === "object" ? parsed.progress : {},
    updates: cleanUpdates(parsed.updates),
  }
}

/** 沒有檔案授權時的備援位置（不讓書架默默不落盤）。 */
const KV_KEY = "venera:library"
const FLUSH_DELAY = 500

let cache: Library | null = null
let timer: ReturnType<typeof setTimeout> | null = null

/** 變更通知匯流排（去抖 250ms 合併頻繁的滑動進度更新）。 */
const bus = createEmitter({ debounceMs: 250 })

export const subscribeLibrary = bus.subscribe

function libraryPath(): string {
  return join(appDataRoot(), "library.json")
}

function load(): Library {
  if (cache) return cache

  // 優先直接讀檔（系統已有權限時不必等 ensureFileAccess 非同步返回）；讀不到才退 KV。
  const raw = readText(libraryPath()) ?? stringifyKv()
  if (raw) {
    try {
      cache = normalize(JSON.parse(raw))
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
    cache = normalize(JSON.parse(raw))
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
export function flushLibrary(): void {
  if (!cache) return
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  const payload = JSON.stringify(cache, null, 2)
  // 能寫檔案就寫檔案，寫不進去才存 KV。
  if (!writeText(libraryPath(), payload)) kv.set(KV_KEY, payload)
}

function stringifyKv(): string | null {
  const raw = kv.get(KV_KEY)
  return typeof raw === "string" ? raw : null
}

/** 變更通知的時機：now＝立刻（手動操作）、debounced＝合併（高頻進度）、none＝只落盤。 */
type NotifyMode = "now" | "debounced" | "none"

/**
 * 讀-改-寫：`fn` 回 `false` 表示沒有變更（不落盤、也不通知）。
 * 所有寫入都走這裡，呼叫端只講「這次要不要通知」。
 */
function mutate(fn: (library: Library) => boolean | void, notify: NotifyMode = "debounced"): void {
  if (fn(load()) === false) return
  schedule()
  if (notify === "now") {
    bus.cancelPending()
    bus.emit()
  } else if (notify === "debounced") {
    bus.emitDebounced()
  }
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
  let added = false
  mutate(library => {
    const index = library.favorites.findIndex(
      item => item.sourceKey === entry.sourceKey && item.comicId === entry.comicId
    )
    if (index >= 0) {
      library.favorites.splice(index, 1)
      return
    }
    library.favorites.push({ ...entry, addedAt: Date.now() })
    added = true
  }, "now")
  return added
}

export function removeFavorite(sourceKey: string, comicId: string) {
  mutate(library => {
    library.favorites = library.favorites.filter(
      item => !(item.sourceKey === sourceKey && item.comicId === comicId)
    )
  }, "now")
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
  mutate(library => {
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
  }, options.notify === false ? "none" : "debounced")
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
  // 手動標記要立刻反映在畫面上，不等 250ms 的滑動進度去抖。
  mutate(library => {
    const key = keyOf(sourceKey, comicId)
    const existing = library.progress[key]
    const current = cleanIds(existing?.readEpIds) ?? []
    const next = isRead
      ? (cleanIds([...current, ...ids]) ?? [])
      : current.filter(id => !ids.includes(id))
    if (next.length === current.length) return false

    if (next.length === 0 && existing !== undefined && !existing.epId) {
      delete library.progress[key]
    } else {
      library.progress[key] = withReadIds(existing ?? recordFor(library, sourceKey, comicId), next)
    }
  }, "now")
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
  mutate(library => {
    const key = keyOf(sourceKey, comicId)
    const entry = library.progress[key]
    if (!entry) return false
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
  })
}

// ------------------------------------------------------------------ 追更快取

export function getComicUpdate(sourceKey: string, comicId: string): ComicUpdateRecord | undefined {
  return load().updates[keyOf(sourceKey, comicId)]
}

/** 寫入一部作品的最新一話（同作品覆寫）。 */
export function setComicUpdate(record: ComicUpdateRecord): void {
  mutate(library => {
    library.updates[keyOf(record.sourceKey, record.comicId)] = record
  })
}

/** 整份追更快取（拷貝；呼叫端排序／筛選不會改到 cache）。 */
export function allComicUpdates(): Record<string, ComicUpdateRecord> {
  return { ...load().updates }
}

export function removeComicUpdate(sourceKey: string, comicId: string): void {
  mutate(library => {
    const key = keyOf(sourceKey, comicId)
    if (library.updates[key] === undefined) return false
    delete library.updates[key]
  })
}
