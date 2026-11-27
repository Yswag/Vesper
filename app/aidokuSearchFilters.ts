import { appDataRoot, join, readText, writeText } from "../engine/fs"
import * as aidoku from "../sources/aidoku"
import {
  defaultFilterValues,
  decodeFilters,
  manifestFilterRows,
  runtimeFilterRows,
  type AidokuFilterRow,
  type AidokuFilterValue,
} from "../sources/aidokuFilters"
import type { InstalledSource } from "../sources/registry"

type Stored = Record<string, unknown[]>

function storePath(): string {
  return join(appDataRoot(), "aidoku-search-filters.json")
}

function loadAll(): Stored {
  const raw = readText(storePath())
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const out: Stored = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(value)) out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

const rowsCache = new Map<string, AidokuFilterRow[]>()

export async function aidokuFilterRows(source: InstalledSource): Promise<AidokuFilterRow[]> {
  const cached = rowsCache.get(source.stored.key)
  if (cached) return cached

  const declared = manifestFilterRows(aidoku.filterDefsOf(source.stored.key))
  const rows = declared.length > 0 ? declared : runtimeFilterRows(await aidoku.runtimeFilterDefs(source))
  rowsCache.set(source.stored.key, rows)
  return rows
}

export function loadFilterValues(sourceKey: string, rows: AidokuFilterRow[]): AidokuFilterValue[] {
  return decodeFilters(rows, loadAll()[sourceKey])
}

export function saveFilterValues(sourceKey: string, rows: AidokuFilterRow[], values: AidokuFilterValue[]): void {
  const all = loadAll()
  all[sourceKey] = values
  writeText(storePath(), JSON.stringify(all, null, 2))
}
