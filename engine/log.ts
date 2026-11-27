import { createEmitter } from "./emitter"
import { timerAfter } from "./timers"

export type LogLevel = "debug" | "info" | "warning" | "error"

export interface LogEntry {
  id: number
  time: number
  level: LogLevel
  scope: string
  message: string
  detail?: string
}

const LIMIT = 500
const entries: LogEntry[] = []
let nextId = 1

const bus = createEmitter()

let pendingNotify: ReturnType<typeof setTimeout> | null = null

function scheduleNotify() {
  if (pendingNotify !== null) return
  pendingNotify = timerAfter(() => {
    pendingNotify = null
    bus.emit()
  }, 0)
  if (pendingNotify === null) bus.emit()
}

function notifyNow() {
  if (pendingNotify !== null) {
    clearTimeout(pendingNotify)
    pendingNotify = null
  }
  bus.emit()
}

export function logEntries(): LogEntry[] {
  return entries
}

export const subscribeLog = bus.subscribe

export function clearLog() {
  entries.length = 0
  notifyNow()
}

export function log(level: LogLevel, scope: string, message: string, detail?: unknown) {
  const entry: LogEntry = {
    id: nextId++,
    time: Date.now(),
    level,
    scope,
    message,
  }
  if (detail !== undefined) entry.detail = stringifyDetail(detail)
  entries.push(entry)
  if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT)
  scheduleNotify()
}

function stringifyDetail(detail: unknown): string {
  if (typeof detail === "string") return detail
  if (detail instanceof Error) return `${detail.name}: ${detail.message}`
  try {
    return JSON.stringify(detail)
  } catch {
    return String(detail)
  }
}
