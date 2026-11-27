import { createEmitter } from "../engine/emitter"

export const LOADING_TTL_MS = 90_000

export interface LoadingEntry {
  id: number
  message?: string
  onCancel?: () => void
}

let active: LoadingEntry[] = []
let nextId = 1

const expiries = new Map<number, ReturnType<typeof setTimeout>>()

const bus = createEmitter()

export function activeLoadings(): LoadingEntry[] {
  return active
}

export const subscribeLoading = bus.subscribe

export function showLoading(
  onCancelOrMessage?: unknown,
  customMessage?: string,
  ttlMs: number = LOADING_TTL_MS
): number {
  const id = nextId++
  const onCancel = typeof onCancelOrMessage === "function" ? (onCancelOrMessage as () => void) : undefined
  const message = typeof onCancelOrMessage === "string" ? onCancelOrMessage : customMessage

  active = active.concat({
    id,
    message,
    onCancel,
  })
  scheduleExpiry(id, ttlMs)
  bus.emit()
  return id
}

export function hideLoading(id: number) {
  clearExpiry(id)
  const next = active.filter(entry => entry.id !== id)
  if (next.length === active.length) return
  active = next
  bus.emit()
}

function scheduleExpiry(id: number, ttlMs: number) {
  const handle = setTimeout(() => {
    expiries.delete(id)
    hideLoading(id)
  }, ttlMs)
  expiries.set(id, handle)
}

function clearExpiry(id: number) {
  const handle = expiries.get(id)
  if (handle === undefined) return
  expiries.delete(id)
  clearTimeout(handle)
}

export function cancelLoadingFromUser(id: number) {
  const entry = active.find(item => item.id === id)
  if (!entry) return
  if (entry.onCancel) {
    try {
      entry.onCancel()
    } catch {
    }
  }
  hideLoading(id)
}
