// 搜尋歷史。存成一個小 JSON 檔（跟源放在同一個根目錄，之後接 iCloud 同步一起走）。

import { appDataRoot, join, readText, writeText } from "../engine/fs"

const MAX = 30

function historyPath(): string {
  return join(appDataRoot(), "search-history.json")
}

export function loadHistory(): string[] {
  const raw = readText(historyPath())
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

/** 新關鍵字排在最前面，重複的移到最前而不是再插一筆。 */
export function pushHistory(keyword: string): string[] {
  const trimmed = keyword.trim()
  if (!trimmed) return loadHistory()
  const next = [trimmed, ...loadHistory().filter(item => item !== trimmed)].slice(0, MAX)
  writeText(historyPath(), JSON.stringify(next, null, 2))
  return next
}

export function clearHistory(): string[] {
  writeText(historyPath(), "[]")
  return []
}
