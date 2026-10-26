// 追更檢查排程器：分批問源「有沒有新的一話」，把結果寫回 library.json 的 `updates`。
//
// 「什麼時候真的連網」由三件事一起決定：
//   TTL  —— 已完結 30 天、半年沒更新 7 天、其餘 12 小時；檢查失敗再多等 1 小時。
//   去重 —— 同一部作品的在飛請求只發一次（中途接手的那一輪直接沿用同一個 promise）。
//   讓路 —— 前台進詳情／閱讀器時暫停派工；手動下拉則接管正在跑的背景那一輪。
//
// 背景與前台的差別只有速度：背景 2 並行、同源 400ms；手動 3 並行、同源 300ms。

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

/** 已完結：30 天看一次就夠（偶爾還是會有番外）。 */
const TTL_COMPLETED = 30 * DAY
/** 半年沒更新：7 天。 */
const TTL_DORMANT = 7 * DAY
/** 連載中、沒標狀態：12 小時。 */
const TTL_ONGOING = 12 * HOUR
/** 上次檢查失敗的臨時冷卻。 */
const BACKOFF = 1 * HOUR
/** 「半年沒更新」用 180 天算，不追月曆。 */
const DORMANT_AFTER = 180 * DAY

interface Rate {
  /** 全局同時最多幾件在飛。 */
  concurrency: number
  /** 同一來源兩次派工之間至少隔多久。 */
  interval: number
}

const BACKGROUND: Rate = { concurrency: 2, interval: 400 }
const FOREGROUND: Rate = { concurrency: 3, interval: 300 }

export interface UpdateSummary {
  /** 這一輪要處理的作品數（TTL 未到的也算——它們是「不用查」，不是不存在）。 */
  total: number
  /** 已處理：成功、失敗、跳過都算。 */
  done: number
  /** 抓到新一話的作品數（第一次建立基準不算）。 */
  updated: number
  failed: number
  /** TTL 未到、或中止時還沒輪到而跳過的數量。 */
  skipped: number
  /** 這一輪寫進快取的紀錄（最新的一話）。 */
  records: ComicUpdateRecord[]
  /** 被 AbortSignal 中止：佇列裡的不再派工。 */
  aborted: boolean
  /** 裝置沒連網，整批沒跑。 */
  offline: boolean
}

export interface CheckOptions {
  /** 手動刷新：無視 TTL 與失敗退避。 */
  force?: boolean
  /** 只查這些作品；不給就是整個書架。 */
  comics?: ComicRef[]
  /** 中止：剩下的不再派工（在飛的那幾件照樣會把結果寫回去）。 */
  signal?: AbortSignal
  /** 每完成一件回報一次；接管正在跑的那一輪時會先補一次現況。 */
  onProgress?: (done: number, total: number) => void
  /** 背景靜默：低並行、拉長同源間隔。手動調用會把進行中的那一輪升級成前台速度。 */
  background?: boolean
}

export interface UpdateScheduler {
  checkUpdates(options?: CheckOptions): Promise<UpdateSummary>
  /** 前台要進詳情／閱讀器：先讓背景停手。可重入，與 `resume()` 成對呼叫。 */
  pause(): void
  resume(): void
  /** 有沒有一輪正在跑（畫面判斷要不要顯示進度）。 */
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

// ------------------------------------------------------------------ 單部作品

/** 同一部作品的在飛請求（鍵＝`sourceKey:comicId`）。 */
const inFlight = new Map<string, Promise<ComicUpdateRecord | null>>()

/** 上次檢查失敗的時間。只在記憶體裡：重開 App 就該再試一次。 */
const failedAt = new Map<string, number>()

function keyOf(ref: Pick<ComicRef, "sourceKey" | "comicId">): string {
  return `${ref.sourceKey}:${ref.comicId}`
}

/**
 * 詳情 → 追更快取。最新一話以源給的順序為準：章節清單是舊到新
 * （閱讀器照這個順序翻下一話），所以最後一筆就是最新話。
 */
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

/**
 * 這一部現在該不該查。`force` 由呼叫端處理（它無視這裡所有的冷卻）。
 * `record` 不給就讀書架上的快取。
 */
export function shouldCheck(
  comic: Pick<Favorite, "sourceKey" | "comicId">,
  record?: ComicUpdateRecord,
  now = Date.now()
): boolean {
  const failed = failedAt.get(keyOf(comic))
  // 上次失敗：先冷卻一小時再試，別讓一個壞掉的源把整批拖慢。
  if (failed !== undefined && now - failed < BACKOFF) return false

  const cached = record ?? getComicUpdate(comic.sourceKey, comic.comicId)
  if (!cached) return true

  const ttl =
    cached.status === "completed" ? TTL_COMPLETED : dormant(cached.updateTime, now) ? TTL_DORMANT : TTL_ONGOING
  return now - cached.checkedAt >= ttl
}

/** 半年沒更新（`updateTime` 解析不出來就當沒有）。 */
function dormant(updateTime: string | undefined, now: number): boolean {
  const time = parseUpdateTime(updateTime)
  return time !== undefined && now - time > DORMANT_AFTER
}

/**
 * 源的 `updateTime` 是 `YYYY-MM-DD`（後面可能帶時間，也有用 `/` 的）。解析不出來就當沒有：
 * 寧可退回 12 小時的 TTL，也不要拿亂猜的日期把冷卻拉長到 7 天。
 */
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

/**
 * 查一部作品。失敗回 `null`（呼叫端只算次數，不中斷整輪）。
 * 同作品共用在飛的 promise：背景剛好在查同一部時，接手的那一輪不會再打一次源。
 */
function checkComic(ref: ComicRef): Promise<ComicUpdateRecord | null> {
  const key = keyOf(ref)
  const flying = inFlight.get(key)
  if (flying) return flying

  const task = (async (): Promise<ComicUpdateRecord | null> => {
    try {
      const page = await comicLibrary().comic({ sourceKey: ref.sourceKey, comicId: ref.comicId })
      const record = comicUpdateRecord(page)
      setComicUpdate(record)
      failedAt.delete(key)
      return record
    } catch (error) {
      // 取消不是源的錯，不進退避（下次該照常查）。
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

/**
 * 沒有連線就整批略過：逐一失敗只會換來每部一小時的退避，沒有任何好處。
 * 量不到（舊系統、權限不足）就當成有網路——與其卡住不動，不如讓請求自己失敗。
 */
async function offline(): Promise<boolean> {
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

// ------------------------------------------------------------------ 排程器

type ProgressListener = (done: number, total: number) => void

interface Watch {
  signal: AbortSignal
  listener: () => void
}

interface Pass {
  /** 背景靜默；手動接管就翻成 false（速度跟著一起升）。 */
  background: boolean
  force: boolean
  queue: ComicRef[]
  /** TTL 未到先跳過的；`force` 接管時補回佇列。 */
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
  /** 讓路的層數（多個畫面可以同時說「先別查」）。 */
  let paused = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  function clearTimer() {
    // ⚠️ 比 `null`：setTimeout 回傳 number，第一個是 0（falsy）。
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

    checkComic(ref)
      .then(record => {
        if (pass.finished) return
        pass.done++
        if (!record) {
          pass.failed++
          return
        }
        pass.records.push(record)
        // 第一次只是建立基準，不算「有新話」。
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
    // 暫停中還是要收掉「本來就沒東西要查」的那一輪，不然呼叫端會一直等下去。
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

    // 全卡在同源間隔上：時間到再自己醒來（在飛的完成也會叫醒 pump）。
    if (pass.queue.length > 0 && wait !== null) {
      clearTimer()
      timer = setTimeout(() => {
        timer = null
        pump()
      }, wait)
    }
    finishIfIdle(pass)
  }

  /** 中止：佇列裡的不再派工；在飛的照樣會把紀錄寫回去（詳情 API 沒有 signal）。 */
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

  /** 接到正在跑的那一輪：換速度、加掛進度、必要時把 TTL 跳過的補回來。 */
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

    // 等網路狀態的這一下可能已經有人先開了一輪。
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

/** 同一部作品只查一次（收藏理論上不會重複，但呼叫端可能自己帶清單進來）。 */
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
