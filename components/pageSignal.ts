import { useEffect, useState } from "scripting"

export interface PageSignal {
  readonly value: number | null
  set(value: number | null): void
  subscribe(listener: (value: number | null) => void): () => void
}

export function createPageSignal(initial: number | null): PageSignal {
  let current = initial
  const listeners = new Set<(value: number | null) => void>()
  return {
    get value() {
      return current
    },
    set(value) {
      if (value === current) return
      current = value
      listeners.forEach(listener => listener(value))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function usePageSignal(signal: PageSignal): number | null {
  const [value, setValue] = useState<number | null>(signal.value)
  useEffect(() => {
    setValue(signal.value)
    return signal.subscribe(setValue)
  }, [signal])
  return value
}
