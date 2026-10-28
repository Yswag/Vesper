// 閱讀器的領先頁碼：純 JS 訊號，只有訂閱的葉子元件重繪。
// 不用 useObservable——它每次 setValue 都會重繪持有它的元件（整個閱讀器），不管誰讀。

import { useEffect, useState } from "scripting"

export interface PageSignal {
  readonly value: number | null
  /** 值沒變就不通知。 */
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

/** 訂閱頁碼：只有呼叫這個 hook 的元件會隨翻頁重繪。 */
export function usePageSignal(signal: PageSignal): number | null {
  const [value, setValue] = useState<number | null>(signal.value)
  useEffect(() => {
    // 訂閱前可能已經變過（掛載與 effect 之間），先對齊一次。
    setValue(signal.value)
    return signal.subscribe(setValue)
  }, [signal])
  return value
}
