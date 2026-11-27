import { timerAfter } from "./timers"

export interface Emitter {
  emit(): void
  emitDebounced(): void
  cancelPending(): void
  subscribe(fn: () => void): () => void
}

export interface EmitterOptions {
  debounceMs?: number
  onListenerError?: (error: unknown) => void
}

export function createEmitter(options: EmitterOptions = {}): Emitter {
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | null = null

  function fire() {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        options.onListenerError?.(error)
      }
    }
  }

  return {
    emit: fire,
    emitDebounced() {
      if (options.debounceMs === undefined || options.debounceMs <= 0) {
        fire()
        return
      }
      if (timer !== null) clearTimeout(timer)
      timer = timerAfter(() => {
        timer = null
        fire()
      }, options.debounceMs)
      if (timer === null) fire()
    },
    cancelPending() {
      if (timer === null) return
      clearTimeout(timer)
      timer = null
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}
