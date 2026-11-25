// 跨來源聚合搜尋模組：依來源分組呈現結果，每源完成即時推送進度。
// 支援透過 AbortSignal 中止連線與取消佇列調度。

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

/** 30+ 個源同時打太粗暴；這裡一次只放 6 個（Aidoku 另受宿主 worker 上限限制），排隊跑。 */
const CONCURRENCY = 6

/**
 * 下一個該派工的源（純邏輯，不碰宿主）：`hosted` 逐筆標記還排著的源是不是要佔宿主 worker
 * （Aidoku 與 Mihon 一起算）。名額用完就**跳過它往後找**——後面的 Venera 源不該被擋住。
 *
 * `groups` 是 Mihon 的 apk：同一個 apk 的子源共用一個 worker，已經有一個在跑就跳過，
 * 不然它們只會在 worker 前面排隊，看起來就像「搜尋很慢」。回 -1 表示現在都不能派。
 */
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

/**
 * 跑單一個源。失敗也回一筆（error 有值），呼叫端不用 try ——
 * 聚合搜尋（側邊欄）與「改完篩選只重跑這一源」都用它。
 *
 * **取消不是失敗**：AbortError 原樣丟出去，不變成 `{ error }` 條目（側邊欄不該多一筆紅字）。
 */
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

/**
 * 排隊跑一輪所有源。
 *
 * Aidoku 源另外限流到宿主的 worker 上限：多出來的不但幫不上忙，還會把剛載好的源從 worker 上擠掉，
 * 點進詳情時又得重載一輪。Venera 源照原本的並行，不被 Aidoku 的名額擋住。
 */
export async function searchAll(
  sources: InstalledSource[],
  keyword: string,
  optionsOf: (source: InstalledSource) => Array<string | null>,
  onProgress: (progress: SearchProgress) => void,
  signal?: AbortSignal
): Promise<SourceSearchResult[]> {
  const results: SourceSearchResult[] = []
  /** 還沒派工的源，維持呼叫端給的順序。 */
  const pending = sources.slice()
  const hostedPending: boolean[] = pending.map(source => source.stored.kind !== "venera")
  /** Mihon 的 apk：同一個 apk 的子源共用一個 worker，同時只能派一個。 */
  const groupPending: Array<string | undefined> = pending.map(source =>
    mihon.isMihon(source) ? mihon.packageKeyOf(source.stored.key) : undefined
  )
  const limit = sourceWorkerLimit()
  const activeGroups = new Set<string>()
  let active = 0
  let activeHosted = 0
  let done = 0
  /** 第一個把整輪打下來的錯（取消）：後面的源不再派工，但已經在飛的照樣把結果回報出去。 */
  let halted: unknown = null
  let wake: (() => void) | null = null

  const report = () => onProgress({ results: [...results], done, total: sources.length })

  // 取消要立刻讓呼叫端知道（不必等手上的收尾），但已經派出去的仍然跑完並回報。
  let failRun: (error: unknown) => void = () => {}
  const failed = new Promise<never>((_, reject) => {
    failRun = reject
  })
  failed.catch(() => {})

  /** 派工到並行上限或沒有可派的源為止。 */
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
