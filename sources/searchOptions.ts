import { optionItems, type OptionItem } from "./options"
import type { InstalledSource } from "./registry"
import { translatedOptionRows } from "./translation"

export type SearchOptionType = "select" | "multi-select" | "dropdown"

export type SearchOptionValue = string | string[] | null

export interface SearchOptionRow {
  label?: string
  type: SearchOptionType
  options: OptionItem[]
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

export function hasCustomSearchOptions(rows: SearchOptionRow[], values: SearchOptionValue[]): boolean {
  return rows.some((row, index) => !sameValue(row.initial, values[index] ?? row.initial))
}

export function defaultSearchRequest(source: InstalledSource): Array<string | null> {
  const rows = searchOptionRows(source)
  return encodeSearchOptions(rows, defaultSearchValues(rows))
}

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
