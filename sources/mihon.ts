// Mihon（keiyoushi）擴充的橋接層：apk 在共用的 Aidoku 宿主頁裡，由 dexvm-wasm 在 worker 裡解譯。
//
// 一個 apk 一個 worker：apk 內的多個語言子源共用同一個 dexvm handle，
// Vesper 的 source key 對應「apk + sourceId」，而宿主的 worker key 就是 apk。
// 呼叫都排在同一個源的隊列上（與 Aidoku 共用宿主的上限與回收）。
//
// 這裡只做 DexvmError → 宿主自癒的轉譯：`trap` 由 worker 標成 fatal，宿主當成
// `SourceWorkerError`，只丟掉這個 apk 的 worker 重載；其他錯誤原樣往上丟。

import {
  callMihon,
  dropSource,
  fetchMihonImage,
  forgetSource,
  isSourceHostError,
  isSourceLoaded,
  isSourceWorkerError,
  loadMihonExtension,
  probeMihonWorker,
  resetSourceHost,
  runSourceExclusive,
  type MihonLoadTimings,
} from "../engine/sourcehost/host"
import { log } from "../engine/log"

const PREFIX = "mihon:"

/** 章節／頁面／詳情在真實源上就是慢；其餘呼叫維持宿主的 15 秒。 */
const SLOW_OP_TIMEOUT_MS = 30_000
const SLOW_OPS = new Set(["details", "chapters", "pages"])

export function keyOf(packageId: string): string {
  return PREFIX + packageId
}

export function isMihonKey(key: string): boolean {
  return key.startsWith(PREFIX)
}

export interface MihonManifest {
  packageId: string
  appName: string
  versionName: string | null
  minSdk: number | null
  targetSdk: number | null
  iconResourceId: number | null
  nsfw: null
}

export interface MihonSource {
  /** 十進位字串（i64）：不要轉成 number。 */
  id: string
  name: string
  lang: string
  baseUrl: string
  supportsLatest: boolean
  nsfw: null
}

export interface MihonManga {
  title: string
  author: string
  artist: string
  description: string
  genre: string
  status: number
  thumbnailUrl: string
  url: string
  /** ext-lib 1.6 的 `memo`：呼叫 details／chapters 時要原樣帶回去。 */
  memo?: string
}

export interface MihonChapter {
  name: string
  url: string
  dateUpload: number
  scanlator: string
  memo?: string
}

export interface MihonPage {
  index: number
  name: string
  url: string
  imageUrl: string
}

export interface MihonMangaPage {
  mangas: MihonManga[]
  hasNextPage: boolean
}

/** `exportPrefs` 的形狀：`{ "<prefs 檔名>": { key: value } }`。 */
export type MihonPrefs = Record<string, Record<string, unknown>>

export interface MihonLoaded {
  manifest: MihonManifest
  timings: MihonLoadTimings
}

/** 這個 apk 的位元組與設定：worker 被回收或被宿主 dispose 之後要能重開。 */
const extensions = new Map<string, { bytes: Uint8Array; prefs: MihonPrefs }>()

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure ?? "")
}

/** 宿主或 worker 壞掉就收拾一次再試：`trap` 只丟這個 apk 的 worker，頁面沒了才重建整個宿主。 */
async function attemptWithHealing<T>(apkKey: string, op: string, attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt()
  } catch (failure) {
    if (!isSourceHostError(failure)) throw failure
    const scope = isSourceWorkerError(failure) ? `${apkKey} 的 worker` : "宿主頁面"
    log("warning", "mihon", `${apkKey} 的 ${op} 失敗（${messageOf(failure)}），重建${scope}後重試一次`)
    if (isSourceWorkerError(failure)) await dropSource(apkKey)
    else await resetSourceHost()
    return await attempt()
  }
}

function opTimeout(op: string): number | undefined {
  return SLOW_OPS.has(op) ? SLOW_OP_TIMEOUT_MS : undefined
}

async function ensureLoaded(apkKey: string): Promise<void> {
  if (isSourceLoaded(apkKey)) return
  const entry = extensions.get(apkKey)
  if (!entry) throw new Error(`${apkKey} 還沒開啟（先 open 一次）`)
  await loadMihonExtension(entry.bytes, apkKey, entry.prefs)
}

/**
 * 開啟一個 apk：回 manifest 與載入耗時（拿 apk／實例化 wasm／open 分開量）。
 * 同一個 apk 再叫一次就是重載。
 */
export async function open(apkKey: string, apk: Uint8Array, prefs: MihonPrefs = {}): Promise<MihonLoaded> {
  extensions.set(apkKey, { bytes: apk, prefs })
  return await attemptWithHealing(apkKey, "open", () =>
    runSourceExclusive(apkKey, async () => {
      const loaded = await loadMihonExtension(apk, apkKey, prefs)
      return { manifest: loaded.manifest as MihonManifest, timings: loaded.timings }
    })
  )
}

/** 一次 op：先確保這個 apk 的 worker 載著它。 */
async function call<T>(apkKey: string, op: string, args: Record<string, unknown> = {}): Promise<T> {
  return await attemptWithHealing(apkKey, op, () =>
    runSourceExclusive(apkKey, async () => {
      await ensureLoaded(apkKey)
      return (await callMihon(apkKey, op, args, opTimeout(op))) as T
    })
  )
}

export async function sources(apkKey: string): Promise<MihonSource[]> {
  return await call<MihonSource[]>(apkKey, "sources")
}

export async function popular(apkKey: string, sourceId: string, page = 1): Promise<MihonMangaPage> {
  return await call<MihonMangaPage>(apkKey, "popular", { sourceId, page })
}

export async function latest(apkKey: string, sourceId: string, page = 1): Promise<MihonMangaPage> {
  return await call<MihonMangaPage>(apkKey, "latest", { sourceId, page })
}

export async function details(apkKey: string, sourceId: string, manga: MihonManga): Promise<MihonManga> {
  return await call<MihonManga>(apkKey, "details", { sourceId, manga })
}

/** 上游順序（新→舊）；要舊→新的話由映射層反轉。 */
export async function chapters(apkKey: string, sourceId: string, manga: MihonManga): Promise<MihonChapter[]> {
  return await call<MihonChapter[]>(apkKey, "chapters", { sourceId, manga })
}

export async function pages(apkKey: string, sourceId: string, chapter: MihonChapter): Promise<MihonPage[]> {
  return await call<MihonPage[]>(apkKey, "pages", { sourceId, chapter })
}

/**
 * 正文圖片一律走 `fetchImage`：源的攔截器與解混淆都在裡面，從外面分不出哪個源需要。
 * 位元組由 worker 走 `/result/<token>` 交回，不經 messageHandlers。
 */
export async function fetchImage(apkKey: string, sourceId: string, page: MihonPage): Promise<Uint8Array> {
  return await attemptWithHealing(apkKey, "fetchImage", () =>
    runSourceExclusive(apkKey, async () => {
      await ensureLoaded(apkKey)
      return await fetchMihonImage(apkKey, { sourceId, page })
    })
  )
}

/** 這個 apk 的 worker 裡載著它嗎（診斷用）。 */
export function isLoaded(apkKey: string): boolean {
  return isSourceLoaded(apkKey)
}

/**
 * 測試縫：讓這個 apk 的 worker 丟一個真的 trap（實機上找不到穩定的 panic 輸入）。
 * 不經自癒：呼叫端要看到的就是那個 `SourceWorkerError`；重載由下一通正常呼叫驗。
 */
export async function simulateWorkerCrash(apkKey: string): Promise<void> {
  await runSourceExclusive(apkKey, async () => {
    await ensureLoaded(apkKey)
    await probeMihonWorker(apkKey, { case: "trap" })
  })
}

/** 測試縫：worker 裡的 `eval_js` 對這段程式回什麼（`{ok, value}` 或 `{ok:false, error}`）。 */
export async function evalJsInWorker(
  apkKey: string,
  src: string
): Promise<{ ok: boolean; value?: unknown; error?: string }> {
  return await runSourceExclusive(apkKey, async () => {
    await ensureLoaded(apkKey)
    return await probeMihonWorker(apkKey, { case: "eval", src })
  })
}

/** 丟掉這個 apk 的載入狀態（下次呼叫重載）：換檔或移除時用。 */
export function forget(apkKey: string): void {
  extensions.delete(apkKey)
  forgetSource(apkKey)
}
