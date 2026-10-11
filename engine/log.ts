// 源的執行日誌。Log 頁訂閱這裡；環狀上限避免長跑爆記憶體。

import { createEmitter } from "./emitter"

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

/**
 * 這一支刻意不傳 `onListenerError`：回報會走 `log()`，那就又跑一輪同一批訂閱者（見 emitter.ts）。
 * 訂閱者出事本來就不該影響寫日誌，遑論再寫一筆日誌。
 */
const bus = createEmitter()

// 通知合併：抓圖熱路徑一頁會寫 3–4 筆 debug，逐筆 emit 就是 Log 頁一行重繪一次。
// 同一個回合（runloop turn）內的寫入合成一次就好。用 `setTimeout(0)` 而不是微任務，是因為
// 熱路徑的寫入多半發生在 `await` 之後的續延裡——微任務會在下一筆寫入之前就先送出去，反而合併不到。
// ⚠️ Scripting 的 setTimeout 回傳 number，而且**第一個一定是 0**（falsy）：計時器一律比 `null`。
let pendingNotify: ReturnType<typeof setTimeout> | null = null

/** 排一次合併通知；已經排了就不再排，所以沒人再寫日誌時也一定送得出去。 */
function scheduleNotify() {
  if (pendingNotify !== null) return
  pendingNotify = setTimeout(() => {
    pendingNotify = null
    bus.emit()
  }, 0)
}

/** 立刻通知，並作廢還沒送出的合併通知（clearLog 是使用者按的，不該等）。 */
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
