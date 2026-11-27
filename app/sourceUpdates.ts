import { createEmitter } from "../engine/emitter"
import { log } from "../engine/log"
import { hasPro } from "../engine/pro"
import { compareVersion, type CatalogEntry } from "../sources/catalog"
import { packageKeyOf, isMihonKey } from "../sources/mihon"
import {
  allSources,
  installRepositoryEntry,
  refreshRepository,
  sourceKindOf,
  sourceNeedsPro,
  subscribeSources,
  type InstallResult,
  type InstalledSource,
} from "../sources/registry"
import { listRepositories, repositoryKey, subscribeRepositories, type StoredRepository } from "../sources/repository"
import { offline } from "./updates"

export const SOURCE_CHECK_TTL = 24 * 60 * 60 * 1000

export interface SourceUpdate {
  source: InstalledSource
  repository: StoredRepository
  entry: CatalogEntry
  from: string
  to: string
}

function installedVersion(source: InstalledSource): string {
  return source.meta?.version ?? source.stored.version
}

function trackedSources(pro: boolean): InstalledSource[] {
  return allSources().filter(source => {
    if (!source.stored.origin) return false
    return pro || !sourceNeedsPro(sourceKindOf(source))
  })
}

function entryFor(source: InstalledSource, entries: CatalogEntry[]): CatalogEntry | undefined {
  const key = isMihonKey(source.stored.key) ? packageKeyOf(source.stored.key) : source.stored.key
  return entries.find(item => item.key === key)
}


const bus = createEmitter({
  onListenerError: error => log("error", "sources", "源更新訂閱者拋錯", error),
})

let cache: { pro: boolean; updates: SourceUpdate[] } | null = null

function invalidate() {
  cache = null
  bus.emit()
}

subscribeSources(invalidate)
subscribeRepositories(invalidate)

export const subscribeSourceUpdates = bus.subscribe

export function availableSourceUpdates(pro: boolean = hasPro()): SourceUpdate[] {
  if (cache && cache.pro === pro) return cache.updates
  const repositories = new Map(listRepositories().map(repository => [repositoryKey(repository.url), repository]))
  const updates: SourceUpdate[] = []
  const reported = new Set<string>()
  for (const source of trackedSources(pro)) {
    const repository = repositories.get(repositoryKey(source.stored.origin!))
    if (!repository) continue
    const entry = entryFor(source, repository.entries)
    if (!entry) continue
    const extensionKey = isMihonKey(entry.key) ? entry.key : source.stored.key
    if (reported.has(extensionKey)) continue
    const from = installedVersion(source)
    if (!from || compareVersion(entry.version, from) <= 0) continue
    reported.add(extensionKey)
    updates.push({ source, repository, entry, from, to: entry.version })
  }
  cache = { pro, updates }
  return updates
}

export function sourceUpdateCount(): number {
  return availableSourceUpdates().length
}


export interface SourceCheckResult {
  checked: number
  failed: { repository: StoredRepository; message: string }[]
  offline: boolean
}

let inFlight: Promise<SourceCheckResult> | null = null

export interface SourceCheckOptions {
  force?: boolean
  now?: number
  pro?: boolean
  repositories?: string[]
}

export function checkSourceUpdates(options: SourceCheckOptions = {}): Promise<SourceCheckResult> {
  if (inFlight) return inFlight
  inFlight = runCheck(options).finally(() => {
    inFlight = null
  })
  return inFlight
}

async function runCheck({ force = false, now = Date.now(), pro = hasPro(), repositories }: SourceCheckOptions): Promise<SourceCheckResult> {
  const origins = new Set(trackedSources(pro).map(source => repositoryKey(source.stored.origin!)))
  const scope = repositories ? new Set(repositories.map(repositoryKey)) : null
  const targets = listRepositories().filter(repository => {
    const key = repositoryKey(repository.url)
    if (!origins.has(key) || (scope && !scope.has(key))) return false
    return force || now - repository.fetchedAt >= SOURCE_CHECK_TTL
  })
  if (targets.length === 0) return { checked: 0, failed: [], offline: false }
  if (await offline()) return { checked: 0, failed: [], offline: true }

  const results = await Promise.allSettled(targets.map(repository => refreshRepository(repository.url)))
  const failed = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [{ repository: targets[index], message: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
      : []
  )
  log("info", "sources", `檢查源更新：${targets.length} 個倉庫，${failed.length} 個失敗，${availableSourceUpdates(pro).length} 個可更新`)
  return { checked: targets.length, failed, offline: false }
}


export function updateSource(update: SourceUpdate): Promise<InstallResult> {
  return installRepositoryEntry(update.repository.url, update.entry.key)
}

export async function updateSources(
  updates: SourceUpdate[],
  onStart?: (key: string) => void,
): Promise<Map<string, string>> {
  const failed = new Map<string, string>()
  for (const update of updates) {
    const key = update.source.stored.key
    onStart?.(key)
    try {
      await updateSource(update)
    } catch (error) {
      failed.set(key, error instanceof Error ? error.message : String(error))
    }
  }
  return failed
}
