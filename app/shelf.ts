import { canResumeOffline } from "./offlineReading"
import { comicLibrary } from "./services"
import { parseUpdateTime } from "./updates"
import { cachedChapterList, chapterListsRevision, comicGroupKey, type ReaderChapter } from "../engine/offline"
import {
  getComicUpdate,
  libraryRevision,
  listFavorites,
  listProgress,
  readChapterIds,
  type ComicUpdateRecord,
  type Favorite,
  type Progress,
} from "../library/bookshelf"
import { sourcesRevision } from "../sources/registry"

export type ShelfSort = "recent" | "added" | "title"
export type ShelfFilter = "all" | "updates" | "read" | "unread"

export function readFraction(progress: Progress | undefined): number | undefined {
  if (!progress || progress.page === undefined || !progress.pageCount || progress.pageCount <= 1) return undefined
  return Math.min(1, (progress.page + 1) / progress.pageCount)
}

export interface ResumeEntry extends Progress {
  openable: boolean
  offline: boolean
  source: "present" | "offlineOnly" | "removed"
  sourceName?: string
  readFraction?: number
  pageLabel?: { page: number; total?: number }
}

export function resumeEntry(progress: Progress): ResumeEntry {
  const offline = canResumeOffline(
    { sourceKey: progress.sourceKey, comicId: progress.comicId, epId: progress.epId },
    progress.offline
  )
  const source = comicLibrary().source(progress.sourceKey)
  const page = progress.page
  const count = progress.pageCount
  return {
    ...progress,
    openable: source !== undefined || offline,
    offline,
    source: source ? "present" : offline ? "offlineOnly" : "removed",
    sourceName: source?.name,
    readFraction: readFraction(progress),
    pageLabel: page === undefined ? undefined : { page: page + 1, total: count && count > 1 ? count : undefined },
  }
}

export function unreadChapters(
  record: ComicUpdateRecord | undefined,
  readIds: ReadonlySet<string>,
  chapters?: readonly ReaderChapter[] | null
): number {
  if (!record || record.chapterCount <= 0) return 0
  if (chapters && chapters.length === record.chapterCount) {
    return chapters.filter(chapter => chapter.locked !== true && !readIds.has(chapter.id)).length
  }
  return Math.max(0, record.chapterCount - readIds.size)
}

export function unreadCountOf(favorite: Favorite): number {
  return unreadChapters(
    getComicUpdate(favorite.sourceKey, favorite.comicId),
    readChapterIds(favorite.sourceKey, favorite.comicId),
    cachedChapterList(favorite.sourceKey, favorite.comicId)
  )
}

export function newChapters(record: ComicUpdateRecord | undefined): number {
  if (!record) return 0
  return Math.max(0, record.chapterCount - (record.seenChapterCount ?? record.chapterCount))
}

export function newCountOf(favorite: Favorite): number {
  return newChapters(getComicUpdate(favorite.sourceKey, favorite.comicId))
}

export function byLatestUpdate(a: ComicUpdateRecord, b: ComicUpdateRecord): number {
  return (
    (parseUpdateTime(b.updateTime) ?? 0) - (parseUpdateTime(a.updateTime) ?? 0) || b.checkedAt - a.checkedAt
  )
}

export interface ShelfItem {
  favorite: Favorite
  progress?: Progress
  readFraction?: number
  removed: boolean
  sourceName?: string
  sameTitle: boolean
  unreadCount: number
  newCount: number
}


let itemCache: { revision: string; items: ShelfItem[] } | null = null
let builds = 0

function inputsRevision(): string {
  return `${libraryRevision()}:${sourcesRevision()}:${chapterListsRevision()}`
}

export function debugShelfBuilds(): number {
  return builds
}

function titleKey(title: string): string {
  return title.trim().toLowerCase()
}

function baseItems(): ShelfItem[] {
  const revision = inputsRevision()
  if (!itemCache || itemCache.revision !== revision) {
    builds++
    const progress = new Map(listProgress().map(entry => [comicGroupKey(entry), entry]))
    const favorites = listFavorites()
    const titleCounts = new Map<string, number>()
    for (const favorite of favorites) {
      const key = titleKey(favorite.title)
      titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1)
    }
    itemCache = {
      revision,
      items: favorites.map(favorite => {
        const read = progress.get(comicGroupKey(favorite))
        const source = comicLibrary().source(favorite.sourceKey)
        return {
          favorite,
          progress: read,
          readFraction: readFraction(read),
          removed: source === undefined,
          sourceName: source?.name,
          sameTitle: (titleCounts.get(titleKey(favorite.title)) ?? 0) > 1,
          unreadCount: unreadCountOf(favorite),
          newCount: newCountOf(favorite),
        }
      }),
    }
  }
  return itemCache.items
}

export function shelfFavoriteCount(): number {
  return baseItems().length
}

export interface ShelfSource {
  sourceKey: string
  name?: string
}

export function shelfSources(): ShelfSource[] {
  const sources = new Map<string, ShelfSource>()
  for (const item of baseItems()) {
    const { sourceKey } = item.favorite
    if (!sources.has(sourceKey)) sources.set(sourceKey, { sourceKey, name: item.sourceName })
  }
  return [...sources.values()].sort((a, b) =>
    a.name === undefined || b.name === undefined
      ? Number(a.name === undefined) - Number(b.name === undefined)
      : a.name.localeCompare(b.name)
  )
}

export function shelfItems(sort: ShelfSort, filter: ShelfFilter, sourceKey?: string): ShelfItem[] {
  const items = baseItems()
    .filter(item => sourceKey === undefined || item.favorite.sourceKey === sourceKey)
    .filter(item =>
      filter === "read"
        ? item.progress !== undefined
        : filter === "unread"
          ? item.progress === undefined
          : filter === "updates"
            ? item.newCount > 0
            : true
    )

  const records = new Map<string, ComicUpdateRecord>()
  if (filter === "updates") {
    for (const item of items) {
      const record = getComicUpdate(item.favorite.sourceKey, item.favorite.comicId)
      if (record) records.set(comicGroupKey(item.favorite), record)
    }
  }

  const lastTouched = (item: ShelfItem) => item.progress?.updatedAt ?? item.favorite.addedAt
  return items.sort((a, b) => {
    if (sort === "recent" && filter === "updates") {
      const recordA = records.get(comicGroupKey(a.favorite))
      const recordB = records.get(comicGroupKey(b.favorite))
      const delta = recordA && recordB ? byLatestUpdate(recordA, recordB) : 0
      if (delta !== 0) return delta
    }
    return sort === "title"
      ? a.favorite.title.localeCompare(b.favorite.title)
      : sort === "added"
        ? b.favorite.addedAt - a.favorite.addedAt
        : lastTouched(b) - lastTouched(a)
  })
}

export function backlogItems(): ShelfItem[] {
  return shelfItems("recent", "all")
    .filter(item => !item.removed && item.unreadCount > 0 && item.newCount === 0)
    .sort((a, b) => a.unreadCount - b.unreadCount)
}
