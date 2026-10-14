// 正文圖片預取佇列：以當前閱讀頁為中心往前排程預載（預設深度 3 頁，併發 2），
// 採用插隊優先策略並過濾重複請求，消除翻頁等待時間。

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
   * 將指定頁面調整至佇列首位，並將後續深度頁面排入背景載入。
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
      // 當前頁插隊優先載入（若尚未完成或排隊中則置於首位）
      const at = queue.indexOf(page)
      if (at >= 0) queue.splice(at, 1)
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
