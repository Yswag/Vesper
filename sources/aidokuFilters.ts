// Aidoku 源的搜尋篩選。
//
// 定義有兩個來源，形狀不一樣，這裡收成同一組列：
//   v2（有 `get_filters` 的源）→ runtime 的 `getFilters()`，`{ type: 0..6, name, options, default }`
//   舊版（只有 `filters.json` 的源）→ `[{ type: "select"|"text"|"sort"|"check"|"multi-select"|"genre"|"group", id, title, options, ids }]`
//
// 送給 runtime 的值一律是描述子 `{ type, name, value }`，`type` 用定義的編號：
//   title 0 / author 1 / select 2 / sort 3 / check 4 / group 5 / genre 6
// select 送的是「選項字串」（runtime 自己用 `ids` 換成索引）；genre 送 included / excluded。

/** 定義的型別編號（bundle 的 `$` enum）。 */
const TYPE = { title: 0, author: 1, select: 2, sort: 3, check: 4, group: 5, genre: 6 } as const

export interface AidokuFilterOption {
  label: string
  value: string
}

export type AidokuFilterRow =
  | { kind: "text"; name: string; label: string; author: boolean }
  | { kind: "select"; name: string; label: string; options: AidokuFilterOption[] }
  | { kind: "multi"; name: string; label: string; options: AidokuFilterOption[]; canExclude: boolean }
  | { kind: "sort"; name: string; label: string; options: string[]; canAscend: boolean }
  | { kind: "check"; name: string; label: string }

export type AidokuFilterValue =
  | string
  | { index: number; ascending: boolean }
  | { included: string[]; excluded: string[] }
  | boolean
  | null

export interface AidokuFilterDescriptor {
  type: number
  name: string
  value: unknown
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function optionList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(item => String(item ?? "")) : []
}

function optionsOf(labels: string[], ids?: string[]): AidokuFilterOption[] {
  return labels.map((label, index) => ({ label, value: ids?.[index] ?? label }))
}

function isAuthor(name: string, label: string): boolean {
  return /author|作者/i.test(`${name} ${label}`)
}

/** v2：runtime `getFilters()` 的定義。 */
function fromRuntime(raw: unknown): AidokuFilterRow | null {
  if (!raw || typeof raw !== "object") return null
  const def = raw as Record<string, unknown>
  const name = text(def.name)
  if (!name) return null
  const options = optionList(def.options)

  switch (def.type) {
    case TYPE.title:
      return { kind: "text", name, label: name, author: false }
    case TYPE.author:
      return { kind: "text", name, label: name, author: true }
    case TYPE.select: {
      if (options.length === 0) return null
      return { kind: "select", name, label: name, options: optionsOf(options) }
    }
    case TYPE.sort: {
      if (options.length === 0) return null
      return { kind: "sort", name, label: name, options, canAscend: def.canAscend === true }
    }
    case TYPE.check:
      return { kind: "check", name, label: name }
    case TYPE.genre: {
      if (options.length === 0) return null
      return { kind: "multi", name, label: name, options: optionsOf(options), canExclude: def.canExclude === true }
    }
    default:
      return null
  }
}

/** 舊版：`filters.json` 的一項。 */
function fromManifest(raw: unknown): AidokuFilterRow | null {
  if (!raw || typeof raw !== "object") return null
  const def = raw as Record<string, unknown>
  const id = text(def.id)
  const label = text(def.title) || text(def.name) || id
  // runtime 用 title / name / id 認這一個篩選，id 最穩。
  const name = id || label
  if (!name) return null
  const options = optionList(def.options)
  const ids = Array.isArray(def.ids) ? def.ids.map(item => String(item ?? "")) : undefined

  switch (text(def.type)) {
    case "title":
      return { kind: "text", name, label, author: false }
    case "author":
      return { kind: "text", name, label, author: true }
    case "text":
      return { kind: "text", name, label, author: isAuthor(name, label) }
    case "select": {
      if (options.length === 0) return null
      return { kind: "select", name, label, options: optionsOf(options, ids) }
    }
    case "sort": {
      if (options.length === 0) return null
      return { kind: "sort", name, label, options, canAscend: def.canAscend === true }
    }
    case "check":
      return { kind: "check", name, label }
    case "genre":
    case "multi-select": {
      if (options.length === 0) return null
      return { kind: "multi", name, label, options: optionsOf(options, ids), canExclude: def.canExclude !== false }
    }
    default:
      return null
  }
}

/** group 只是排版用的標題，裡面的列照樣要能操作，所以攤平。 */
function flatten(defs: unknown[], pick: (raw: unknown) => AidokuFilterRow | null): AidokuFilterRow[] {
  const rows: AidokuFilterRow[] = []
  for (const raw of defs) {
    const def = (raw ?? {}) as Record<string, unknown>
    const isGroup = def.type === TYPE.group || text(def.type) === "group"
    if (isGroup) {
      rows.push(...flatten(Array.isArray(def.filters) ? def.filters : [], pick))
      continue
    }
    const row = pick(raw)
    if (row) rows.push(row)
  }
  return rows
}

/** v2 的定義（`getFilters()` 的結果）；空陣列就代表這個源只有舊版定義。 */
export function runtimeFilterRows(defs: unknown[]): AidokuFilterRow[] {
  return flatten(defs, fromRuntime)
}

/** 舊版定義（`filters.json`）。 */
export function manifestFilterRows(defs: unknown[]): AidokuFilterRow[] {
  return flatten(defs, fromManifest)
}

export function defaultFilterValue(row: AidokuFilterRow): AidokuFilterValue {
  switch (row.kind) {
    case "text":
      return ""
    case "select":
      return row.options[0]?.value ?? ""
    case "multi":
      return { included: [], excluded: [] }
    case "sort":
      return { index: 0, ascending: false }
    case "check":
      return false
  }
}

export function defaultFilterValues(rows: AidokuFilterRow[]): AidokuFilterValue[] {
  return rows.map(defaultFilterValue)
}

function sameValue(a: AidokuFilterValue, b: AidokuFilterValue): boolean {
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    if ("included" in a && "included" in b) {
      return a.included.join("\u0000") === b.included.join("\u0000") && a.excluded.join("\u0000") === b.excluded.join("\u0000")
    }
    if ("index" in a && "index" in b) return a.index === b.index && a.ascending === b.ascending
  }
  return a === b
}

export function hasCustomFilterValues(rows: AidokuFilterRow[], values: AidokuFilterValue[]): boolean {
  return rows.some((row, index) => !sameValue(defaultFilterValue(row), values[index] ?? defaultFilterValue(row)))
}

/** 有沒有「使用者真的設了東西」的篩選（給結果頁那條列顯示數量）。 */
export function activeFilterCount(rows: AidokuFilterRow[], values: AidokuFilterValue[]): number {
  return rows.filter((row, index) => {
    const value = values[index] ?? defaultFilterValue(row)
    if (row.kind === "text") return text(value) !== ""
    if (row.kind === "multi") return typeof value === "object" && value !== null && "included" in value
      ? value.included.length + value.excluded.length > 0
      : false
    if (row.kind === "check") return value === true
    return !sameValue(defaultFilterValue(row), value)
  }).length
}

/** UI 狀態 → runtime 的描述子；只送跟預設不同的列。 */
export function encodeFilters(rows: AidokuFilterRow[], values: AidokuFilterValue[]): AidokuFilterDescriptor[] {
  const out: AidokuFilterDescriptor[] = []
  rows.forEach((row, index) => {
    const value = values[index] ?? defaultFilterValue(row)

    switch (row.kind) {
      case "text": {
        const content = text(value)
        if (!content) return
        out.push({ type: row.author ? TYPE.author : TYPE.title, name: row.name, value: content })
        return
      }
      case "select": {
        if (sameValue(defaultFilterValue(row), value)) return
        out.push({ type: TYPE.select, name: row.name, value: String(value ?? "") })
        return
      }
      case "multi": {
        const picked = typeof value === "object" && value !== null && "included" in value
          ? { included: value.included, excluded: value.excluded }
          : { included: [], excluded: [] }
        if (picked.included.length === 0 && picked.excluded.length === 0) return
        out.push({ type: TYPE.genre, name: row.name, value: picked })
        return
      }
      case "sort": {
        if (sameValue(defaultFilterValue(row), value)) return
        const sort = typeof value === "object" && value !== null && "index" in value ? value : { index: 0, ascending: false }
        out.push({ type: TYPE.sort, name: row.name, value: { index: sort.index, ascending: sort.ascending } })
        return
      }
      case "check": {
        if (value !== true) return
        out.push({ type: TYPE.check, name: row.name, value: true })
      }
    }
  })
  return out
}

/** 存下來的值 → UI 狀態（對不上就退回預設）。 */
export function decodeFilters(rows: AidokuFilterRow[], raw: unknown): AidokuFilterValue[] {
  const list = Array.isArray(raw) ? raw : []
  return rows.map((row, index) => {
    const value = list[index]
    switch (row.kind) {
      case "text":
        return typeof value === "string" ? value : ""
      case "select":
        return typeof value === "string" && row.options.some(option => option.value === value) ? value : defaultFilterValue(row)
      case "multi": {
        if (!value || typeof value !== "object") return { included: [], excluded: [] }
        const picked = value as { included?: unknown; excluded?: unknown }
        const keep = (items: unknown) =>
          Array.isArray(items) ? items.map(String).filter(item => row.options.some(option => option.value === item)) : []
        return { included: keep(picked.included), excluded: keep(picked.excluded) }
      }
      case "sort": {
        const sort = value as { index?: unknown; ascending?: unknown } | undefined
        const index = typeof sort?.index === "number" ? sort.index : 0
        return { index: index >= 0 && index < row.options.length ? index : 0, ascending: sort?.ascending === true }
      }
      case "check":
        return value === true
    }
  })
}
