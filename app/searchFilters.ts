import { loadFilterValues, saveFilterValues, aidokuFilterRows } from "./aidokuSearchFilters"
import { loadMihonValues, mihonFilterNodes, saveMihonValues } from "./mihonSearchFilters"
import { defaultFilterValue, encodeFilters as encodeAidoku, type AidokuFilterRow, type AidokuFilterValue } from "../sources/aidokuFilters"
import { encodeFilters as encodeMihon, type MihonFilterNode, type MihonFilterValues } from "../sources/mihonFilters"
import type { InstalledSource } from "../sources/registry"
import type { FilterControl, FilterDraft, FilterEntry, FilterToken, Tristate } from "../design/filterEntries"

export type SearchFilterSet =
  | { kind: "aidoku"; sourceKey: string; rows: AidokuFilterRow[]; values: AidokuFilterValue[] }
  | { kind: "mihon"; sourceKey: string; nodes: MihonFilterNode[]; values: MihonFilterValues }

export async function loadSearchFilters(source: InstalledSource): Promise<SearchFilterSet | null> {
  const sourceKey = source.stored.key
  if (source.stored.kind === "aidoku") {
    const rows = await aidokuFilterRows(source)
    if (rows.length === 0) return null
    return { kind: "aidoku", sourceKey, rows, values: loadFilterValues(sourceKey, rows) }
  }
  if (source.stored.kind === "mihon") {
    const nodes = await mihonFilterNodes(source)
    if (nodes.length === 0) return null
    return { kind: "mihon", sourceKey, nodes, values: loadMihonValues(sourceKey, nodes) }
  }
  return null
}

export function filterPayload(set: SearchFilterSet): unknown[] {
  if (set.kind === "aidoku") return aidokuPayload(set.rows, set.values)
  return encodeMihon(set.nodes, set.values)
}

export function filterEntries(set: SearchFilterSet): FilterEntry[] {
  return set.kind === "aidoku" ? aidokuEntries(set.rows, set.values) : mihonEntries(set.nodes, set.values)
}

export function applyFilterDraft(set: SearchFilterSet, draft: FilterDraft): SearchFilterSet {
  if (set.kind === "aidoku") {
    const values = aidokuValues(set.rows, set.values, draft)
    saveFilterValues(set.sourceKey, set.rows, values)
    return { ...set, values }
  }
  const values = mihonValues(set.nodes, set.values, draft)
  saveMihonValues(set.sourceKey, set.nodes, values)
  return { ...set, values }
}


function aidokuPayload(rows: AidokuFilterRow[], values: AidokuFilterValue[]): unknown[] {
  return encodeAidoku(rows, values)
}

function aidokuIndex(row: AidokuFilterRow, value: string): number {
  const at = row.kind === "select" ? row.options.findIndex(option => option.value === value) : -1
  return at >= 0 ? at : 0
}

function aidokuTokens(row: AidokuFilterRow, value: AidokuFilterValue): FilterToken[] {
  const picked =
    typeof value === "object" && value !== null && "included" in value
      ? value
      : { included: [] as string[], excluded: [] as string[] }
  return row.kind === "multi"
    ? row.options.map(option => ({
        label: option.label,
        value: option.value,
        state: (picked.included.includes(option.value)
          ? 1
          : picked.excluded.includes(option.value)
            ? 2
            : 0) as Tristate,
      }))
    : []
}

function aidokuControl(row: AidokuFilterRow, value: AidokuFilterValue): FilterControl {
  switch (row.kind) {
    case "text":
      return { kind: "text", value: typeof value === "string" ? value : "", icon: row.author ? "person" : "magnifyingglass", prompt: row.label }
    case "select":
      return { kind: "select", value: aidokuIndex(row, typeof value === "string" ? value : ""), options: row.options.map(option => option.label) }
    case "multi":
      return { kind: "tokens", tokens: aidokuTokens(row, value), canExclude: row.canExclude }
    case "sort": {
      const sort = typeof value === "object" && value !== null && "index" in value ? value : { index: 0, ascending: false }
      return { kind: "sort", index: sort.index, ascending: sort.ascending, options: row.options, canAscend: row.canAscend }
    }
    case "check":
      return { kind: "check", value: value === true }
  }
}

function aidokuEntries(rows: AidokuFilterRow[], values: AidokuFilterValue[]): FilterEntry[] {
  return rows.map((row, index) => ({
    kind: "field",
    field: {
      id: String(index),
      label: row.label,
      control: aidokuControl(row, values[index] ?? defaultFilterValue(row)),
      initial: aidokuControl(row, defaultFilterValue(row)),
    },
  }))
}

function aidokuValues(rows: AidokuFilterRow[], values: AidokuFilterValue[], draft: FilterDraft): AidokuFilterValue[] {
  return rows.map((row, index) => {
    const control = draft[String(index)]
    const value = values[index] ?? defaultFilterValue(row)
    if (!control) return value
    switch (control.kind) {
      case "text":
        return control.value
      case "select":
        return row.kind === "select" ? (row.options[control.value]?.value ?? defaultFilterValue(row)) : value
      case "tokens": {
        if (row.kind !== "multi") return value
        const included: string[] = []
        const excluded: string[] = []
        for (const token of control.tokens) {
          if (token.state === 1) included.push(token.value)
          else if (token.state === 2 && control.canExclude) excluded.push(token.value)
        }
        return { included, excluded }
      }
      case "sort":
        return { index: control.index, ascending: control.ascending }
      case "check":
        return control.value
      default:
        return value
    }
  })
}


function tristateOf(raw: unknown): Tristate {
  return raw === 1 || raw === 2 ? raw : 0
}

function mihonControl(node: MihonFilterNode, value: unknown): FilterControl | null {
  switch (node.kind) {
    case "text":
      return { kind: "text", value: typeof value === "string" ? value : "", icon: "text.alignleft", prompt: node.name }
    case "select":
      return { kind: "select", value: typeof value === "number" ? value : 0, options: node.options }
    case "checkbox":
      return { kind: "check", value: value === true }
    case "tristate":
      return { kind: "tristate", value: tristateOf(value) }
    case "sort": {
      const sort =
        value && typeof value === "object" && "index" in value
          ? (value as { index: number; ascending: boolean })
          : { index: 0, ascending: false }
      return { kind: "sort", index: sort.index, ascending: sort.ascending, options: node.options, canAscend: true }
    }
    default:
      return null
  }
}

function mihonEntries(nodes: MihonFilterNode[], values: MihonFilterValues): FilterEntry[] {
  const out: FilterEntry[] = []
  for (const node of nodes) {
    if (node.kind === "group") {
      out.push({ kind: "group", id: node.id, label: node.name, entries: mihonEntries(node.children, values) })
      continue
    }
    if (node.kind === "header") {
      out.push({ kind: "header", id: node.id, label: node.name })
      continue
    }
    const control = mihonControl(node, values[node.id])
    const initial = mihonControl(node, node.initial)
    if (!control || !initial) {
      out.push({ kind: "separator", id: node.id })
      continue
    }
    out.push({ kind: "field", field: { id: node.id, label: node.name, control, initial } })
  }
  return out
}

function mihonValues(nodes: MihonFilterNode[], values: MihonFilterValues, draft: FilterDraft): MihonFilterValues {
  const next: MihonFilterValues = { ...values }

  const apply = (list: MihonFilterNode[]): void => {
    for (const node of list) {
      if (node.kind === "group") {
        apply(node.children)
        continue
      }
      const control = draft[node.id]
      if (!control) continue
      switch (control.kind) {
        case "text":
          next[node.id] = control.value
          break
        case "select":
          next[node.id] = control.value
          break
        case "check":
          next[node.id] = control.value
          break
        case "tristate":
          next[node.id] = control.value
          break
        case "sort":
          next[node.id] = { index: control.index, ascending: control.ascending }
          break
        default:
          break
      }
    }
  }

  apply(nodes)
  return next
}
