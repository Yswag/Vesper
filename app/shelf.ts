// 書架讀取模型：收藏、閱讀紀錄與來源接成畫面可以直接顯示的值。
// 首頁續讀卡、閱讀歷史、書架收藏網格共用同一份判斷——進度門檻與「開不開得起來」只有這裡一份。

import { canResumeOffline } from "./offlineReading"
import { comicLibrary } from "./services"
import { parseUpdateTime } from "./updates"
import { cachedChapterList, comicGroupKey, type ReaderChapter } from "../engine/offline"
import {
  getComicUpdate,
  listFavorites,
  listProgress,
  readChapterIds,
  type ComicUpdateRecord,
  type Favorite,
  type Progress,
} from "../library/bookshelf"

export type ShelfSort = "recent" | "added" | "title"
/** `updates`＝有新話（見 {@link newCountOf}）。 */
export type ShelfFilter = "all" | "updates" | "read" | "unread"

/**
 * 這一話讀到幾 %；沒有就 undefined。
 * 門檻是 `pageCount > 1`（首頁原本用 `> 0`、歷史與書架用 `> 1`，差別只在單頁章）：
 * 單頁章永遠是滿的，畫進度條沒有意義；沒有頁數的舊紀錄也一併排除。
 */
export function readFraction(progress: Progress | undefined): number | undefined {
  if (!progress || progress.page === undefined || !progress.pageCount || progress.pageCount <= 1) return undefined
  return Math.min(1, (progress.page + 1) / progress.pageCount)
}

/** 續讀紀錄接上來源與離線判斷的結果：Progress 的欄位原樣在，判斷都算好了。 */
export interface ResumeEntry extends Progress {
  /** 點下去開得起來：還有源，或那一話還在下載裡。 */
  openable: boolean
  /** 會走本機檔（上次是離線讀的，而且那一話還在下載裡）。 */
  offline: boolean
  /**
   * 源的狀態。`offlineOnly`＝源被移除了但內容還在手機上：那筆紀錄不該是紅字「來源已移除」，
   * 字怎麼挑由畫面決定（i18n 不進資料層）。
   */
  source: "present" | "offlineOnly" | "removed"
  /** 源還在時的顯示名稱。 */
  sourceName?: string
  /** 這一話讀到幾 %（走 {@link readFraction} 的統一門檻）。 */
  readFraction?: number
  /** 頁碼（1 起算）。`total` 只在這一話多於一頁時才有——「共 1 頁」沒有資訊。 */
  pageLabel?: { page: number; total?: number }
}

/** 一筆閱讀紀錄 → 續讀卡／歷史列要的值。 */
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

/**
 * 未讀章節數的算式（純函式）：追更紀錄的章數扣掉已讀。
 *
 * `chapters` 是這部的章節清單快取，**跟追更紀錄對得上時才用**：鎖住的章節不算未讀，
 * 已讀也只認清單裡真的有的 ID。對不上（快取比紀錄舊）就退回「章數 − 已讀數」——
 * 一時多算一話，總比快取過期把整部作品的角標歸零好。
 */
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

/** 這一部收藏的未讀章節數（封面角標）。沒有追更紀錄＝還沒查過，算 0。 */
export function unreadCountOf(favorite: Favorite): number {
  return unreadChapters(
    getComicUpdate(favorite.sourceKey, favorite.comicId),
    readChapterIds(favorite.sourceKey, favorite.comicId),
    cachedChapterList(favorite.sourceKey, favorite.comicId)
  )
}

/**
 * 新話數的算式（純函式）：讀者上次碰這部之後多出來的章數。跟未讀數是兩件事——
 * 沒追完的舊作未讀很多，但沒有新話。還沒有基準的紀錄當作都看過。
 */
export function newChapters(record: ComicUpdateRecord | undefined): number {
  if (!record) return 0
  return Math.max(0, record.chapterCount - (record.seenChapterCount ?? record.chapterCount))
}

/** 這一部收藏的新話數；> 0 就是「有更新」。 */
export function newCountOf(favorite: Favorite): number {
  return newChapters(getComicUpdate(favorite.sourceKey, favorite.comicId))
}

/**
 * 「有更新」清單的排序（書架的「更新」篩選與 Mini Hub 追更列共用）：最近更新的在前。
 * 源沒給更新日期的排在後面；同一天或都沒日期就照檢查時間。
 */
export function byLatestUpdate(a: ComicUpdateRecord, b: ComicUpdateRecord): number {
  return (
    (parseUpdateTime(b.updateTime) ?? 0) - (parseUpdateTime(a.updateTime) ?? 0) || b.checkedAt - a.checkedAt
  )
}

/** 收藏網格的一格：收藏接上閱讀紀錄，判斷都算好了。 */
export interface ShelfItem {
  favorite: Favorite
  progress?: Progress
  /** 那一話讀到幾 %；沒讀過就沒有。 */
  readFraction?: number
  /** 源被移除了（封面只能用標題佔位）。 */
  removed: boolean
  /** 未讀章節數：封面角標畫這個數字。 */
  unreadCount: number
  /** 新話數：「更新」篩選看它。 */
  newCount: number
}

/** 收藏接閱讀紀錄（同一部一個鍵），再篩選、排序。 */
export function shelfItems(sort: ShelfSort, filter: ShelfFilter): ShelfItem[] {
  const progress = new Map(listProgress().map(entry => [comicGroupKey(entry), entry]))
  const items = listFavorites()
    .map(favorite => {
      const read = progress.get(comicGroupKey(favorite))
      return {
        favorite,
        progress: read,
        readFraction: readFraction(read),
        removed: comicLibrary().source(favorite.sourceKey) === undefined,
        unreadCount: unreadCountOf(favorite),
        newCount: newCountOf(favorite),
      }
    })
    .filter(item =>
      filter === "read"
        ? item.progress !== undefined
        : filter === "unread"
          ? item.progress === undefined
          : filter === "updates"
            ? item.newCount > 0
            : true
    )

  // 「更新」照 `byLatestUpdate` 排；分不出先後時就退回下面原本的規則。
  const records = new Map<string, ComicUpdateRecord>()
  if (filter === "updates") {
    for (const item of items) {
      const record = getComicUpdate(item.favorite.sourceKey, item.favorite.comicId)
      if (record) records.set(comicGroupKey(item.favorite), record)
    }
  }

  // 沒讀過的用收藏時間排，才不會全部沉到最底。
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
