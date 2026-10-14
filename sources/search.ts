// 跨來源聚合搜尋模組：依來源分組呈現結果，每源完成即時推送進度。
// 支援透過 AbortSignal 中止連線與取消佇列調度。

import type { AbortSignal } from "scripting"

import { isAbortError } from "../engine/http"
import { log } from "../engine/log"

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

/** 一次打 30 個源太粗暴，排隊跑。 */
const CONCURRENCY = 6

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
    const page = await searchSource(source, keyword, { options }, scope)
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
  let done = 0
  let cursor = 0

  const report = () => onProgress({ results: [...results], done, total: sources.length })

  async function worker() {
    while (cursor < sources.length) {
      // 派工前檢查：取消之後才輪到的源連請求都不發（不然「取消」只省下前面的幾個）。
      if (signal?.aborted) return
      const source = sources[cursor++]
      results.push(await searchOne(source, keyword, optionsOf(source), { signal }))
      done++
      report()
    }
  }

  const started = Date.now()
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sources.length) }, () => worker()))
  log("info", "search", `「${keyword}」跨 ${sources.length} 源完成，共 ${results.reduce((n, r) => n + r.comics.length, 0)} 筆 (${Date.now() - started}ms)`)
  return results
}
