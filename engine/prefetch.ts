// 正文預取佇列：以當前頁為中心往前抓，翻頁時不必等網路。
//
// 為什麼需要：`Lazy*` 只掛可見項（實測 200 項只掛 4–9 項），所以翻到下一頁時那一頁才第一次
// mount、才開始抓圖；而一頁的網路成本是 100–1500ms（傳輸只佔 6–20ms）。只有「更早開始抓」能
// 消掉這段等待。
//
// 這一支只管**排程**：併發上限、當前頁插隊、同頁不重複排、往前幾頁。抓哪一頁、怎麼取消都是
// 參數（`app/comic.ts` 的 `ChapterSession.warm` 把 `pageImage` 與 session 的 signal 綁進來）。
//
// 失敗是靜默的：預取失敗不打擾使用者、不重試（記 debug 由呼叫端決定）；換話／離開造成的
// AbortError 連 debug 都不記——那是正常結束。

import type { AbortSignal } from "scripting"

import { isAbortError } from "./http"

/** 往前幾頁（含當前頁；實測一頁 0.1–0.2MB，3 頁的代價可接受）。 */
const DEPTH = 3
/** 同時抓幾頁（再多會跟「當下要的那一頁」搶頻寬）。 */
const CONCURRENCY = 2

export interface PrefetchQueueOptions {
  /** 這一章有幾頁；越界的頁不排。 */
  total: number
  /** 抓一頁。 */
  load(page: number): Promise<unknown>
  /** 取消範圍；abort 之後在飛的會失敗，排隊中的不再啟動。 */
  signal?: AbortSignal
  /** 失敗的紀錄（取消不算失敗）。預設什麼都不做。 */
  onError?(page: number, error: unknown): void
}

export interface PrefetchQueue {
  /**
   * 把 `page` 拉到最前面，並補上 page+1、page+2（舊的目標**留在原位**，不會被清掉）。
   * 代價：前後翻頁時佇列會累積舊目標，最多多抓一兩頁；這樣「翻回去」還是命中。
   */
  focus(page: number): void
  /** 清空（換話／離開閱讀器）：排隊中的不再啟動，在飛的靠 `signal` 中止。 */
  clear(): void
}

export function createPrefetchQueue(options: PrefetchQueueOptions): PrefetchQueue {
  /** 排隊中或抓取中：同頁不重複排。 */
  const working = new Set<number>()
  /** 抓過的（成功或失敗都算——失敗不重試）。 */
  const finished = new Set<number>()
  let queue: number[] = []
  let active = 0
  let stopped = false

  function pump() {
    if (stopped || options.signal?.aborted) return
    while (active < CONCURRENCY && queue.length > 0) {
      const page = queue.shift() as number
      active++
      Promise.resolve()
        .then(() => options.load(page))
        .then(
          () => {},
          error => {
            // 取消是正常結束（換話／離開），不記；其他失敗留給呼叫端決定要不要記。
            if (!isAbortError(error)) options.onError?.(page, error)
          }
        )
        .finally(() => {
          active--
          working.delete(page)
          finished.add(page)
          pump()
        })
    }
  }

  return {
    focus(page) {
      if (stopped || page < 0 || page >= options.total) return
      // 當前頁：還在排隊就拉到最前面（已經在抓或抓過的不動它，免得重複抓同一頁）。
      const at = queue.indexOf(page)
      if (at >= 0) queue.splice(at, 1)
      // 「從佇列拿出來」與「已經在抓」是兩件事：前者一定要放回去，不然那一頁會被靜默丟掉。
      // 只有「已經在抓或抓過」才不動它（免得重複抓同一頁）。
      if (at >= 0 || (!working.has(page) && !finished.has(page))) {
        queue.unshift(page)
        working.add(page)
      }
      for (let step = 1; step < DEPTH; step++) {
        const target = page + step
        if (target >= options.total || working.has(target) || finished.has(target)) continue
        working.add(target)
        queue.push(target)
      }
      pump()
    },

    clear() {
      stopped = true
      queue = []
    },
  }
}
