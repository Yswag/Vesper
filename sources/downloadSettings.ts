import { createEmitter } from "../engine/emitter"
import { kv } from "../engine/storage"

const KEY = "venera:backgroundDownloads"

const bus = createEmitter()

export function getBackgroundDownloads(): boolean {
  return kv.get(KEY) === true
}

export function setBackgroundDownloads(value: boolean): void {
  if (getBackgroundDownloads() === value) return
  if (value) kv.set(KEY, true)
  else kv.remove(KEY)
  bus.emit()
}

export const subscribeBackgroundDownloads = bus.subscribe
