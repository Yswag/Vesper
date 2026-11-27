import type { AbortSignal } from "scripting"

import { sourceWorkerLimit } from "../engine/sourcehost/host"
import { isAbortError } from "../engine/http"
import { log } from "../engine/log"

import * as mihon from "./mihon"
import { searchSource, toListItems, type SourceScope } from "./operations"
import type { InstalledSource } from "./registry"
import type { ComicListItem } from "../engine/adapt"

export interface SourceSearchResult {
  key: string
  name: string
  comics: ComicListItem[]
  error?: string
  ms: number
}

export interface SearchProgress {
  results: SourceSearchResult[]
  done: number
  total: number
}

const CONCURRENCY = 6

export function nextSearchSourceIndex(
  hosted: readonly boolean[],
  activeHosted: number,
  limit: number,
  groups?: readonly (string | undefined)[],
  activeGroups?: ReadonlySet<string>
): number {
  for (let index = 0; index < hosted.length; index++) {
    if (hosted[index] && activeHosted >= limit) continue
    const group = groups?.[index]
    if (group !== undefined && activeGroups?.has(group) === true) continue
    return index
  }
  return -1
}

export async function searchOne(
  source: InstalledSource,
  keyword: string,
  options: Array<string | null> = [],
  scope?: SourceScope
): Promise<SourceSearchResult> {
  const started = Date.now()
  const name = source.meta?.name ?? source.stored.name
  try {
    const page = await searchSource(source, keyword, { options, filters: scope?.filters }, scope)
    return { key: source.stored.key, name, comics: toListItems(source, page), ms: Date.now() - started }
  } catch (error) {
    if (isAbortError(error)) throw error
    return {
      key: source.stored.key,
      name,
      comics: [],
      error: error instanceof Error ? error.message : String(error),
      ms: Date.now() - started,
    }
  }
}

export async function searchAll(
  sources: InstalledSource[],
  keyword: string,
  optionsOf: (source: InstalledSource) => Array<string | null>,
  onProgress: (progress: SearchProgress) => void,
  signal?: AbortSignal
): Promise<SourceSearchResult[]> {
  const results: SourceSearchResult[] = []
  const pending = sources.slice()
  const hostedPending: boolean[] = pending.map(source => source.stored.kind !== "venera")
  const groupPending: Array<string | undefined> = pending.map(source =>
    mihon.isMihon(source) ? mihon.packageKeyOf(source.stored.key) : undefined
  )
  const limit = sourceWorkerLimit()
  const activeGroups = new Set<string>()
  let active = 0
  let activeHosted = 0
  let done = 0
  let halted: unknown = null
  let wake: (() => void) | null = null

  const report = () => onProgress({ results: [...results], done, total: sources.length })

  let failRun: (error: unknown) => void = () => {}
  const failed = new Promise<never>((_, reject) => {
    failRun = reject
  })
  failed.catch(() => {})

  const fill = (): void => {
    while (active < CONCURRENCY) {
      const index = nextSearchSourceIndex(hostedPending, activeHosted, limit, groupPending, activeGroups)
      if (index < 0) return
      const [source] = pending.splice(index, 1)
      const hosted = hostedPending.splice(index, 1)[0]
      const group = groupPending.splice(index, 1)[0]
      active += 1
      if (hosted) activeHosted += 1
      if (group !== undefined) activeGroups.add(group)
      searchOne(source, keyword, optionsOf(source), { signal })
        .then(
          result => {
            results.push(result)
            done += 1
            report()
          },
          error => {
            if (halted !== null) return
            halted = error
            failRun(error)
          }
        )
        .then(() => {
          active -= 1
          if (hosted) activeHosted -= 1
          if (group !== undefined) activeGroups.delete(group)
          const resume = wake
          wake = null
          resume?.()
        })
    }
  }

  const started = Date.now()
  const work = (async (): Promise<SourceSearchResult[]> => {
    while (pending.length > 0 || active > 0) {
      if (halted !== null || signal?.aborted) pending.length = 0
      else fill()
      if (active === 0) break
      await new Promise<void>(resolve => {
        wake = resolve
      })
    }
    return results
  })()

  const outcome = await Promise.race([work, failed])
  log("info", "search", `「${keyword}」跨 ${sources.length} 源完成，共 ${outcome.reduce((n, r) => n + r.comics.length, 0)} 筆 (${Date.now() - started}ms)`)
  return outcome
}
