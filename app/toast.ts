let listener: ((message: string) => void) | null = null

export function showToast(message: string) {
  if (!message) return
  if (listener) listener(message)
}

export function setToastListener(fn: ((message: string) => void) | null) {
  listener = fn
}
