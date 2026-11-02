// 漫畫源的檢查更新：已安裝的源跟「自己的來源倉庫」的索引快取比版本。
//
// 可更新清單不另存：每次都由 repositories.json 的索引快取 × 已安裝版本算出來，
// 源或倉庫一有變動就作廢重算。檢查＝重抓相關倉庫的索引（24 小時 TTL），只提示不自動裝。
// 手動加入的源（origin 為 null）沒有可比對的索引；沒有 Pro 時 Aidoku 源整個略過。

import { createEmitter } from "../engine/emitter"
import { log } from "../engine/log"
import { hasPro } from "../engine/pro"
import { compareVersion, type CatalogEntry } from "../sources/catalog"
import {
  allSources,
  installRepositoryEntry,
  refreshRepository,
  sourceKindOf,
  subscribeSources,
  type InstallResult,
  type InstalledSource,
} from "../sources/registry"
import { listRepositories, subscribeRepositories, type StoredRepository } from "../sources/repository"
import { offline } from "./updates"

/** 倉庫索引多久重抓一次。 */
export const SOURCE_CHECK_TTL = 24 * 60 * 60 * 1000

export interface SourceUpdate {
  source: InstalledSource
  repository: StoredRepository
  entry: CatalogEntry
  /** 已安裝的版本。 */
  from: string
  /** 倉庫裡的版本。 */
  to: string
}

/** 來源倉庫的比對鍵：忽略前後空白、結尾斜線與大小寫。 */
export function repositoryKey(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase()
}

function installedVersion(source: InstalledSource): string {
  return source.meta?.version ?? source.stored.version
}

/** 參與檢查的源：有來源倉庫，且（沒 Pro 時）不是 Aidoku 源。 */
function trackedSources(pro: boolean): InstalledSource[] {
  return allSources().filter(source => {
    if (!source.stored.origin) return false
    return pro || sourceKindOf(source) !== "aidoku"
  })
}

// ---------------------------------------------------------------- 可更新清單

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

/** 可更新清單有變動時通知（源或倉庫變了）。 */
export const subscribeSourceUpdates = bus.subscribe

/** 可更新的源，依已安裝清單的順序。`pro` 只給探針注入。 */
export function availableSourceUpdates(pro: boolean = hasPro()): SourceUpdate[] {
  if (cache && cache.pro === pro) return cache.updates
  const repositories = new Map(listRepositories().map(repository => [repositoryKey(repository.url), repository]))
  const updates: SourceUpdate[] = []
  for (const source of trackedSources(pro)) {
    const repository = repositories.get(repositoryKey(source.stored.origin!))
    if (!repository) continue
    // 同一倉庫裡同 key 有多筆時以第一筆為準（跟 installRepositoryEntry 一致）。
    const entry = repository.entries.find(item => item.key === source.stored.key)
    if (!entry) continue
    const from = installedVersion(source)
    if (!from || compareVersion(entry.version, from) <= 0) continue
    updates.push({ source, repository, entry, from, to: entry.version })
  }
  cache = { pro, updates }
  return updates
}

export function sourceUpdateCount(): number {
  return availableSourceUpdates().length
}

// ---------------------------------------------------------------- 檢查

export interface SourceCheckResult {
  /** 這次實際重抓的倉庫數。 */
  checked: number
  failed: { repository: StoredRepository; message: string }[]
  /** 沒有連線，整批略過。 */
  offline: boolean
}

let inFlight: Promise<SourceCheckResult> | null = null

export interface SourceCheckOptions {
  /** 無視 TTL（手動檢查）。 */
  force?: boolean
  now?: number
  pro?: boolean
  /** 只查這些倉庫（探針靠這個不碰真倉庫）；不給就是全部。 */
  repositories?: string[]
}

/**
 * 重抓「有已安裝源指向它」的倉庫索引。失敗的原因由 refreshRepository 寫進倉庫，
 * 舊快取留著。同時只跑一輪。
 */
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

// ---------------------------------------------------------------- 更新

/** 從來源倉庫更新單一源。 */
export function updateSource(update: SourceUpdate): Promise<InstallResult> {
  return installRepositoryEntry(update.repository.url, update.entry.key)
}

/**
 * 依序更新（Aidoku 安裝會重置宿主，平行跑會互相踩到）。中途失敗不中斷；
 * 回傳失敗的 key → 原因。`onStart` 讓畫面標出正在跑的那一列。
 */
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
