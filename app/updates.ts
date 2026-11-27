import type { AbortSignal } from "scripting"

import { isAbortError } from "../engine/http"
import { log } from "../engine/log"
import {
  getComicUpdate,
  listFavorites,
  setComicUpdate,
  type ComicUpdateRecord,
  type Favorite,
} from "../library/bookshelf"
import type { ComicPage, ComicRef } from "./comic"
import { comicLibrary } from "./services"

const HOUR = 3600_000
const DAY = 24 * HOUR

const TTL_COMPLETED = 30 * DAY
const TTL_DORMANT = 7 * DAY
const TTL_ONGOING = 12 * HOUR
const BACKOFF = 1 * HOUR
const DORMANT_AFTER = 180 * DAY

interface Rate {
  concurrency: number
  interval: number
}

const BACKGROUND: Rate = { concurrency: 2, interval: 400 }
const FOREGROUND: Rate = { concurrency: 3, interval: 300 }

export interface UpdateSummary {
  total: number
  done: number
  updated: number
  failed: number
  skipped: number
  records: ComicUpdateRecord[]
  aborted: boolean
  offline: boolean
}

export interface CheckOptions {
  force?: boolean
  comics?: ComicRef[]
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
  background?: boolean
}

export interface UpdateScheduler {
  checkUpdates(options?: CheckOptions): Promise<UpdateSummary>
  pause(): void
  resume(): void
  running(): boolean
}

let instance: UpdateScheduler | null = null

export function updatesScheduler(): UpdateScheduler {
  if (!instance) instance = createScheduler()
  return instance
}

export function pauseUpdates(): void {
  updatesScheduler().pause()
}

export function resumeUpdates(): void {
  updatesScheduler().resume()
}


const inFlight = new Map<string, Promise<ComicUpdateRecord | null>>()

const failedAt = new Map<string, number>()

function keyOf(ref: Pick<ComicRef, "sourceKey" | "comicId">): string {
  return `${ref.sourceKey}:${ref.comicId}`
}

export function comicUpdateRecord(page: ComicPage): ComicUpdateRecord {
  const latest = page.chapters[page.chapters.length - 1]
  const record: ComicUpdateRecord = {
    sourceKey: page.ref.sourceKey,
    comicId: page.ref.comicId,
    latestEpId: latest?.ref.epId ?? "",
    latestEpTitle: latest?.title ?? "",
    chapterCount: page.chapters.length,
    checkedAt: Date.now(),
  }
  if (page.status !== undefined) record.status = page.status
  if (page.updateTime !== undefined) record.updateTime = page.updateTime
  return record
}

export function shouldCheck(
  comic: Pick<Favorite, "sourceKey" | "comicId">,
  record?: ComicUpdateRecord,
  now = Date.now()
): boolean {
  const failed = failedAt.get(keyOf(comic))
  if (failed !== undefined && now - failed < BACKOFF) return false

  const cached = record ?? getComicUpdate(comic.sourceKey, comic.comicId)
  if (!cached) return true

  const ttl =
    cached.status === "completed" ? TTL_COMPLETED : dormant(cached.updateTime, now) ? TTL_DORMANT : TTL_ONGOING
  return now - cached.checkedAt >= ttl
}

function dormant(updateTime: string | undefined, now: number): boolean {
  const time = parseUpdateTime(updateTime)
  return time !== undefined && now - time > DORMANT_AFTER
}

export function parseUpdateTime(value: string | undefined): number | undefined {
  if (!value) return undefined
  const match = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(value)
  if (!match) return undefined
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  const parsed = new Date(Number(match[1]), month - 1, day).getTime()
  return Number.isNaN(parsed) ? undefined : parsed
}

function checkComic(ref: ComicRef, background: boolean, fresh: boolean): Promise<ComicUpdateRecord | null> {
  const key = keyOf(ref)
  const flying = inFlight.get(key)
  if (flying) return flying

  const task = (async (): Promise<ComicUpdateRecord | null> => {
    try {
      const page = await comicLibrary().comic({ sourceKey: ref.sourceKey, comicId: ref.comicId }, { background, fresh })
      const record = comicUpdateRecord(page)
      setComicUpdate(record)
      failedAt.delete(key)
      return record
    } catch (error) {
      if (!isAbortError(error)) {
        failedAt.set(key, Date.now())
        log("debug", "updates", `${key} 檢查失敗`, error)
      }
      return null
    } finally {
      inFlight.delete(key)
    }
  })()
  inFlight.set(key, task)
  return task
}

export async function offline(): Promise<boolean> {
  try {
    const state = await Promise.race([
      Device.getNetworkState(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 1000)),
    ])
    return state?.status === "unsatisfied"
  } catch {
    return false
  }
}


type ProgressListener = (done: number, total: number) => void

interface Watch {
  signal: AbortSignal
  listener: () => void
}

interface Pass {
  background: boolean
  force: boolean
  queue: ComicRef[]
  deferred: ComicRef[]
  total: number
  done: number
  updated: number
  failed: number
  skipped: number
  records: ComicUpdateRecord[]
  progress: Set<ProgressListener>
  watches: Watch[]
  active: number
  activeBySource: Map<string, number>
  nextStart: Map<string, number>
  finished: boolean
  resolve: (summary: UpdateSummary) => void
  promise: Promise<UpdateSummary>
}

function createScheduler(): UpdateScheduler {
  let current: Pass | null = null
  let paused = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  function clearTimer() {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  function summaryOf(pass: Pass): UpdateSummary {
    return {
      total: pass.total,
      done: pass.done,
      updated: pass.updated,
      failed: pass.failed,
      skipped: pass.skipped,
      records: [...pass.records],
      aborted: false,
      offline: false,
    }
  }

  function report(pass: Pass) {
    for (const listener of [...pass.progress]) {
      try {
        listener(pass.done, pass.total)
      } catch (error) {
        log("debug", "updates", "進度回呼拋錯", error)
      }
    }
  }

  function settle(pass: Pass, patch: Partial<UpdateSummary>) {
    if (pass.finished) return
    const summary = { ...summaryOf(pass), ...patch }
    pass.finished = true
    clearTimer()
    for (const watch of pass.watches) watch.signal.removeEventListener("abort", watch.listener)
    pass.watches.length = 0
    if (current === pass) current = null
    log(
      "info",
      "updates",
      `追更檢查 ${summary.total} 部：${summary.updated} 部有新話、${summary.failed} 部失敗、` +
        `${summary.skipped} 部跳過${summary.aborted ? "（中止）" : ""}`
    )
    pass.resolve(summary)
  }

  function finishIfIdle(pass: Pass) {
    if (pass.queue.length > 0 || pass.active > 0) return
    settle(pass, {})
  }

  function dispatch(pass: Pass, ref: ComicRef, interval: number) {
    pass.active++
    pass.activeBySource.set(ref.sourceKey, (pass.activeBySource.get(ref.sourceKey) ?? 0) + 1)
    pass.nextStart.set(ref.sourceKey, Date.now() + interval)
    const before = getComicUpdate(ref.sourceKey, ref.comicId)

    checkComic(ref, pass.background, pass.force)
      .then(record => {
        if (pass.finished) return
        pass.done++
        if (!record) {
          pass.failed++
          return
        }
        pass.records.push(record)
        if (before !== undefined && record.latestEpId !== before.latestEpId) pass.updated++
      })
      .finally(() => {
        pass.active--
        pass.activeBySource.set(ref.sourceKey, Math.max(0, (pass.activeBySource.get(ref.sourceKey) ?? 1) - 1))
        if (pass.finished) return
        report(pass)
        pump()
      })
  }

  function pump() {
    const pass = current
    if (!pass || pass.finished) return
    if (paused > 0) {
      finishIfIdle(pass)
      return
    }
    const rate = pass.background ? BACKGROUND : FOREGROUND
    let wait: number | null = null

    for (let index = 0; index < pass.queue.length && pass.active < rate.concurrency; ) {
      const ref = pass.queue[index]
      if ((pass.activeBySource.get(ref.sourceKey) ?? 0) > 0) {
        index++
        continue
      }
      const readyAt = pass.nextStart.get(ref.sourceKey) ?? 0
      const now = Date.now()
      if (readyAt > now) {
        const delay = readyAt - now
        wait = wait === null ? delay : Math.min(wait, delay)
        index++
        continue
      }
      pass.queue.splice(index, 1)
      dispatch(pass, ref, rate.interval)
    }

    if (pass.queue.length > 0 && wait !== null) {
      clearTimer()
      timer = setTimeout(() => {
        timer = null
        pump()
      }, wait)
    }
    finishIfIdle(pass)
  }

  function abort(pass: Pass) {
    if (pass.finished) return
    pass.skipped += pass.queue.length
    pass.done += pass.queue.length
    pass.queue.length = 0
    settle(pass, { aborted: true })
  }

  function watch(pass: Pass, signal: AbortSignal | undefined) {
    if (!signal) return
    if (signal.aborted) {
      abort(pass)
      return
    }
    const listener = () => abort(pass)
    signal.addEventListener("abort", listener)
    pass.watches.push({ signal, listener })
  }

  function join(pass: Pass, options: CheckOptions, background: boolean): Promise<UpdateSummary> {
    if (!background) pass.background = false
    if (options.force === true && !pass.force) {
      pass.force = true
      const redo = pass.deferred
      if (redo.length > 0) {
        pass.deferred = []
        pass.queue.push(...redo)
        pass.done -= redo.length
        pass.skipped -= redo.length
      }
    }
    if (options.onProgress) {
      pass.progress.add(options.onProgress)
      if (!pass.finished) options.onProgress(pass.done, pass.total)
    }
    watch(pass, options.signal)
    pump()
    return pass.promise
  }

  async function checkUpdates(options: CheckOptions = {}): Promise<UpdateSummary> {
    const background = options.background === true
    if (current) return join(current, options, background)

    if (await offline()) {
      const total = options.comics?.length ?? listFavorites().length
      log("info", "updates", "沒有網路：這一輪追更檢查略過")
      return {
        total,
        done: total,
        updated: 0,
        failed: 0,
        skipped: total,
        records: [],
        aborted: false,
        offline: true,
      }
    }

    if (current) return join(current, options, background)

    const targets = unique(
      options.comics ?? listFavorites().map(favorite => ({ sourceKey: favorite.sourceKey, comicId: favorite.comicId }))
    )
    const queue: ComicRef[] = []
    const deferred: ComicRef[] = []
    for (const ref of targets) {
      if (options.force === true || shouldCheck(ref)) queue.push(ref)
      else deferred.push(ref)
    }

    let resolve: (summary: UpdateSummary) => void = () => {}
    const promise = new Promise<UpdateSummary>(done => {
      resolve = done
    })
    const pass: Pass = {
      background,
      force: options.force === true,
      queue,
      deferred,
      total: targets.length,
      done: deferred.length,
      updated: 0,
      failed: 0,
      skipped: deferred.length,
      records: [],
      progress: new Set(),
      watches: [],
      active: 0,
      activeBySource: new Map(),
      nextStart: new Map(),
      finished: false,
      resolve,
      promise,
    }
    current = pass
    if (options.onProgress) pass.progress.add(options.onProgress)
    watch(pass, options.signal)
    if (!pass.finished) {
      report(pass)
      pump()
    }
    return promise
  }

  return {
    checkUpdates,
    pause() {
      paused++
      clearTimer()
    },
    resume() {
      if (paused === 0) return
      paused--
      if (paused === 0) pump()
    },
    running: () => current !== null,
  }
}

function unique(refs: readonly ComicRef[]): ComicRef[] {
  const seen = new Set<string>()
  const out: ComicRef[] = []
  for (const ref of refs) {
    const key = keyOf(ref)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ sourceKey: ref.sourceKey, comicId: ref.comicId })
  }
  return out
}
