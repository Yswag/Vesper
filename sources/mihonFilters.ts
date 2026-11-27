// Mihon（keiyoushi）擴充的搜尋篩選：定義、預設值、編碼。
//
// `filters` op 回的是一棵樹，八種 kind：header／separator／text／select／checkbox／tristate／
// group／sort。這裡把它收成帶路徑 id 的節點（`0`、`5.2`），值也用同一組 id 認——群組會巢狀，
// 陣列位置認不了一層以下的東西。
//
// 送出時**一律整份、照定義順序**（含 header 與 separator）：dexvm 數量對得上就照順序套回擴充
// 自己的 `getFilterList()`，對不上才退成照名字找。只送改過的會讓數量對不上，順序就沒了。

export type MihonFilterKind = "header" | "separator" | "text" | "select" | "checkbox" | "tristate" | "group" | "sort"

/** 一個節點的值；`null` 只有 sort 用（源沒有預設排序）。 */
export type MihonFilterValue = string | number | boolean | { index: number; ascending: boolean } | null

/** 值只收得住有值可改的節點（text／select／checkbox／tristate／sort），群組的 id 不在裡面。 */
export type MihonFilterValues = Record<string, MihonFilterValue>

export interface MihonFilterNode {
  /** 在定義裡的位置：`3`、`3.1`。 */
  id: string
  kind: MihonFilterKind
  name: string
  options: string[]
  /** 源給的預設值；header／separator／group 是 dexvm 原樣帶回來的 state，原樣送回。 */
  initial: MihonFilterValue
  children: MihonFilterNode[]
}

/** `search.filters` 的一項。 */
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

/** select／sort 的索引；超出範圍或不是數字就回 `null` 讓呼叫端退回預設。 */
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
      // header／separator／group：dexvm 給什麼就送什麼。
      return raw && typeof raw === "object" ? null : ((raw ?? null) as MihonFilterValue)
  }
}

/** `filters` op 的原始陣列 → 節點樹（id 是位置路徑）。 */
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

/** 有哪些節點是真的可以改的（只有 header／separator 的源沒有篩選可用）。 */
export function hasEditable(nodes: MihonFilterNode[]): boolean {
  return filterNodeList(nodes).some(node => EDITABLE.has(node.kind))
}

/** 跟預設不同的項數（膠囊列最前面那個數字）。 */
export function countChanged(nodes: MihonFilterNode[], values: MihonFilterValues): number {
  let count = 0
  for (const node of filterNodeList(nodes)) {
    if (!EDITABLE.has(node.kind)) continue
    if (!sameValue(valueOf(node, values), node.initial)) count += 1
  }
  return count
}

/**
 * 定義的指紋：`kind:name` 逐節點排成一行。擴充更新後多一個、少一個、改名或改 kind 都會變，
 * 存下來的值就作廢（位置與名稱都對不上了）。
 */
export function signatureOf(nodes: MihonFilterNode[]): string {
  return filterNodeList(nodes)
    .map(node => `${node.kind}:${node.name}`)
    .join("\n")
}

/** 存下來的值 → 現在的定義；對不上的單項退回預設。 */
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

/** 整份 `search.filters`（含 header 與 separator，照定義順序）。 */
export function encodeFilters(nodes: MihonFilterNode[], values: MihonFilterValues): MihonFilterState[] {
  return nodes.map(node => {
    const state = { name: node.name, state: valueOf(node, values) } as MihonFilterState
    if (node.kind === "group") state.children = encodeFilters(node.children, values)
    return state
  })
}
