// 書架讀取模型：收藏、閱讀紀錄與來源接成畫面可以直接顯示的值。
// 首頁續讀卡、閱讀歷史、書架收藏網格共用同一份判斷——進度門檻與「開不開得起來」只有這裡一份。

import { canResumeOffline } from "./offlineReading"
import { comicLibrary } from "./services"
import { comicGroupKey } from "../engine/offline"
import { listFavorites, listProgress, type Favorite, type Progress } from "../library/bookshelf"

export type ShelfSort = "recent" | "added" | "title"
export type ShelfFilter = "all" | "read" | "unread"

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

/** 收藏網格的一格：收藏接上閱讀紀錄，判斷都算好了。 */
export interface ShelfItem {
  favorite: Favorite
  progress?: Progress
  /** 那一話讀到幾 %；沒讀過就沒有。 */
  readFraction?: number
  /** 源被移除了（封面只能用標題佔位）。 */
  removed: boolean
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
      }
    })
    .filter(item =>
      filter === "read" ? item.progress !== undefined : filter === "unread" ? item.progress === undefined : true
    )
  // 沒讀過的用收藏時間排，才不會全部沉到最底。
  const lastTouched = (item: ShelfItem) => item.progress?.updatedAt ?? item.favorite.addedAt
  return items.sort((a, b) =>
    sort === "title"
      ? a.favorite.title.localeCompare(b.favorite.title)
      : sort === "added"
        ? b.favorite.addedAt - a.favorite.addedAt
        : lastTouched(b) - lastTouched(a)
  )
}
