// 每個源的搜尋篩選（`search.optionList` 的選擇）。存成一個小 JSON 檔：
//   { "<sourceKey>": [值, 值, null] }（multi-select 的值本身是一個 JSON 字串）
// 直接存「送去源的那個陣列」，開 sheet 時再用 `decodeSearchOptions` 解回 UI 狀態，
// 順便驗值還對不對得上（源更新過就退回預設）。

import { appDataRoot, join, readText, writeText } from "../engine/fs"

type Selections = Record<string, Array<string | null>>

function selectionsPath(): string {
  return join(appDataRoot(), "search-options.json")
}

export function loadSearchSelections(): Selections {
  const raw = readText(selectionsPath())
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const out: Selections = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue
      out[key] = value.map(item => (typeof item === "string" ? item : null))
    }
    return out
  } catch {
    return {}
  }
}

export function saveSearchSelection(sourceKey: string, options: Array<string | null>) {
  const all = loadSearchSelections()
  all[sourceKey] = options
  writeText(selectionsPath(), JSON.stringify(all, null, 2))
}
