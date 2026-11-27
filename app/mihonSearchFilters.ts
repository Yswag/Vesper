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

export async function mihonFilterNodes(source: InstalledSource): Promise<MihonFilterNode[]> {
  const nodes = filterNodes(await mihon.filterDefs(source))
  return hasEditable(nodes) ? nodes : []
}

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
