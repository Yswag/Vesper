export type MihonFilterKind = "header" | "separator" | "text" | "select" | "checkbox" | "tristate" | "group" | "sort"

export type MihonFilterValue = string | number | boolean | { index: number; ascending: boolean } | null

export type MihonFilterValues = Record<string, MihonFilterValue>

export interface MihonFilterNode {
  id: string
  kind: MihonFilterKind
  name: string
  options: string[]
  initial: MihonFilterValue
  children: MihonFilterNode[]
}

export interface MihonFilterState {
  name: string
  state: unknown
  children?: MihonFilterState[]
}

const KINDS: readonly MihonFilterKind[] = [
  "header",
  "separator",
  "text",
  "select",
  "checkbox",
  "tristate",
  "group",
  "sort",
]

const EDITABLE: ReadonlySet<MihonFilterKind> = new Set<MihonFilterKind>(["text", "select", "checkbox", "tristate", "sort"])

function kindOf(raw: unknown): MihonFilterKind {
  return KINDS.includes(raw as MihonFilterKind) ? (raw as MihonFilterKind) : "separator"
}

function stringsOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(item => String(item ?? "")) : []
}

function indexOf(raw: unknown, length: number): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) return null
  if (length > 0 && raw >= length) return null
  return raw
}

function sortOf(raw: unknown, length: number): { index: number; ascending: boolean } | null {
  if (!raw || typeof raw !== "object") return null
  const sort = raw as { index?: unknown; ascending?: unknown }
  const index = indexOf(sort.index, length)
  if (index === null) return null
  return { index, ascending: sort.ascending === true }
}

function tristateOf(raw: unknown): 0 | 1 | 2 {
  return raw === 1 || raw === 2 ? raw : 0
}

function initialOf(kind: MihonFilterKind, raw: unknown, options: string[]): MihonFilterValue {
  switch (kind) {
    case "text":
      return typeof raw === "string" ? raw : ""
    case "select":
      return indexOf(raw, options.length) ?? 0
    case "checkbox":
      return raw === true
    case "tristate":
      return tristateOf(raw)
    case "sort":
      return sortOf(raw, options.length)
    default:
      return raw && typeof raw === "object" ? null : ((raw ?? null) as MihonFilterValue)
  }
}

export function filterNodes(raw: unknown, prefix = ""): MihonFilterNode[] {
  const list = Array.isArray(raw) ? raw : []
  return list.map((item, index) => {
    const def = (item ?? {}) as Record<string, unknown>
    const id = prefix ? `${prefix}.${index}` : String(index)
    const kind = kindOf(def.kind)
    const options = stringsOf(def.options)
    const children = kind === "group" ? filterNodes(def.children, id) : []
    return {
      id,
      kind,
      name: typeof def.name === "string" ? def.name : "",
      options,
      initial: initialOf(kind, def.state, options),
      children,
    }
  })
}

export function filterNodeList(nodes: MihonFilterNode[]): MihonFilterNode[] {
  const out: MihonFilterNode[] = []
  for (const node of nodes) {
    out.push(node)
    out.push(...filterNodeList(node.children))
  }
  return out
}

function valueOf(node: MihonFilterNode, values: MihonFilterValues): MihonFilterValue {
  return Object.prototype.hasOwnProperty.call(values, node.id) ? values[node.id] : node.initial
}

export function defaultValues(nodes: MihonFilterNode[]): MihonFilterValues {
  const out: MihonFilterValues = {}
  for (const node of filterNodeList(nodes)) {
    if (EDITABLE.has(node.kind)) out[node.id] = node.initial
  }
  return out
}

function sameValue(a: MihonFilterValue, b: MihonFilterValue): boolean {
  if (a && b && typeof a === "object" && typeof b === "object") {
    return a.index === b.index && a.ascending === b.ascending
  }
  return a === b
}

export function hasEditable(nodes: MihonFilterNode[]): boolean {
  return filterNodeList(nodes).some(node => EDITABLE.has(node.kind))
}

export function countChanged(nodes: MihonFilterNode[], values: MihonFilterValues): number {
  let count = 0
  for (const node of filterNodeList(nodes)) {
    if (!EDITABLE.has(node.kind)) continue
    if (!sameValue(valueOf(node, values), node.initial)) count += 1
  }
  return count
}

export function signatureOf(nodes: MihonFilterNode[]): string {
  return filterNodeList(nodes)
    .map(node => `${node.kind}:${node.name}`)
    .join("\n")
}

export function decodeValues(nodes: MihonFilterNode[], stored: unknown): MihonFilterValues {
  const record = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {}
  const out: MihonFilterValues = {}
  for (const node of filterNodeList(nodes)) {
    if (!EDITABLE.has(node.kind)) continue
    out[node.id] = decodeValue(node, record[node.id])
  }
  return out
}

function decodeValue(node: MihonFilterNode, raw: unknown): MihonFilterValue {
  switch (node.kind) {
    case "text":
      return typeof raw === "string" ? raw : node.initial
    case "select":
      return indexOf(raw, node.options.length) ?? node.initial
    case "checkbox":
      return typeof raw === "boolean" ? raw : node.initial
    case "tristate":
      return raw === 0 || raw === 1 || raw === 2 ? raw : node.initial
    case "sort": {
      if (raw === null) return null
      return sortOf(raw, node.options.length) ?? node.initial
    }
    default:
      return node.initial
  }
}

export function encodeFilters(nodes: MihonFilterNode[], values: MihonFilterValues): MihonFilterState[] {
  return nodes.map(node => {
    const state = { name: node.name, state: valueOf(node, values) } as MihonFilterState
    if (node.kind === "group") state.children = encodeFilters(node.children, values)
    return state
  })
}
