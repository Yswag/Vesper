// 書架（收藏）與閱讀進度。
//
// 存成一個 JSON 檔 `<documents>/Vesper/library.json`：單檔、好備份、好除錯、之後接 iCloud
// 也只改路徑。寫入去抖 500ms，並在退出前 flush（見 app/lifecycle.ts 的 onBeforeExit）。
//
// 一條規則：**源被刪除時不清書架**。紀錄留著並標記「源已移除」，否則刪一個源會清掉半個書架。

import { createEmitter } from "../engine/emitter"
import { appDataRoot, hasFileAccess, join, readText, writeText } from "../engine/fs"
import { kv } from "../engine/storage"

export interface Favorite {
  sourceKey: string
  comicId: string
  title: string
  cover?: string
  addedAt: number
}

export interface Progress {
  sourceKey: string
  comicId: string
  title: string
  cover?: string
  epId: string
  epTitle: string
  /** 上次讀到的領先可見頁（0 起算）。舊資料沒有這個欄位。 */
  page?: number
  /** 讀到的那一話總共幾頁（畫格數）。舊資料沒有這個欄位。 */
  pageCount?: number
  /**
   * 這一筆是在**離線模式**讀的（離線書架／下載頁那兩個入口進來的）。
   * 續讀時靠它決定走離線還是走源（`canResumeOffline`）；線上讀不寫這個欄位（＝蓋掉）。
   */
  offline?: boolean
  updatedAt: number
}

interface Library {
  version: number
  favorites: Favorite[]
  progress: Record<string, Progress>
}

const VERSION = 1
const FLUSH_DELAY = 500
/** 沒有檔案授權時的備援位置（不讓書架默默不落盤）。 */
const KV_KEY = "venera:library"

let cache: Library | null = null
let timer: ReturnType<typeof setTimeout> | null = null

/**
 * 變更訂閱：畫面（詳情/首頁/書架）靠它即時重繪，不必等重新進入。
 *
 * 去抖 250ms：連續模式滑動時領先頁會一直變，合併成一次通知，不要拖著首頁/書架一直重繪。
 * （毫秒數是這裡決定的；`notifyNow()` 就是這個去抖的例外。）
 */
const bus = createEmitter({ debounceMs: 250 })

export const subscribeLibrary = bus.subscribe

/**
 * 立刻通知，不等去抖。
 *
 * 給收藏這種「低頻、且使用者期待馬上看到」的變更用：
 * 閱讀時進度會不停地送出通知把去抖計時器一直往後推，
 * 若收藏也走去抖，就可能拖到使用者已經離開這一頁才生效。
 * 快取已經同步更新，所以這裡順手取消待送出的通知也不會掉資料。
 */
function notifyNow() {
  bus.cancelPending()
  bus.emit()
}

function libraryPath(): string {
  return join(appDataRoot(), "library.json")
}

function load(): Library {
  if (cache) return cache

  // 優先嘗試直接讀取檔案（如果系統已經有權限，不必等 ensureFileAccess 非同步返回）
  let raw: string | null = null
  try {
    raw = readText(libraryPath())
  } catch {
    raw = null
  }

  // 檔案讀不到時才嘗試從 KV 讀取
  if (!raw) {
    raw = stringifyKv()
  }

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Library
      cache = {
        version: parsed.version ?? VERSION,
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
        progress: parsed.progress && typeof parsed.progress === "object" ? parsed.progress : {},
      }
      return cache
    } catch {
      // 壞檔就從空的開始，不擋啟動
    }
  }
  cache = { version: VERSION, favorites: [], progress: {} }
  return cache
}

/** 當權限確認後，重新同步並載入磁碟上的 library.json（防止剛啟動時權限未結算導致載入空資料） */
export function reloadLibraryFromDisk(): void {
  const raw = readText(libraryPath())
  if (!raw) return
  try {
    const parsed = JSON.parse(raw) as Library
    cache = {
      version: parsed.version ?? VERSION,
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      progress: parsed.progress && typeof parsed.progress === "object" ? parsed.progress : {},
    }
    bus.emitDebounced()
  } catch {
    // 忽略格式錯誤
  }
}

function schedule() {
  // ⚠️ 比 `null`，不能只寫 `if (timer)`：Scripting 的 setTimeout 回傳 number，第一個是 `0`（falsy）。
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    flushLibrary()
  }, FLUSH_DELAY)
}

/** 立即落盤（退出前呼叫）。 */
export function flushLibrary() {
  if (!cache) return
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  const payload = JSON.stringify(cache, null, 2)
  // 如果能寫檔案就寫檔案（包含直接寫成功），否則才存 KV
  const wrote = writeText(libraryPath(), payload)
  if (!wrote) {
    kv.set(KV_KEY, payload)
  }
}

function stringifyKv(): string | null {
  const raw = kv.get(KV_KEY)
  return typeof raw === "string" ? raw : null
}

function keyOf(sourceKey: string, comicId: string): string {
  return `${sourceKey}:${comicId}`
}

// ------------------------------------------------------------------ 收藏

export function listFavorites(): Favorite[] {
  return [...load().favorites].sort((a, b) => b.addedAt - a.addedAt)
}

export function isFavorite(sourceKey: string, comicId: string): boolean {
  return load().favorites.some(item => item.sourceKey === sourceKey && item.comicId === comicId)
}

export function toggleFavorite(entry: Omit<Favorite, "addedAt">): boolean {
  const library = load()
  const index = library.favorites.findIndex(
    item => item.sourceKey === entry.sourceKey && item.comicId === entry.comicId
  )
  if (index >= 0) {
    library.favorites.splice(index, 1)
    schedule()
    notifyNow()
    return false
  }
  library.favorites.push({ ...entry, addedAt: Date.now() })
  schedule()
  notifyNow()
  return true
}

export function removeFavorite(sourceKey: string, comicId: string) {
  const library = load()
  library.favorites = library.favorites.filter(
    item => !(item.sourceKey === sourceKey && item.comicId === comicId)
  )
  schedule()
  notifyNow()
}

// ------------------------------------------------------------------ 進度

export function getProgress(sourceKey: string, comicId: string): Progress | undefined {
  return load().progress[keyOf(sourceKey, comicId)]
}

/** 最近閱讀，新的在前。首頁與書架的「繼續閱讀」都用這個。 */
export function listProgress(): Progress[] {
  return Object.values(load().progress).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function setProgress(entry: Omit<Progress, "updatedAt">) {
  const library = load()
  library.progress[keyOf(entry.sourceKey, entry.comicId)] = { ...entry, updatedAt: Date.now() }
  schedule()
  bus.emitDebounced()
}

export function clearProgress(sourceKey: string, comicId: string) {
  const library = load()
  delete library.progress[keyOf(sourceKey, comicId)]
  schedule()
  bus.emitDebounced()
}
