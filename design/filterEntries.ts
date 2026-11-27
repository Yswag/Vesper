// 搜尋篩選的呈現模型：Aidoku 與 Mihon 的定義都先翻成這一組列，畫面只認這裡。
//
// 值的形狀一律是 UI 認得的樣子（select 是索引、tristate 是 0/1/2、sort 是索引加方向），
// 各引擎怎麼存自己的值是 `app/searchFilters.ts` 的事。
//
// 每個欄位同時帶 `control`（現在的值）與 `initial`（源給的預設）：膠囊的選取色、sheet 的「重設」
// 與送出時的「改過幾項」都只比這兩份。

export type Tristate = 0 | 1 | 2

export interface FilterToken {
  label: string
  /** 源自己的選項值（Aidoku 的 genre 用 id）。 */
  value: string
  state: Tristate
}

export type FilterControl =
  | { kind: "text"; value: string; icon: string; prompt?: string }
  | { kind: "select"; value: number; options: string[] }
  | { kind: "check"; value: boolean }
  | { kind: "tristate"; value: Tristate }
  | { kind: "sort"; index: number; ascending: boolean; options: string[]; canAscend: boolean }
  | { kind: "tokens"; tokens: FilterToken[]; canExclude: boolean }

export interface FilterField {
  id: string
  label: string
  control: FilterControl
  initial: FilterControl
}

export type FilterEntry =
  | { kind: "header"; id: string; label: string }
  | { kind: "separator"; id: string }
  | { kind: "field"; field: FilterField }
  /** 可展開的區塊：標題列加子項（子項通常只有 checkbox 與 tristate）。 */
  | { kind: "group"; id: string; label: string; entries: FilterEntry[] }

/** 草稿：欄位 id → 當下的控制項。群組本身沒有值。 */
export type FilterDraft = Record<string, FilterControl>

export function fieldsOf(entries: FilterEntry[]): FilterField[] {
  const out: FilterField[] = []
  for (const entry of entries) {
    if (entry.kind === "field") out.push(entry.field)
    else if (entry.kind === "group") out.push(...fieldsOf(entry.entries))
  }
  return out
}

export function sameControl(a: FilterControl, b: FilterControl): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case "text":
      return a.value === (b as typeof a).value
    case "select":
      return a.value === (b as typeof a).value
    case "check":
      return a.value === (b as typeof a).value
    case "tristate":
      return a.value === (b as typeof a).value
    case "sort": {
      const other = b as typeof a
      return a.index === other.index && a.ascending === other.ascending
    }
    case "tokens": {
      const other = b as typeof a
      return (
        a.tokens.length === other.tokens.length &&
        a.tokens.every((token, index) => token.value === other.tokens[index]?.value && token.state === other.tokens[index]?.state)
      )
    }
  }
}

export function isChanged(field: FilterField): boolean {
  return !sameControl(field.control, field.initial)
}

/** 跟預設不同的項數（膠囊列最前面那個數字）。 */
export function changedCount(entries: FilterEntry[]): number {
  return fieldsOf(entries).filter(isChanged).length
}

/** 現在的值 → 草稿。 */
export function draftOf(entries: FilterEntry[]): FilterDraft {
  const draft: FilterDraft = {}
  for (const field of fieldsOf(entries)) draft[field.id] = field.control
  return draft
}

/** 預設值 → 草稿（sheet 的「重設」）。 */
export function resetDraft(entries: FilterEntry[]): FilterDraft {
  const draft: FilterDraft = {}
  for (const field of fieldsOf(entries)) draft[field.id] = field.initial
  return draft
}

/** 草稿套回列上（膠囊要畫「改過」的顏色，sheet 之外也用得到）。 */
export function applyDraft(entries: FilterEntry[], draft: FilterDraft): FilterEntry[] {
  return entries.map(entry => {
    if (entry.kind === "field") {
      const control = draft[entry.field.id]
      return control ? { kind: "field", field: { ...entry.field, control } } : entry
    }
    if (entry.kind === "group") return { ...entry, entries: applyDraft(entry.entries, draft) }
    return entry
  })
}
