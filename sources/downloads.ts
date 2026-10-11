// 下載管理員：app 層級、不綁畫面。
//
// 進度與狀態活在這個模組（不是 React state），所以下載中離開詳情頁、切到別的 tab 都照樣跑；
// 畫面用 subscribeDownloads 訂閱。04 的選取模式、下載全部與下載頁都建在它上面。
//
// 一張圖一律走正文的圖片管線（resolveImageRequest → onResponse → modifyImage → 最終位元組），
// 再把那一份位元組多寫一份進離線層——離線看到的圖與線上完全一致，閱讀時也不必重跑管線。
// 管線的快取是**這裡自己的一份**（不是閱讀器那一份），所以閱讀器換話不會把下載剛抓好的頁清掉。
//
// 「完成」的定義交給離線層：整章每一張都成功才算已下載，有缺就是未完成，重跑只補缺的。

import { createEmitter } from "../engine/emitter"
import { log } from "../engine/log"
import {
  beginChapter,
  idOf,
  isComplete,
  listChapters,
  offlinePagePath,
  removeChapter,
  savePage,
  statusOf,
  subscribeOffline,
  type OfflineKey,
  type OfflineStatus,
} from "../engine/offline"
import { createPageCache } from "../engine/pageimages"
import { imageRetryFor, loadChapterImages } from "./operations"
import type { InstalledSource } from "./registry"

export type DownloadState = "none" | "queued" | "running" | "done" | "partial" | "failed"

/** 還在跑的狀態（排隊中或進行中）：管理員、下載頁與背景 session 都用這一個判斷。 */
export function isActive(state: DownloadState | "finished"): state is DownloadState {
  return state === "queued" || state === "running"
}

export interface ChapterDownloadState {
  state: DownloadState
  completed: number
  total: number
  error?: string
}

export interface ChapterMeta {
  comicTitle?: string
  epTitle?: string
  cover?: string
}

export interface DownloadDeps {
  /** 取章節的圖片鍵；預設問源（`loadEp`）。 */
  loadImages?: (source: InstalledSource, comicId: string, epId: string) => Promise<string[]>
  /** 抓一張圖的最終位元組（走完 onResponse 與 modifyImage）；預設走圖片管線。 */
  fetchPage?: (source: InstalledSource, comicId: string, epId: string, imageKey: string) => Promise<Uint8Array>
}

/** 任務的共同資料：畫面（章節列與下載頁）需要的全部。 */
interface TaskInfo {
  key: OfflineKey
  meta: ChapterMeta
  total: number
  error?: string
}

/** 跑完的任務：只剩 TaskInfo。source 與 deps 跑完就放掉，型別上這裡不可能有（見 runTask 的 finally）。 */
interface FinishedTask extends TaskInfo {
  state: "finished"
}

/** 排隊中／跑得中的任務：多了跑它需要的 source／deps 與協調用的 promise。 */
interface Task extends TaskInfo {
  source: InstalledSource
  deps: Required<DownloadDeps>
  state: "queued" | "running"
  /** 使用者按了取消：跑完手上這一張就停，已抓到的留著。 */
  cancelled: boolean
  finished: Promise<void>
  resolve: () => void
}

type AnyTask = Task | FinishedTask

/** 同時最多跑兩章：一章內是逐張抓，兩章並行對站方已經夠客氣了。 */
const MAX_PARALLEL = 2

/**
 * 下載自己那一份正文快取：下載是 app 層級的、不綁畫面；閱讀器那一份隨換話／離開放掉。
 * 兩份分開之後，閱讀器 dispose 不會清掉下載剛抓好的頁（反過來也一樣）。
 * 這裡沒有「放掉」的時機——抓過的頁都寫進離線層了，這一邊只留最近 24 頁（LRU 自己淘汰）。
 */
const pageCache = createPageCache()

// 跑完的任務會從 Task 換成 FinishedTask（source／deps 就放掉了，見 runTask 的 finally）。
const tasks = new Map<string, AnyTask>()
const waiting: Task[] = []
let running = 0

// ------------------------------------------------------------------ 訂閱

/** 去抖 200ms：每抓完一張就變一次，畫面合併成一次重繪（毫秒數是這裡決定的，見 emitter.ts）。 */
const bus = createEmitter({ debounceMs: 200 })

let watching = false

export function subscribeDownloads(fn: () => void): () => void {
  // 離線層的變動（下載、刪除）也要讓畫面重繪，這裡代它轉發一次。
  if (!watching) {
    watching = true
    subscribeOffline(() => bus.emitDebounced())
  }
  return bus.subscribe(fn)
}

// ------------------------------------------------------------------ 查詢

/** 一章現在的狀態：跑得中的看任務，跑完的看離線層（那才是「到底下載完了沒」的真相）。 */
export function chapterDownloadState(key: OfflineKey): ChapterDownloadState {
  return chapterStateOf(tasks.get(idOf(key)), statusOf(key))
}

/**
 * 任務與離線層合起來 → 畫面上的狀態。**全 App 唯一的一份映射**（章節列與下載頁都走它）。
 *
 * 順序就是語意：
 *   跑得中 → 離線層說完成 → 離線層有東西但沒齊 → 試過而且失敗 → 未下載。
 *
 * 「能不能續傳」決定 `partial` 還是 `failed`：抓到一半的算 partial（`beginChapter` 留下對得上的頁，
 * 重跑只補缺的）；一張都沒抓到的才算 failed。兩者在下載頁同屬「未完成」，差別只在有沒有理由可說。
 */
function chapterStateOf(task: AnyTask | undefined, offline: OfflineStatus): ChapterDownloadState {
  if (task && isActive(task.state)) {
    return {
      state: task.state,
      completed: offline.completed,
      total: task.total || offline.total,
      error: task.error,
    }
  }
  if (offline.state === "done") return { state: "done", completed: offline.completed, total: offline.total }
  if (offline.state === "partial") {
    return { state: "partial", completed: offline.completed, total: offline.total, error: task?.error }
  }
  if (task?.error) {
    return { state: "failed", completed: offline.completed, total: task.total || offline.total, error: task.error }
  }
  return { state: "none", completed: offline.completed, total: offline.total }
}

/** 這一組章節裡還沒下載完的（已下載的跳過，重複的只算一次）。「下載 (n)」的 n 與「下載全部」都用它。 */
export function undownloadedChapters(sourceKey: string, comicId: string, epIds: string[]): string[] {
  const pending: string[] = []
  for (const epId of epIds) {
    if (pending.includes(epId)) continue
    if (chapterDownloadState({ sourceKey, comicId, epId }).state === "done") continue
    pending.push(epId)
  }
  return pending
}

/** 下載頁上的一章：任務（跑得中／失敗）與離線層（下載完了沒、佔多少）合起來看。 */
export interface DownloadRecord {
  key: OfflineKey
  comicTitle?: string
  epTitle?: string
  cover?: string
  state: DownloadState
  completed: number
  total: number
  bytes: number
  error?: string
}

/** 下載頁要的全部章節：跑得中的、失敗的、未完成的、已完成的（什麼都沒有的不列）。 */
export function listDownloads(): DownloadRecord[] {
  const records: DownloadRecord[] = []
  const seen = new Set<string>()

  for (const task of tasks.values()) {
    const offline = statusOf(task.key)
    const state = chapterStateOf(task, offline)
    seen.add(idOf(task.key))
    if (state.state === "none") continue
    records.push({
      key: task.key,
      comicTitle: task.meta.comicTitle,
      epTitle: task.meta.epTitle,
      cover: task.meta.cover,
      state: state.state,
      completed: state.completed,
      total: state.total,
      bytes: offline.bytes,
      error: state.error,
    })
  }

  // 任務只活在這個 process 裡；下載過什麼要看離線層（重開 App 之後仍然看得到）。
  for (const chapter of listChapters()) {
    const id = idOf(chapter.key)
    if (seen.has(id)) continue
    const offline = statusOf(chapter.key)
    const state = chapterStateOf(undefined, offline)
    if (state.state === "none") continue
    records.push({
      key: chapter.key,
      comicTitle: chapter.comicTitle,
      epTitle: chapter.epTitle,
      cover: chapter.cover,
      state: state.state,
      completed: state.completed,
      total: state.total,
      bytes: offline.bytes,
    })
  }

  return records
}

// ------------------------------------------------------------------ 下載

/** 一張圖的最終位元組：走正文管線（解析源的請求 → onResponse → modifyImage），離線看到的圖與線上完全一致。 */
async function fetchPageBytes(
  source: InstalledSource,
  comicId: string,
  epId: string,
  imageKey: string
): Promise<Uint8Array> {
  return pageCache.bytes({
    sourceKey: source.stored.key,
    imageKey,
    comicId,
    epId,
    comicModule: source.instance?.comic,
    retry: imageRetryFor(source),
  })
}

/**
 * 開始下載一章。已經在跑就接回同一條；回傳的 promise 在這一章跑完時解決，**不會 reject**
 * （單一張失敗只記在狀態裡，整章的成敗由離線層決定）。
 */
export function startChapterDownload(
  source: InstalledSource,
  comicId: string,
  epId: string,
  meta: ChapterMeta = {},
  deps: DownloadDeps = {}
): Promise<void> {
  const key: OfflineKey = { sourceKey: source.stored.key, comicId, epId }
  const id = idOf(key)
  const live = tasks.get(id)
  if (live && live.state !== "finished") return live.finished

  let resolve: () => void = () => {}
  const finished = new Promise<void>(done => {
    resolve = done
  })
  const task: Task = {
    key,
    source,
    meta,
    deps: { loadImages: deps.loadImages ?? loadChapterImages, fetchPage: deps.fetchPage ?? fetchPageBytes },
    state: "queued",
    total: 0,
    cancelled: false,
    finished,
    resolve,
  }
  tasks.set(id, task)
  waiting.push(task)
  bus.emitDebounced()
  pump()
  return finished
}

/**
 * 一次送出多章下載（選取模式與「下載全部」共用）。已下載的跳過、重複的不重抓；
 * 回傳的 promise 在這些章節都跑完時解決（單一張失敗只記在狀態裡，不會 reject）。
 */
export interface DownloadRequest {
  epId: string
  epTitle?: string
}

export function downloadChapters(
  source: InstalledSource,
  comicId: string,
  requests: DownloadRequest[],
  meta: ChapterMeta = {},
  deps: DownloadDeps = {}
): Promise<void> {
  const pending = undownloadedChapters(source.stored.key, comicId, requests.map(request => request.epId))
  const jobs = pending.map(epId =>
    startChapterDownload(
      source,
      comicId,
      epId,
      { ...meta, epTitle: requests.find(request => request.epId === epId)?.epTitle ?? meta.epTitle },
      deps
    )
  )
  return Promise.all(jobs).then(() => undefined)
}

/**
 * 取消一章（排隊中或跑得中的）。已抓到的頁面留著，這一章不會被當成已下載。
 * 排隊中的直接抽掉，跑得中的讓它跑完手上這一張就停。
 */
export function cancelChapterDownload(key: OfflineKey): void {
  const id = idOf(key)
  const task = tasks.get(id)
  if (!task || task.state === "finished") return
  task.cancelled = true
  if (task.state === "queued") {
    const at = waiting.indexOf(task)
    if (at >= 0) waiting.splice(at, 1)
    // 排隊中的直接抽掉：任務就此消失，這一章的狀態交由離線層回答。
    tasks.delete(id)
    task.resolve()
    bus.emitDebounced()
    return
  }
  bus.emitDebounced()
}

/** 刪掉一章的下載：釋放空間，順便清掉它留下的失敗紀錄。 */
export function deleteChapterDownload(key: OfflineKey): void {
  tasks.delete(idOf(key))
  removeChapter(key)
}

/** 唯讀觀測點：現在還有幾個任務握著 source／deps（dev 探針用，不是給畫面或源的介面）。 */
export function debugRetainedSourceCount(): number {
  let count = 0
  for (const task of tasks.values()) if ("source" in task) count++
  return count
}

function pump() {
  while (running < MAX_PARALLEL && waiting.length > 0) {
    const task = waiting.shift()
    if (!task) return
    running++
    void runTask(task)
  }
}

async function runTask(task: Task) {
  task.state = "running"
  bus.emitDebounced()
  try {
    const images = await task.deps.loadImages(task.source, task.key.comicId, task.key.epId)
    // 清單還沒拿到就被取消：連 manifest 都不寫，這一章等於沒動過。
    if (task.cancelled) return
    // 先把清單寫進離線層：已經抓到而且圖片鍵還對得上的頁留著，所以重跑只補缺的。
    const chapter = beginChapter(task.key, images, task.meta)
    task.total = images.length
    bus.emitDebounced()

    for (let index = 0; index < images.length; index++) {
      if (task.cancelled) break
      const imageKey = images[index]
      if (offlinePagePath(task.key, index, imageKey)) continue
      try {
        const bytes = await task.deps.fetchPage(task.source, task.key.comicId, task.key.epId, imageKey)
        savePage(chapter, index, imageKey, bytes)
      } catch (error) {
        // 一張失敗不擋其他張，也不會讓這一章變成已下載。
        task.error = error instanceof Error ? error.message : String(error)
        log("warning", "download", `${task.key.epId} 第 ${index + 1} 張失敗`, error)
      }
      bus.emitDebounced()
    }
    if (isComplete(task.key)) task.error = undefined
  } catch (error) {
    task.error = error instanceof Error ? error.message : String(error)
    log("error", "download", `${task.key.epId} 下載失敗`, error)
  } finally {
    running--
    // 跑完就不再需要 source 與 deps 了：沒事的任務直接丟掉（狀態改由離線層回答）；
    // 有錯的換成一個輕量紀錄（只剩畫面要的 key/meta/error/total）——失敗一樣說得出原因，
    // 但 registry 重新載入之後不會再釘著上一代的源實例。
    if (task.error) {
      tasks.set(idOf(task.key), {
        key: task.key,
        meta: task.meta,
        total: task.total,
        state: "finished",
        error: task.error,
      })
    } else {
      tasks.delete(idOf(task.key))
    }
    task.resolve()
    bus.emitDebounced()
    pump()
  }
}
