// Mihon 源的搜尋篩選：把 `filters` 的定義、使用者存的值與 UI 狀態接起來。
//
// 值存成 `{ "<sourceKey>": { signature, values } }`，跟 `aidoku-search-filters.json` 同一個目錄。
// `signature` 是定義的指紋：擴充更新後多一個、少一個、改名或改 kind 都會變，那一份值就整份作廢，
// 回到 `filters` 給的預設（位置與名稱都對不上了）。單項對不上（例如選項變少）另外在解碼時退回預設。

import { appDataRoot, join, readText, writeText } from "../engine/fs"
import * as mihon from "../sources/mihon"
import {
  decodeValues,
  defaultValues,
  hasEditable,
  filterNodes,
  signatureOf,
  type MihonFilterNode,
  type MihonFilterValues,
} from "../sources/mihonFilters"
import type { InstalledSource } from "../sources/registry"

interface StoredEntry {
  signature: string
  values: MihonFilterValues
}

type Stored = Record<string, StoredEntry>

function storePath(): string {
  return join(appDataRoot(), "mihon-search-filters.json")
}

function loadAll(): Stored {
  const raw = readText(storePath())
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const out: Stored = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = value as Partial<StoredEntry> | null
      if (entry && typeof entry.signature === "string" && entry.values && typeof entry.values === "object") {
        out[key] = { signature: entry.signature, values: entry.values as MihonFilterValues }
      }
    }
    return out
  } catch {
    return {}
  }
}

/** 這個子源的篩選定義（`mihon.filterDefs` 自己會快取，這裡只負責翻成節點）；沒有可改的項就回空陣列。 */
export async function mihonFilterNodes(source: InstalledSource): Promise<MihonFilterNode[]> {
  const nodes = filterNodes(await mihon.filterDefs(source))
  return hasEditable(nodes) ? nodes : []
}

/** 使用者存的值；沒存過或定義變了就是預設值。 */
export function loadMihonValues(sourceKey: string, nodes: MihonFilterNode[]): MihonFilterValues {
  const entry = loadAll()[sourceKey]
  if (!entry || entry.signature !== signatureOf(nodes)) return defaultValues(nodes)
  return decodeValues(nodes, entry.values)
}

export function saveMihonValues(sourceKey: string, nodes: MihonFilterNode[], values: MihonFilterValues): void {
  const all = loadAll()
  all[sourceKey] = { signature: signatureOf(nodes), values }
  writeText(storePath(), JSON.stringify(all, null, 2))
}
