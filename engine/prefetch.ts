import type { AbortSignal } from "scripting"

import { isAbortError } from "./http"

const DEFAULT_AHEAD = 2
const CONCURRENCY = 2

export interface PrefetchQueueOptions {
  total: number
  load(page: number): Promise<unknown>
  ahead?(): number
  signal?: AbortSignal
  onError?(page: number, error: unknown): void
}

export interface PrefetchQueue {
  focus(page: number): void
  clear(): void
}

export function createPrefetchQueue(options: PrefetchQueueOptions): PrefetchQueue {
  const working = new Set<number>()
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
      const at = queue.indexOf(page)
      if (at >= 0) queue.splice(at, 1)
      if (at >= 0 || (!working.has(page) && !finished.has(page))) {
        queue.unshift(page)
        working.add(page)
      }
      const ahead = options.ahead ? options.ahead() : DEFAULT_AHEAD
      for (let step = 1; step <= ahead; step++) {
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
