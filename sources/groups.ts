import { appDataRoot, ensureDir, hasFileAccess, join, readText, writeText } from "../engine/fs"
import { kv } from "../engine/storage"

import * as mihon from "./mihon"
import type { InstalledSource, SourceKind } from "./registry"

export interface SourceGroup {
  id: string
  kind: SourceKind
  name: string
  version: string
  iconUrl?: string
  origin: string | null
  sources: InstalledSource[]
  enabledCount: number
  total: number
  disabled: boolean
  error?: string
  updateKey: string
}

const ORDER_VERSION = 1
const KV_KEY = "venera:sourceOrder"

function orderPath(): string {
  return join(appDataRoot(), "sources", "order.json")
}

export function groupIdOf(key: string): string {
  return mihon.isMihonKey(key) ? mihon.packageKeyOf(key) : key
}

function readOrder(): string[] {
  const raw = hasFileAccess() ? readText(orderPath()) : null
  const parsed = raw === null ? kv.get(KV_KEY) : parseOrder(raw)
  if (!Array.isArray(parsed)) return []
  return parsed.filter((value): value is string => typeof value === "string" && value.length > 0)
}

function parseOrder(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw)
    return parsed && Array.isArray(parsed.order) ? parsed.order : null
  } catch {
    return null
  }
}

function writeOrder(ids: string[]): void {
  if (hasFileAccess()) {
    ensureDir(orderPath().replace(/\/[^/]*$/, ""))
    writeText(orderPath(), JSON.stringify({ version: ORDER_VERSION, order: ids }, null, 2))
  } else {
    kv.set(KV_KEY, ids)
  }
}

function extensionNameOf(sources: InstalledSource[]): string {
  const first = sources[0]
  const name = first.meta?.name ?? first.stored.name
  const language = first.language
  const suffix = language ? ` (${language})` : ""
  return suffix && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name
}

export function groupSources(sources: InstalledSource[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>()
  for (const source of sources) {
    const id = groupIdOf(source.stored.key)
    const existing = groups.get(id)
    if (existing) {
      existing.sources.push(source)
      if (source.enabled) existing.enabledCount += 1
      existing.total += 1
      if (!existing.error && source.error) existing.error = source.error
      continue
    }
    const kind = source.stored.kind ?? "venera"
    groups.set(id, {
      id,
      kind,
      name: kind === "mihon" ? extensionNameOf([source]) : (source.meta?.name ?? source.stored.name),
      version: source.meta?.version ?? source.stored.version,
      iconUrl: source.stored.iconUrl,
      origin: source.stored.origin,
      sources: [source],
      enabledCount: source.enabled ? 1 : 0,
      total: 1,
      disabled: !source.enabled,
      error: source.error,
      updateKey: id,
    })
  }
  const list = [...groups.values()]
  for (const group of list) {
    group.disabled = group.sources.every(source => source.manualDisabled ?? !source.enabled)
    if (group.kind === "mihon") group.name = extensionNameOf(group.sources)
  }
  return list
}

function orderedIds(groups: Array<{ id: string }>): string[] {
  const known = new Set(groups.map(group => group.id))
  const out: string[] = []
  for (const raw of readOrder()) {
    const id = groupIdOf(raw)
    if (!known.has(id) || out.includes(id)) continue
    out.push(id)
  }
  for (const group of groups) if (!out.includes(group.id)) out.push(group.id)
  return out
}

export function orderGroups<T extends { id: string }>(groups: T[]): T[] {
  const byId = new Map(groups.map(group => [group.id, group]))
  const ordered: T[] = []
  for (const id of orderedIds(groups)) {
    const group = byId.get(id)
    if (group) ordered.push(group)
  }
  return ordered
}

export function sourceGroups(sources: InstalledSource[]): SourceGroup[] {
  return orderGroups(groupSources(sources))
}

export function applyGroupOrder(sources: InstalledSource[]): InstalledSource[] {
  const groups = orderGroups(groupSources(sources))
  return groups.flatMap(group => group.sources)
}

export function reorderSourceGroups(sources: InstalledSource[], ids: string[]): boolean {
  const groups = groupSources(sources)
  const known = new Set(groups.map(group => group.id))
  const next: string[] = []
  for (const raw of ids) {
    const id = groupIdOf(raw)
    if (!known.has(id) || next.includes(id)) continue
    next.push(id)
  }
  for (const group of groups) if (!next.includes(group.id)) next.push(group.id)
  const current = orderedIds(groups)
  if (next.length === current.length && next.every((id, index) => id === current[index])) return false
  writeOrder(next)
  return true
}
