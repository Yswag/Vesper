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
  page?: number
  pageCount?: number
  offline?: boolean
  readEpIds?: string[]
  updatedAt: number
}

export interface ComicUpdateRecord {
  sourceKey: string
  comicId: string
  latestEpId: string
  latestEpTitle: string
  chapterCount: number
  seenChapterCount?: number
  checkedAt: number
  status?: ComicStatus
  updateTime?: string
}

export interface DayComic {
  sourceKey: string
  comicId: string
  title: string
  cover?: string
  epTitles: string[]
}

export interface DayActivity {
  chapters: number
  pages: number
  comics?: DayComic[]
}

interface Library {
  version: number
  favorites: Favorite[]
  progress: Record<string, Progress>
  updates: Record<string, ComicUpdateRecord>
  activity: Record<string, DayActivity>
}

const VERSION = 1

function normalize(raw: unknown): Library {
  const parsed = (raw && typeof raw === "object" ? raw : {}) as Partial<Library>
  return {
    version: parsed.version ?? VERSION,
    favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
    progress: parsed.progress && typeof parsed.progress === "object" ? parsed.progress : {},
    updates: cleanUpdates(parsed.updates),
    activity: cleanActivity(parsed.activity),
  }
}

const KV_KEY = "venera:library"
const FLUSH_DELAY = 500

let cache: Library | null = null
let timer: ReturnType<typeof setTimeout> | null = null

let revision = 0
let favoritesCache: { revision: number; items: Favorite[] } | null = null
let progressCache: { revision: number; items: Progress[] } | null = null

export function libraryRevision(): number {
  return revision
}

const bus = createEmitter({ debounceMs: 250 })

export const subscribeLibrary = bus.subscribe

function libraryPath(): string {
  return join(appDataRoot(), "library.json")
}

function load(): Library {
  if (cache) return cache

  const raw = readText(libraryPath()) ?? stringifyKv()
  if (raw) {
    try {
      cache = normalize(JSON.parse(raw))
      return cache
    } catch {
    }
  }
  cache = { version: VERSION, favorites: [], progress: {}, updates: {}, activity: {} }
  return cache
}

export function reloadLibraryFromDisk(): void {
  const raw = readText(libraryPath())
  if (!raw) return
  try {
    cache = normalize(JSON.parse(raw))
    revision++
    bus.emitDebounced()
  } catch {
  }
}

function schedule() {
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    flushLibrary()
  }, FLUSH_DELAY)
}

export function flushLibrary(): void {
  if (!cache) return
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  const payload = JSON.stringify(cache)
  if (!writeText(libraryPath(), payload)) kv.set(KV_KEY, payload)
}

function stringifyKv(): string | null {
  const raw = kv.get(KV_KEY)
  return typeof raw === "string" ? raw : null
}

type NotifyMode = "now" | "debounced" | "none"

function mutate(fn: (library: Library) => boolean | void, notify: NotifyMode = "debounced"): void {
  if (fn(load()) === false) return
  revision++
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
      seenChapterCount: typeof entry.seenChapterCount === "number" ? entry.seenChapterCount : undefined,
      checkedAt: typeof entry.checkedAt === "number" ? entry.checkedAt : 0,
      status: entry.status,
      updateTime: typeof entry.updateTime === "string" ? entry.updateTime : undefined,
    }
  }
  return updates
}

function cleanActivity(raw: unknown): Record<string, DayActivity> {
  const activity: Record<string, DayActivity> = {}
  if (!raw || typeof raw !== "object") return activity
  for (const [day, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = value as Partial<DayActivity> | null
    if (!entry || typeof entry !== "object") continue
    const comics = Array.isArray(entry.comics)
      ? entry.comics.filter(
          (comic): comic is DayComic =>
            Boolean(comic) && typeof comic.sourceKey === "string" && typeof comic.comicId === "string"
        ).map(comic => ({
          ...comic,
          title: typeof comic.title === "string" ? comic.title : "",
          epTitles: Array.isArray(comic.epTitles) ? comic.epTitles.filter(title => typeof title === "string") : [],
        }))
      : undefined
    activity[day] = {
      chapters: typeof entry.chapters === "number" ? entry.chapters : 0,
      pages: typeof entry.pages === "number" ? entry.pages : 0,
      comics: comics && comics.length > 0 ? comics : undefined,
    }
  }
  return activity
}

function cleanIds(ids: readonly string[] | undefined): string[] | undefined {
  const unique = new Set<string>()
  for (const id of ids ?? []) if (id) unique.add(id)
  return unique.size > 0 ? [...unique] : undefined
}

function withReadIds(entry: Progress, ids: string[] | undefined): Progress {
  return { ...entry, readEpIds: ids && ids.length > 0 ? ids : undefined }
}

function recordFor(library: Library, sourceKey: string, comicId: string): Progress {
  const key = keyOf(sourceKey, comicId)
  const existing = library.progress[key]
  if (existing) return existing
  const record: Progress = { sourceKey, comicId, title: "", epId: "", epTitle: "", updatedAt: Date.now() }
  library.progress[key] = record
  return record
}


export function listFavorites(): Favorite[] {
  if (favoritesCache?.revision !== revision) {
    favoritesCache = { revision, items: [...load().favorites].sort((a, b) => b.addedAt - a.addedAt) }
  }
  return [...favoritesCache.items]
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
    markSeen(library, entry.sourceKey, entry.comicId)
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


export function getProgress(sourceKey: string, comicId: string): Progress | undefined {
  return load().progress[keyOf(sourceKey, comicId)]
}

export function listProgress(): Progress[] {
  if (progressCache?.revision !== revision) {
    progressCache = {
      revision,
      items: Object.values(load().progress)
        .filter(entry => Boolean(entry.epId))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    }
  }
  return [...progressCache.items]
}

export function setProgress(entry: Omit<Progress, "updatedAt">, options: { notify?: boolean } = {}) {
  mutate(library => {
    const key = keyOf(entry.sourceKey, entry.comicId)
    const previous = library.progress[key]
    const finished =
      entry.page !== undefined &&
      entry.pageCount !== undefined &&
      entry.pageCount > 0 &&
      entry.page === entry.pageCount - 1
    const base = entry.readEpIds !== undefined ? cleanIds(entry.readEpIds) : previous?.readEpIds
    const readEpIds = base && base.length > 0 ? base : undefined
    const turnedPage =
      entry.page !== undefined && (previous?.epId !== entry.epId || previous?.page !== entry.page)
    const newlyFinished = finished && Boolean(entry.epId) && !(readEpIds ?? []).includes(entry.epId)
    if (turnedPage || newlyFinished) {
      recordActivity(library, { chapters: newlyFinished ? 1 : 0, pages: turnedPage ? 1 : 0 }, entry)
    }
    const ids = newlyFinished ? cleanIds([...(readEpIds ?? []), entry.epId]) : readEpIds
    library.progress[key] = withReadIds({ ...entry, updatedAt: Date.now() }, ids)
    markSeen(library, entry.sourceKey, entry.comicId)
  }, options.notify === false ? "none" : "debounced")
}

export function notifyLibrary(): void {
  bus.emitDebounced()
}

export function markChapterRead(sourceKey: string, comicId: string, epIds: string[], isRead: boolean): void {
  const ids = cleanIds(epIds)
  if (!ids) return
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
    if (isRead) markSeen(library, sourceKey, comicId)
  }, "now")
}

export function markAllChaptersRead(sourceKey: string, comicId: string, allEpIds: string[]): void {
  markChapterRead(sourceKey, comicId, allEpIds, true)
}

const NO_READ_IDS: ReadonlySet<string> = new Set()

const readIdsCache = new WeakMap<Progress, ReadonlySet<string>>()

export function readChapterIds(sourceKey: string, comicId: string): ReadonlySet<string> {
  const record = getProgress(sourceKey, comicId)
  if (!record) return NO_READ_IDS
  const cached = readIdsCache.get(record)
  if (cached) return cached
  const ids: ReadonlySet<string> = new Set(cleanIds(record.readEpIds) ?? [])
  readIdsCache.set(record, ids)
  return ids
}

export function isChapterRead(sourceKey: string, comicId: string, epId: string): boolean {
  return readChapterIds(sourceKey, comicId).has(epId)
}

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


const ACTIVITY_KEEP_DAYS = 400

export function dayKey(time: number): string {
  const date = new Date(time)
  const pad = (value: number): string => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function recordActivity(
  library: Library,
  delta: { chapters: number; pages: number },
  entry: Omit<Progress, "updatedAt">
): void {
  const now = Date.now()
  const today = dayKey(now)
  const current = library.activity[today]
  if (!current) {
    const cutoff = dayKey(now - ACTIVITY_KEEP_DAYS * 24 * 60 * 60 * 1000)
    for (const day of Object.keys(library.activity)) if (day < cutoff) delete library.activity[day]
  }
  const comics = (current?.comics ?? []).filter(
    comic => !(comic.sourceKey === entry.sourceKey && comic.comicId === entry.comicId)
  )
  const previous = current?.comics?.find(
    comic => comic.sourceKey === entry.sourceKey && comic.comicId === entry.comicId
  )
  const epTitles = previous?.epTitles ?? []
  comics.push({
    sourceKey: entry.sourceKey,
    comicId: entry.comicId,
    title: entry.title || previous?.title || "",
    cover: entry.cover ?? previous?.cover,
    epTitles: entry.epTitle && !epTitles.includes(entry.epTitle) ? [...epTitles, entry.epTitle] : epTitles,
  })
  library.activity[today] = {
    chapters: (current?.chapters ?? 0) + delta.chapters,
    pages: (current?.pages ?? 0) + delta.pages,
    comics,
  }
}

export function readingActivity(): Record<string, DayActivity> {
  return { ...load().activity }
}


export function getComicUpdate(sourceKey: string, comicId: string): ComicUpdateRecord | undefined {
  return load().updates[keyOf(sourceKey, comicId)]
}

function seenCountOf(record: ComicUpdateRecord | undefined): number | undefined {
  if (!record) return undefined
  return record.seenChapterCount ?? (record.chapterCount > 0 ? record.chapterCount : undefined)
}

export function setComicUpdate(record: ComicUpdateRecord): void {
  mutate(library => {
    const key = keyOf(record.sourceKey, record.comicId)
    const seen = record.seenChapterCount ?? seenCountOf(library.updates[key]) ?? record.chapterCount
    library.updates[key] = {
      ...record,
      seenChapterCount: record.chapterCount > 0 ? Math.min(seen, record.chapterCount) : seen,
    }
  })
}

function markSeen(library: Library, sourceKey: string, comicId: string): void {
  const key = keyOf(sourceKey, comicId)
  const record = library.updates[key]
  if (!record || record.chapterCount <= 0 || record.seenChapterCount === record.chapterCount) return
  library.updates[key] = { ...record, seenChapterCount: record.chapterCount }
}

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
