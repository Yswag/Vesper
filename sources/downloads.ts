import { createEmitter } from "../engine/emitter"
import { log } from "../engine/log"
import {
  beginChapter,
  flushChapter,
  idOf,
  isComplete,
  listChapters,
  offlinePagePath,
  removeChapter,
  savePage,
  statusOf,
  subscribeOffline,
  type OfflineChapter,
  type OfflineKey,
  type OfflineStatus,
} from "../engine/offline"
import { createPageCache } from "../engine/pageimages"
import * as aidoku from "./aidoku"
import * as mihon from "./mihon"
import { imageRetryFor, loadChapterImages } from "./operations"
import type { InstalledSource } from "./registry"

export type DownloadState = "none" | "queued" | "running" | "done" | "partial" | "failed"

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
  loadImages?: (source: InstalledSource, comicId: string, epId: string) => Promise<string[]>
  fetchPage?: (source: InstalledSource, comicId: string, epId: string, imageKey: string) => Promise<Uint8Array>
}

interface TaskInfo {
  key: OfflineKey
  meta: ChapterMeta
  total: number
  error?: string
}

interface FinishedTask extends TaskInfo {
  state: "finished"
}

interface Task extends TaskInfo {
  source: InstalledSource
  deps: Required<DownloadDeps>
  state: "queued" | "running"
  cancelled: boolean
  finished: Promise<void>
  resolve: () => void
}

type AnyTask = Task | FinishedTask

const MAX_PARALLEL = 2

const pageCache = createPageCache()

const tasks = new Map<string, AnyTask>()
const waiting: Task[] = []
let running = 0


const bus = createEmitter({ debounceMs: 200 })

let watching = false

export function subscribeDownloads(fn: () => void): () => void {
  if (!watching) {
    watching = true
    subscribeOffline(() => bus.emitDebounced())
  }
  return bus.subscribe(fn)
}


export function chapterDownloadState(key: OfflineKey): ChapterDownloadState {
  return chapterStateOf(tasks.get(idOf(key)), statusOf(key))
}

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

export function activeDownloadCount(): number {
  let count = 0
  for (const task of tasks.values()) if (isActive(task.state)) count += 1
  return count
}

export function undownloadedChapters(sourceKey: string, comicId: string, epIds: string[]): string[] {
  const pending: string[] = []
  for (const epId of epIds) {
    if (pending.includes(epId)) continue
    if (chapterDownloadState({ sourceKey, comicId, epId }).state === "done") continue
    pending.push(epId)
  }
  return pending
}

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


function comicModuleOf(source: InstalledSource) {
  if (aidoku.isAidoku(source)) return aidoku.comicModule(source)
  if (mihon.isMihon(source)) return mihon.comicModule(source)
  return source.instance?.comic ?? undefined
}

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
    comicModule: comicModuleOf(source),
    retry: aidoku.isAidoku(source) || mihon.isMihon(source) ? undefined : imageRetryFor(source),
  })
}

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

export function cancelChapterDownload(key: OfflineKey): void {
  const id = idOf(key)
  const task = tasks.get(id)
  if (!task || task.state === "finished") return
  task.cancelled = true
  if (task.state === "queued") {
    const at = waiting.indexOf(task)
    if (at >= 0) waiting.splice(at, 1)
    tasks.delete(id)
    task.resolve()
    bus.emitDebounced()
    return
  }
  bus.emitDebounced()
}

export async function deleteChapterDownload(key: OfflineKey): Promise<void> {
  const task = tasks.get(idOf(key))
  cancelChapterDownload(key)
  if (task && task.state !== "finished") await task.finished
  tasks.delete(idOf(key))
  removeChapter(key)
}

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
  let chapter: OfflineChapter | null = null
  try {
    const images = await task.deps.loadImages(task.source, task.key.comicId, task.key.epId)
    if (task.cancelled) return
    const opened = beginChapter(task.key, images, task.meta)
    chapter = opened
    task.total = images.length
    bus.emitDebounced()

    for (let index = 0; index < images.length; index++) {
      if (task.cancelled) break
      const imageKey = images[index]
      if (offlinePagePath(task.key, index, imageKey)) continue
      try {
        const bytes = await task.deps.fetchPage(task.source, task.key.comicId, task.key.epId, imageKey)
        savePage(opened, index, imageKey, bytes)
      } catch (error) {
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
    if (chapter) flushChapter(chapter)
    running--
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
