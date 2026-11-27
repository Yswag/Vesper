export type Tristate = 0 | 1 | 2

export interface FilterToken {
  label: string
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
  | { kind: "group"; id: string; label: string; entries: FilterEntry[] }

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

export function changedCount(entries: FilterEntry[]): number {
  return fieldsOf(entries).filter(isChanged).length
}

export function draftOf(entries: FilterEntry[]): FilterDraft {
  const draft: FilterDraft = {}
  for (const field of fieldsOf(entries)) draft[field.id] = field.control
  return draft
}

export function resetDraft(entries: FilterEntry[]): FilterDraft {
  const draft: FilterDraft = {}
  for (const field of fieldsOf(entries)) draft[field.id] = field.initial
  return draft
}

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
