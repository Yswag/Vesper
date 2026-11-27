export type TimerHandle = ReturnType<typeof setTimeout>

export function timerAfter(callback: () => void, ms: number): TimerHandle | null {
  try {
    return setTimeout(callback, ms)
  } catch {
    return null
  }
}

export function timerEvery(callback: () => void, ms: number): TimerHandle | null {
  try {
    return setInterval(callback, ms)
  } catch {
    return null
  }
}
