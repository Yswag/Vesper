// 搜尋的篩選列（`search.optionList`）。跟分類那套同一種列，差在三種 `type` 送給源的值不一樣：
//   select       → 選中的值（字串）
//   multi-select → 一個 JSON 字串（選中值的陣列，可以一個都沒選）
//   dropdown     → 值，沒選就是 null
// 搜尋沒有 `showWhen` / `notShowWhen` / `optionLoader`（那三個是分類專有），每一列永遠顯示。

import { optionItems, type OptionItem } from "./options"
import type { InstalledSource } from "./registry"
import { translatedOptionRows } from "./translation"

export type SearchOptionType = "select" | "multi-select" | "dropdown"

/** 內部狀態：select → 值；multi-select → 值的陣列；dropdown → 值或 null（不指定）。 */
export type SearchOptionValue = string | string[] | null

export interface SearchOptionRow {
  label?: string
  type: SearchOptionType
  options: OptionItem[]
  /** 源沒指定 `default` 就是第一項；multi-select 沒指定就是「都不選」。 */
  initial: SearchOptionValue
}

const TYPES: SearchOptionType[] = ["select", "multi-select", "dropdown"]

function typeOf(raw: unknown): SearchOptionType {
  return TYPES.includes(raw as SearchOptionType) ? (raw as SearchOptionType) : "select"
}

function searchOptionRow(raw: unknown): SearchOptionRow | null {
  const row = (raw ?? {}) as Record<string, unknown>
  const options = optionItems(row.options)
  if (options.length === 0) return null

  const type = typeOf(row.type)
  const declared = row.default
  const label = typeof row.label === "string" ? row.label.trim() : ""

  let initial: SearchOptionValue
  if (type === "multi-select") {
    initial = Array.isArray(declared)
      ? declared.map(String).filter(value => options.some(item => item.value === value))
      : []
  } else {
    const preferred = typeof declared === "string" ? declared : ""
    initial = options.some(item => item.value === preferred) ? preferred : options[0].value
  }

  return { label: label || undefined, type, options, initial }
}

/** 這個源宣告了哪些搜尋篩選列（沒宣告就是空陣列，UI 不用畫）。 */
export function searchOptionRows(source: InstalledSource): SearchOptionRow[] {
  const list = source.instance?.search?.optionList
  if (!Array.isArray(list)) return []
  const rows: Array<SearchOptionRow | null> = list.map((raw: unknown) => searchOptionRow(raw))
  return translatedOptionRows(source.instance, rows.filter((row): row is SearchOptionRow => row != null))
}

export function defaultSearchValues(rows: SearchOptionRow[]): SearchOptionValue[] {
  return rows.map(row => row.initial)
}

function sameValue(a: SearchOptionValue, b: SearchOptionValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = Array.isArray(a) ? a : []
    const right = Array.isArray(b) ? b : []
    return left.length === right.length && left.every((value, index) => value === right[index])
  }
  return a === b
}

/** 有沒有跟預設不同（UI 上的「已改過」記號）。 */
export function hasCustomSearchOptions(rows: SearchOptionRow[], values: SearchOptionValue[]): boolean {
  return rows.some((row, index) => !sameValue(row.initial, values[index] ?? row.initial))
}

/** 這個源預設要送什麼（使用者沒改過篩選時的答案）。 */
export function defaultSearchRequest(source: InstalledSource): Array<string | null> {
  const rows = searchOptionRows(source)
  return encodeSearchOptions(rows, defaultSearchValues(rows))
}

/** 內部狀態 → 源要的 `options` 陣列（照宣告的列順序）。 */
export function encodeSearchOptions(
  rows: SearchOptionRow[],
  values: SearchOptionValue[]
): Array<string | null> {
  return rows.map((row, index) => {
    const value = values[index] ?? row.initial
    if (row.type === "multi-select") return JSON.stringify(Array.isArray(value) ? value : [])
    if (row.type === "dropdown") return typeof value === "string" ? value : null
    return typeof value === "string" ? value : (row.initial as string)
  })
}

/** 存下來的 `options` → 內部狀態；值對不上（源更新過）就退回該列的預設。 */
export function decodeSearchOptions(
  rows: SearchOptionRow[],
  raw: Array<string | null> | undefined
): SearchOptionValue[] {
  return rows.map((row, index) => {
    const item = raw?.[index] ?? null
    if (row.type === "multi-select") {
      if (typeof item !== "string") return row.initial
      try {
        const parsed = JSON.parse(item)
        if (!Array.isArray(parsed)) return row.initial
        return parsed.map(String).filter(value => row.options.some(option => option.value === value))
      } catch {
        return row.initial
      }
    }
    if (typeof item !== "string") return row.initial
    return row.options.some(option => option.value === item) ? item : row.initial
  })
}
