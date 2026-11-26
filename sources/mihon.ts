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
  takeSourceChallenge,
  type MihonLoadTimings,
  type SourceChallenge,
  type SourcePriority,
} from "../engine/sourcehost/host"
import { bareHost, hostOf, setCookies, type Cookie } from "../engine/cookies"
import { solveCloudflare } from "../engine/cloudflare"
import { appDataRoot, ensureDir, exists, join, listDir, readBytes, readText, remove, writeBytes, writeText } from "../engine/fs"
import type { ImageRequest } from "../engine/images"
import { log } from "../engine/log"
import { t } from "../i18n"
import { getContentLanguages } from "../app/contentLanguages"

import * as memo from "./mihonMemo"
import { prefsFileOf, rootNodesOf, type MihonPreference, type MihonPreferenceValues } from "./mihonPrefs"
import type { StoredSource } from "./store"
import type { InstalledSource } from "./registry"
import type { ComicListItem, ComicListPage } from "../engine/adapt"
import type { ComicDetail, ComicStatus, ExploreEntry } from "./operations"

const PREFIX = "mihon:"

/** dexvm 目前解得動的 ext-lib。索引沒給這個欄位（舊格式）就不擋。 */
export const SUPPORTED_EXTENSION_LIBS = ["1.4", "1.6"]

/** 章節／頁面／詳情在真實源上就是慢；其餘呼叫維持宿主的 15 秒。 */
const SLOW_OP_TIMEOUT_MS = 30_000
const SLOW_OPS = new Set(["details", "chapters", "pages", "mangaUpdate"])

export function keyOf(packageId: string): string {
  return PREFIX + packageId
}

/** Vesper 的 source key：`mihon:<packageId>:<sourceId>`（sourceId 是十進位字串，不轉 number）。 */
export function sourceKeyOf(packageId: string, sourceId: string): string {
  return `${PREFIX}${packageId}:${sourceId}`
}

/** 任何一層的 key → 宿主的 worker key（apk）。 */
export function packageKeyOf(key: string): string {
  if (!key.startsWith(PREFIX)) return key
  const body = key.slice(PREFIX.length)
  const at = body.lastIndexOf(":")
  return at < 0 ? key : PREFIX + body.slice(0, at)
}

export function packageIdOf(key: string): string {
  const packageKey = packageKeyOf(key)
  return packageKey.startsWith(PREFIX) ? packageKey.slice(PREFIX.length) : packageKey
}

/** 子源的 sourceId；傳 package key 就是 undefined。 */
export function sourceIdOf(key: string): string | undefined {
  const packageKey = packageKeyOf(key)
  return key === packageKey ? undefined : key.slice(packageKey.length + 1)
}

export function isMihonKey(key: string): boolean {
  return key.startsWith(PREFIX)
}

/** dexvm 解不解得動這個 ext-lib；沒有版本資訊就不擋。 */
export function isSupportedExtensionLib(version: string | undefined): boolean {
  if (version === undefined || version.trim().length === 0) return true
  return SUPPORTED_EXTENSION_LIBS.includes(version.trim())
}

export function isMihon(source: InstalledSource): boolean {
  return source.stored.kind === "mihon"
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

/** `sources` op 的結果（一個 apk 的子源清單）：`supportsLatest` 只有這裡有，磁碟上的安裝記錄沒有。 */
const sourceLists = new Map<string, MihonSource[]>()

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
 * 同一個 apk 再叫一次就是重載；預設帶著磁碟上的使用者設定（`prefsOf`）。
 * `priority` 逐呼叫帶：追更第一次碰到某個 apk 時，載入不該插在使用者呼叫前面。
 */
export async function open(
  apkKey: string,
  apk: Uint8Array,
  prefs: MihonPrefs = prefsOf(apkKey),
  priority: SourcePriority = "user"
): Promise<MihonLoaded> {
  extensions.set(apkKey, { bytes: apk, prefs })
  sourceLists.delete(apkKey)
  return await attemptWithHealing(apkKey, "open", () =>
    runSourceExclusive(
      apkKey,
      async () => {
        const loaded = await loadMihonExtension(apk, apkKey, prefs)
        return { manifest: loaded.manifest as MihonManifest, timings: loaded.timings }
      },
      priority
    )
  )
}

/** 一次 op：先確保這個 apk 的 worker 載著它。 */
async function call<T>(
  apkKey: string,
  op: string,
  args: Record<string, unknown> = {},
  priority: SourcePriority = "user"
): Promise<T> {
  return await attemptWithHealing(apkKey, op, () =>
    runSourceExclusive(
      apkKey,
      async () => {
        await ensureLoaded(apkKey)
        return (await callMihon(apkKey, op, args, opTimeout(op))) as T
      },
      priority
    )
  )
}

export async function sources(apkKey: string): Promise<MihonSource[]> {
  const list = await call<MihonSource[]>(apkKey, "sources")
  sourceLists.set(apkKey, list)
  return list
}

/** 搜尋（`filters` 是 dexvm 的 `FilterDef` 狀態；dexvm 的 filter state 無效，所以一律空陣列）。 */
export async function search(
  apkKey: string,
  sourceId: string,
  query: string,
  page = 1,
  filters: Array<{ name: string; state: number }> = []
): Promise<MihonMangaPage> {
  return await call<MihonMangaPage>(apkKey, "search", { sourceId, query, page, filters })
}

/** 子源的 `HttpSource.headers`（源沒宣告 UA 時 dexvm 補上預設 UA）。 */
export async function headers(apkKey: string, sourceId: string): Promise<Record<string, string>> {
  const raw = await call<any>(apkKey, "headers", { sourceId })
  const result: Record<string, string> = {}
  if (!Array.isArray(raw?.headers)) return result
  for (const pair of raw.headers) {
    if (Array.isArray(pair) && pair.length >= 2) result[String(pair[0])] = String(pair[1])
  }
  return result
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

export interface MihonMangaUpdate {
  manga: MihonManga
  chapters: MihonChapter[]
}

/**
 * 詳情＋章節一次問：1.6 的源只跑一次 `getMangaUpdate`（一發主頁），
 * 沒有這個介面的 legacy 源由 dexvm 自己退成 details＋chapters。
 * `fetchDetails`／`fetchChapters` 預設都開；只要其中一半的呼叫點就關掉另一個。
 */
export async function mangaUpdate(
  apkKey: string,
  sourceId: string,
  manga: MihonManga,
  options: { fetchDetails?: boolean; fetchChapters?: boolean; priority?: SourcePriority } = {}
): Promise<MihonMangaUpdate> {
  const raw = await call<any>(
    apkKey,
    "mangaUpdate",
    {
      sourceId,
      manga,
      fetchDetails: options.fetchDetails !== false,
      fetchChapters: options.fetchChapters !== false,
    },
    options.priority ?? "user"
  )
  return {
    manga: raw && typeof raw.manga === "object" && raw.manga !== null ? (raw.manga as MihonManga) : manga,
    chapters: Array.isArray(raw?.chapters) ? (raw.chapters as MihonChapter[]) : [],
  }
}

export async function pages(apkKey: string, sourceId: string, chapter: MihonChapter): Promise<MihonPage[]> {
  return await call<MihonPage[]>(apkKey, "pages", { sourceId, chapter })
}

/**
 * 正文圖片一律走 `fetchImage`：源的攔截器與解混淆都在裡面，從外面分不出哪個源需要。
 * 位元組由 worker 走 `/result/<token>` 交回，不經 messageHandlers。
 */
export async function fetchImage(apkKey: string, sourceId: string, page: MihonPage): Promise<Uint8Array> {
  const bytes = await attemptWithHealing(apkKey, "fetchImage", () =>
    runSourceExclusive(apkKey, async () => {
      await ensureLoaded(apkKey)
      return await fetchMihonImage(apkKey, { sourceId, page })
    })
  )
  // dexvm 遇到圖床 4xx 會回空位元組而不是拋錯；Mihon 的 `getImage` 在非 2xx 時拋 `HttpException`。
  if (bytes.byteLength === 0) throw new Error(t("sources.emptyImage"))
  return bytes
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

/**
 * 丟掉這個 apk 的載入狀態（下次呼叫重載）：換檔、移除、或「模擬重開 App」時用。
 * 子源的記憶體（memo、PageRef、封面請求）也一起丟，磁碟上的檔案不動。
 */
export function forget(apkKey: string): void {
  extensions.delete(apkKey)
  sourceLists.delete(apkKey)
  forgetSource(apkKey)
  const packageId = packageIdOf(apkKey)
  for (const child of installedOf(apkKey).sources ?? []) forgetChildMemory(sourceKeyOf(packageId, child.id))
}

function forgetChildMemory(sourceKey: string): void {
  memo.forget(sourceKey)
  sourceHeaders.delete(sourceKey)
}

// ---------------------------------------------------------------- 磁碟上的擴充
//
//   <documents>/Vesper/sources/mihon/<packageId>/extension.apk
//   <documents>/Vesper/sources/mihon/<packageId>/installed.json
//
// 一個 apk 的多個語言子源各自是一個 Vesper 源，但共用一份 apk 與一個 worker。
// `installed.json` 記下子源清單（id／名稱／語言／網址）與「手動關掉」清單，可見性由
// 「語言在內容語言內」與「不在 disabled」兩者決定（同上游 enabledLanguages × disabledSources）。

interface ChildRecord {
  id: string
  name: string
  lang: string
  baseUrl: string
}

interface InstallRecord {
  origin?: string | null
  version?: string
  installedAt?: number
  updatedAt?: number
  iconUrl?: string | null
  /** 子源 id 的清單：使用者手動關掉的（上游 `disabledSources`）。 */
  disabled?: string[]
  /** 2＝已從舊的 `enabled` 逐源開關轉過來。 */
  schema?: number
  /** 舊資料：子源 id → 啟用；只在轉換時讀。 */
  enabled?: Record<string, boolean>
  sources?: ChildRecord[]
}

function readJson(path: string): any {
  const raw = readText(path)
  if (raw == null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** `sources/mihon/<packageId>/`。 */
export function dirOf(key: string): string {
  return join(appDataRoot(), "sources", "mihon", packageIdOf(key))
}

function installedOf(packageKey: string): InstallRecord {
  return readJson(join(dirOf(packageKey), "installed.json")) ?? {}
}

function writeInstalled(packageKey: string, record: InstallRecord): void {
  writeText(join(dirOf(packageKey), "installed.json"), JSON.stringify(record, null, 2))
}

/** 子源預設看不看得到：語言在內容語言內（上游 `lang in enabledLanguages`）。 */
export function languageVisible(lang: string): boolean {
  return getContentLanguages().includes(lang)
}

/**
 * 舊資料（逐源 enabled）轉成「手動關掉」清單：
 * enabled=false 且在內容語言內 → 算手動關掉；不在內容語言內 → 預設看不到，不進清單。
 * 只做一次（schema=2），重跑不會多加。
 */
function migrateRecord(packageKey: string, record: InstallRecord): InstallRecord {
  if (record.schema === 2) return record
  const disabled = new Set(Array.isArray(record.disabled) ? record.disabled : [])
  for (const child of record.sources ?? []) {
    if (record.enabled?.[child.id] === false && languageVisible(String(child.lang ?? ""))) {
      disabled.add(child.id)
    }
  }
  const next: InstallRecord = { ...record, disabled: [...disabled], schema: 2 }
  delete next.enabled
  writeInstalled(packageKey, next)
  return next
}

/** 一個擴充有多個子源時，名稱後面帶語言——否則源列表會是一排同名。 */
function displayNameOf(child: ChildRecord, total: number): string {
  return total > 1 ? `${child.name} (${child.lang})` : child.name
}

function childSource(packageKey: string, record: InstallRecord, child: ChildRecord, total: number): InstalledSource {
  const key = sourceKeyOf(packageIdOf(packageKey), child.id)
  const name = displayNameOf(child, total)
  const version = String(record.version ?? "")
  const manualDisabled = Array.isArray(record.disabled) && record.disabled.includes(child.id)
  const enabled = languageVisible(child.lang) && !manualDisabled
  const stored: StoredSource = {
    key,
    kind: "mihon",
    name,
    version,
    minAppVersion: "",
    homeUrl: child.baseUrl,
    iconUrl: typeof record.iconUrl === "string" && record.iconUrl ? record.iconUrl : undefined,
    origin: record.origin ?? null,
    installedAt: record.installedAt ?? 0,
    updatedAt: record.updatedAt ?? record.installedAt ?? 0,
    enabled,
  }
  return {
    stored,
    enabled,
    manualDisabled,
    language: child.lang,
    meta: { className: "", key, name, version, minAppVersion: "", url: child.baseUrl },
  }
}

/** 磁碟上有哪些擴充（registry 用；不碰網路、不載 VM）。 */
export function installedSources(): InstalledSource[] {
  const out: InstalledSource[] = []
  for (const packageId of listDir(join(appDataRoot(), "sources", "mihon"))) {
    const packageKey = keyOf(packageId)
    const record = migrateRecord(packageKey, installedOf(packageKey))
    const children = Array.isArray(record.sources) ? (record.sources as ChildRecord[]) : []
    if (children.length === 0 || !exists(join(dirOf(packageKey), "extension.apk"))) {
      const stored: StoredSource = {
        key: packageKey,
        kind: "mihon",
        name: packageId,
        version: String(record.version ?? ""),
        minAppVersion: "",
        homeUrl: "",
        origin: record.origin ?? null,
        installedAt: record.installedAt ?? 0,
        updatedAt: record.updatedAt ?? record.installedAt ?? 0,
        enabled: false,
      }
      out.push({ stored, enabled: false, error: t("sources.mihon.missing") })
      continue
    }
    for (const child of children) out.push(childSource(packageKey, record, child, children.length))
  }
  return out
}

// ---------------------------------------------------------------- 設定（prefs）
//
//   <documents>/Vesper/sources/mihon/<packageId>/prefs.json
//
// 形狀就是 dexvm `exportPrefs` 的那一份（檔名 → key → 值），可以直接餵回 `open` 的 `prefs`。
// 只寫使用者改過的 key：預設值不落地，擴充自己寫進 SharedPreferences 的東西也不落地。
// 一個 apk 的多個子源共用一份檔案，各自的鍵在 `source_<sourceId>` 底下。

function prefsPath(apkKey: string): string {
  return join(dirOf(apkKey), "prefs.json")
}

/** 這個 apk 的使用者設定（重開 App 後還原用）。 */
export function prefsOf(apkKey: string): MihonPrefs {
  const record = readJson(prefsPath(apkKey))
  return record && typeof record === "object" && !Array.isArray(record) ? (record as MihonPrefs) : {}
}

/** 寫回磁碟，同時讓記憶體裡那一份跟著換（下次 `ensureLoaded` 才帶得到新的）。 */
function savePrefs(apkKey: string, prefs: MihonPrefs): void {
  writeText(prefsPath(apkKey), JSON.stringify(prefs, null, 2))
  const entry = extensions.get(apkKey)
  if (entry) entry.prefs = prefs
}

/** 讀一個子源的設定定義與目前的值（值來自 `exportPrefs`，含擴充自己寫的部分）。 */
export interface MihonPreferences {
  nodes: MihonPreference[]
  values: MihonPreferenceValues
}

export async function preferencesOf(source: InstalledSource): Promise<MihonPreferences> {
  const ref = refOf(source)
  return await mapAsk(source, "preferences", async () => {
    // 先把 apk 載進來（`open` 自己會排一次隊列），再進隊列問——在隊列裡再排自己會互等。
    await ensureExtension(ref.apkKey)
    return await runSourceExclusive(ref.apkKey, async () => {
      const nodes = (await callMihon(ref.apkKey, "preferences", { sourceId: ref.sourceId })) as MihonPreference[]
      const exported = (await callMihon(ref.apkKey, "exportPrefs", {})) as MihonPrefs
      return {
        nodes: rootNodesOf(Array.isArray(nodes) ? nodes : []),
        values: exported?.[prefsFileOf(ref.sourceId)] ?? {},
      }
    })
  })
}

/**
 * 改一個設定值：先讓 VM 套用（同一顆 handle 內會立即生效），把改過的 key 併回磁碟，
 * 然後只丟掉這個 apk 的 worker——下次呼叫帶著新的 prefs 重開，其他源不受影響。
 * 回傳的是改完當下 `exportPrefs` 的那一份（畫面直接拿去重畫）。
 */
export async function setPreferenceValue(
  source: InstalledSource,
  key: string,
  value: unknown
): Promise<MihonPreferenceValues> {
  const ref = refOf(source)
  const written = await mapAsk(source, "setPreference", async () => {
    await ensureExtension(ref.apkKey)
    return await runSourceExclusive(ref.apkKey, async () => {
      const result = (await callMihon(ref.apkKey, "setPreference", { sourceId: ref.sourceId, key, value })) as {
        file?: string
        key?: string
      }
      const exported = (await callMihon(ref.apkKey, "exportPrefs", {})) as MihonPrefs
      return {
        file: typeof result?.file === "string" && result.file ? result.file : prefsFileOf(ref.sourceId),
        key: typeof result?.key === "string" && result.key ? result.key : key,
        exported,
      }
    })
  })

  const prefs = prefsOf(ref.apkKey)
  const file = written.file
  savePrefs(ref.apkKey, { ...prefs, [file]: { ...(prefs[file] ?? {}), [written.key]: value } })
  forgetSource(ref.apkKey)
  for (const child of installedOf(ref.apkKey).sources ?? []) {
    sourceHeaders.delete(sourceKeyOf(packageIdOf(ref.apkKey), child.id))
  }
  log("info", "mihon", `${ref.sourceKey} 的設定 ${written.key} 已更新，這個 apk 的 worker 下次呼叫重建`)
  return written.exported?.[file] ?? {}
}

// ---------------------------------------------------------------- 失敗狀態

/** 子源層的失敗原因（記憶體；重啟 App、重新安裝或重新啟用就會清掉）。 */
const failures = new Map<string, string>()

let stateListener: (() => void) | null = null

/** registry 用它廣播變更（不反向 import registry，避免循環）。 */
export function setStateListener(listener: (() => void) | null): void {
  stateListener = listener
}

/** 這個子源現在為什麼不可用；正常的話是 undefined。 */
export function failureOf(key: string): string | undefined {
  return failures.get(key)
}

/** 重新嘗試這個子源（重新安裝／啟用時用）。 */
export function clearFailure(key: string): void {
  if (failures.delete(key)) stateListener?.()
}

/** 宿主或擴充自己把這個子源弄壞了（同一份 self-heal 策略）。 */
export function markFailure(key: string, reason: string): void {
  failures.set(key, reason)
  log("error", "mihon", `${key} 已標記為不可用：${reason}`)
  stateListener?.()
}

// ---------------------------------------------------------------- 安裝

export interface MihonInstallInfo {
  /** 來源索引網址（從倉庫裝的才有）。 */
  origin?: string | null
  /** 倉庫條目的 key（`mihon:<packageId>`）；有給就檢查 apk 裡的 packageId 一致。 */
  packageKey?: string
  /** 倉庫索引給的 ext-lib 版本；不支援就不落地。 */
  extensionLib?: string
  /** 倉庫索引給的圖示網址。 */
  iconUrl?: string | null
  /** 索引上的版號（manifest 沒給時退回它）。 */
  version?: string
}

/**
 * 安裝（或更新）一個 apk：驗 ext-lib、開一次拿 manifest 與子源、寫檔、算預設啟用。
 * 子源清單來自 `sources` op（apk 是權威），不是倉庫索引。
 */
export async function install(apk: Uint8Array, info: MihonInstallInfo = {}): Promise<StoredSource[]> {
  if (info.extensionLib && !isSupportedExtensionLib(info.extensionLib)) {
    throw new Error(t("sources.mihon.unsupportedLib", { version: info.extensionLib }))
  }

  const probeKey = info.packageKey ?? keyOf(`apk-${Date.now()}`)
  let apkKey = probeKey
  let loaded = await open(apkKey, apk)
  const packageId = String(loaded.manifest.packageId ?? "")
  const packageKey = keyOf(packageId)
  if (!packageId) {
    forget(probeKey)
    throw new Error(t("sources.mihon.invalidPackage"))
  }
  if (probeKey !== packageKey) {
    if (info.packageKey) {
      forget(probeKey)
      throw new Error(t("sources.catalog.keyMismatch", { expected: info.packageKey, actual: packageKey }))
    }
    // 手動給的 apk（沒有預期 key）：換成真正的 key 重開一次，之後都用它。
    forget(probeKey)
    apkKey = packageKey
    loaded = await open(packageKey, apk)
  }

  const children = await sources(apkKey)
  if (children.length === 0) throw new Error(t("sources.mihon.noSources"))

  const previous = migrateRecord(packageKey, installedOf(packageKey))
  const disabled = new Set(Array.isArray(previous.disabled) ? previous.disabled : [])

  ensureDir(dirOf(packageKey))
  writeBytes(join(dirOf(packageKey), "extension.apk"), apk)
  const childRecords: ChildRecord[] = children.map(child => ({
    id: String(child.id),
    name: String(child.name ?? ""),
    lang: String(child.lang ?? "all"),
    baseUrl: String(child.baseUrl ?? ""),
  }))
  const record: InstallRecord = {
    origin: info.origin ?? previous.origin ?? null,
    version: String(loaded.manifest.versionName ?? info.version ?? previous.version ?? ""),
    installedAt: previous.installedAt ?? Date.now(),
    updatedAt: Date.now(),
    iconUrl: info.iconUrl ?? previous.iconUrl ?? null,
    disabled: childRecords.map(child => child.id).filter(id => disabled.has(id)),
    schema: 2,
    sources: childRecords,
  }
  writeInstalled(packageKey, record)
  for (const child of children) clearFailure(sourceKeyOf(packageId, String(child.id)))
  log("info", "mihon", `已安裝 ${childRecords.length} 個子源（${packageId} v${record.version}）`)
  return childRecords.map(child => childSource(packageKey, record, child, childRecords.length).stored)
}

/** 手動關掉／打開一個子源（寫回 `installed.json`，不影響內容語言）。 */
export function setEnabled(key: string, enabled: boolean): void {
  const packageKey = packageKeyOf(key)
  if (!exists(dirOf(packageKey))) return
  const record = migrateRecord(packageKey, installedOf(packageKey))
  const disabled = new Set(Array.isArray(record.disabled) ? record.disabled : [])
  const sourceId = sourceIdOf(key)
  if (sourceId !== undefined) {
    if (enabled) disabled.delete(sourceId)
    else disabled.add(sourceId)
  } else {
    for (const child of record.sources ?? []) {
      if (enabled) disabled.delete(child.id)
      else disabled.add(child.id)
    }
  }
  writeInstalled(packageKey, { ...record, disabled: [...disabled], schema: 2 })
  clearFailure(key)
}

/** 移除：整個擴充連同所有子源一起刪（`registry.uninstallSource` 會走這裡）。 */
export function uninstall(key: string): void {
  const packageKey = packageKeyOf(key)
  const record = installedOf(packageKey)
  remove(dirOf(packageKey))
  for (const child of record.sources ?? []) {
    const childKey = sourceKeyOf(packageIdOf(packageKey), child.id)
    clearFailure(childKey)
    memo.forget(childKey)
  }
  clearFailure(packageKey)
  forget(packageKey)
  log("info", "mihon", `已移除 ${packageIdOf(packageKey)}`)
}

// ---------------------------------------------------------------- 映射層
//
// 把 Mihon 的子源包成 Vesper 的四段（清單／搜尋／詳情／章節）與圖片請求。
// comicId＝SManga.url、epId＝SChapter.url；SManga／SChapter 的完整欄位與 memo 存在源層的
// side store（`sources/mihonMemo.ts`），要傳給 dexvm 時再組回去。

/** 子源在這個 App 裡的座標：apk（worker key）、sourceId、side store 目錄、站台網址。 */
export interface MihonRef {
  sourceKey: string
  apkKey: string
  sourceId: string
  /** `sources/mihon/<packageId>/memo/<sourceId>`。 */
  dir: string
  baseUrl: string
}

export function refOf(source: InstalledSource): MihonRef {
  const sourceKey = source.stored.key
  const apkKey = packageKeyOf(sourceKey)
  const sourceId = sourceIdOf(sourceKey)
  if (sourceId === undefined) throw new Error(t("sources.mihon.noSources"))
  return {
    sourceKey,
    apkKey,
    sourceId,
    dir: join(dirOf(apkKey), "memo", sourceId),
    baseUrl: source.meta?.url ?? source.stored.homeUrl ?? "",
  }
}

/**
 * 確保這個 apk 載進 worker（第一次用到時才讀磁碟）。
 * 子源之間共用同一個 worker，所以這裡只認 apk。
 */
export async function ensureExtension(apkKey: string, priority: SourcePriority = "user"): Promise<void> {
  if (extensions.has(apkKey) || isSourceLoaded(apkKey)) return
  const apk = readBytes(join(dirOf(apkKey), "extension.apk"))
  if (!apk) throw new Error(t("sources.mihon.missing"))
  await open(apkKey, apk, prefsOf(apkKey), priority)
}

/** 宿主層的技術字換成人話，擴充自己的錯誤原樣保留（同 Aidoku）。 */
function userMessageOf(failure: unknown): string {
  const message = messageOf(failure)
  if (/timed out|timeout/i.test(message)) return t("sources.mihon.timeout")
  if (/did not become ready|failed to load|worker failed|failed to start/i.test(message)) {
    return t("sources.mihon.initFailed")
  }
  return message
}

function assertAvailable(sourceKey: string): void {
  const reason = failureOf(sourceKey)
  if (reason) throw new Error(t("sources.mihon.unavailable", { reason }))
}

// ---------------------------------------------------------------- Cloudflare
//
// 照 Aidoku 拆成兩段：代理（`performProxy`）碰到挑戰只記一筆 `pendingChallenge`，
// 過盾在呼叫這一層做——宿主那條 /proxy 是 HttpServer 的原生回呼，`solveCloudflare` 的
// `setTimeout` 會踩「Timer requires its active script on the main JS execution queue」。
//
// 代理記的 key 是**宿主 worker 的 key**（Mihon 是一個 apk 一個 worker，worker 送的是 apk），
// 所以取挑戰要用 `ref.apkKey`；寫 jar、顯示來源名稱才用子源的 key。

/** 過盾失敗不是源的錯：帶著原因往上丟，呼叫端不會因此把源標成不可用。 */
export class MihonVerificationError extends Error {}

/**
 * 只有 clearance 進宿主 jar。其餘的站方 cookie 在 dexvm 的 jar 裡就好：那裡的 `Set-Cookie`
 * 會自己刷新，宿主再存一份，下一發 `withJarCookies` 就拿舊值蓋掉新的。
 */
const HOST_JAR_CLEARANCE: readonly string[] = ["cf_clearance"]

/**
 * 撞到 Cloudflare 挑戰就過盾、把 clearance 交給兩個 jar，然後重試一次。
 * 沒撞到就只是把這次呼叫的成敗原樣帶出去。
 */
export async function withChallenge<T>(source: InstalledSource, task: () => Promise<T>): Promise<T> {
  const ref = refOf(source)
  let value: T | undefined
  let failure: unknown = null
  let failed = false
  try {
    value = await task()
  } catch (error) {
    failed = true
    failure = error
  }

  const challenge = takeSourceChallenge(ref.apkKey)
  if (!challenge) {
    if (failed) throw failure
    return value as T
  }

  log("info", "mihon", `${source.stored.key} 撞到 Cloudflare 挑戰（${challenge.url}），過盾後重試一次`)
  const cookies = await passChallenge(source, challenge)
  await deliverClearance(ref, challenge.url, cookies)
  // 第一次就被判死的源要先解掉，不然重試會直接被 `assertAvailable` 擋下。
  clearFailure(source.stored.key)
  try {
    return await task()
  } finally {
    // 重試自己撞到的挑戰不再留給下一次（避免每次呼叫都多過一次盾）。
    takeSourceChallenge(ref.apkKey)
  }
}

async function passChallenge(source: InstalledSource, challenge: SourceChallenge): Promise<Cookie[]> {
  const ref = refOf(source)
  try {
    const cookies = await solveCloudflare(ref.sourceKey, challenge.url, challenge.userAgent, {
      hostJarNames: HOST_JAR_CLEARANCE,
    })
    // 代理合成請求用的是 worker 的 key（apk），jar 也是按 key 分的：子源的 jar 給封面，
    // apk 的 jar 給代理合併（dexvm 那邊沒塞進去時還有一層）。
    if (ref.apkKey !== ref.sourceKey) {
      setCookies(ref.apkKey, challenge.url, cookies.filter(cookie => HOST_JAR_CLEARANCE.includes(cookie.name)))
    }
    return cookies
  } catch (failure) {
    log("warning", "mihon", `${ref.sourceKey} 的 Cloudflare 過盾失敗`, failure)
    throw new MihonVerificationError(t("sources.mihon.verification", { reason: messageOf(failure) }))
  }
}

/**
 * 把 clearance 也塞進 dexvm 的 jar：擴充自己（以及 `CookieManager`）讀的就是那一份。
 * 塞不進去不算失敗——宿主 jar 那一份仍會併進代理請求。
 */
async function deliverClearance(ref: MihonRef, url: string, cookies: Cookie[]): Promise<void> {
  // dexvm 的 jar 認 host 就是 host（不分 path、不做後綴比對），所以拿被擋的那個 host 當鍵。
  const host = bareHost(hostOf(url))
  const pairs = cookies.filter(cookie => cookie.name && host).map(cookie => [host, cookie.name, cookie.value ?? ""])
  if (pairs.length === 0) return
  try {
    await call(ref.apkKey, "cookies", { set: pairs })
  } catch (failure) {
    log("warning", "mihon", `${ref.sourceKey} 的 clearance 沒進 dexvm 的 jar（宿主 jar 仍會補）`, failure)
  }
}

/**
 * 一次對外的源操作：撞到 Cloudflare 先過盾、宿主／worker 壞掉重試後仍失敗就標記不可用（同 Aidoku）。
 */
async function mapAsk<T>(source: InstalledSource, step: string, task: () => Promise<T>): Promise<T> {
  assertAvailable(source.stored.key)
  try {
    return await withChallenge(source, task)
  } catch (failure) {
    if (failure instanceof MihonVerificationError) throw failure
    log("error", "mihon", `${source.stored.key} 的 ${step} 失敗`, failure)
    if (isSourceHostError(failure)) markFailure(source.stored.key, userMessageOf(failure))
    throw new Error(t("sources.mihon.failed", { message: userMessageOf(failure) }))
  }
}

/** 頁面清單的種類：熱門一定有，最新看源的 `supportsLatest`。 */
type MihonListKind = "popular" | "latest"

function listKinds(apkKey: string, sourceId: string): MihonListKind[] {
  const list = sourceLists.get(apkKey)
  if (!list) return ["popular"]
  const child = list.find(item => item.id === sourceId)
  return child?.supportsLatest === true ? ["popular", "latest"] : ["popular"]
}

/** 載入子源清單（`supportsLatest` 在裡面）：探索頁要知道有沒有「最新」。 */
export async function ready(source: InstalledSource): Promise<void> {
  const ref = refOf(source)
  await mapAsk(source, "load", async () => {
    await ensureExtension(ref.apkKey)
    if (!sourceLists.has(ref.apkKey)) await sources(ref.apkKey)
  })
}

export function exploreOf(source: InstalledSource): ExploreEntry[] {
  const ref = refOf(source)
  const kinds = listKinds(ref.apkKey, ref.sourceId)
  return kinds.map((kind, index) => ({
    index,
    title: kind === "latest" ? t("sources.mihon.latest") : t("sources.mihon.popular"),
    type: "multiPageComicList",
    supportsNext: true,
  }))
}

function absolute(url: string, baseUrl: string): string {
  const value = url.trim()
  if (!value) return ""
  if (value.startsWith("//")) return `https:${value}`
  if (/^https?:/i.test(value)) return value
  if (!baseUrl) return value
  return value.startsWith("/") ? `${baseUrl.replace(/\/$/, "")}${value}` : `${baseUrl.replace(/\/$/, "")}/${value}`
}

/** 源從 HTML 抓來的文字常帶頭尾空白（極速漫畫、GoDa 的標題）。 */
function textOf(value: string | null | undefined): string {
  return (value ?? "").trim()
}

function tagsOf(genre: string): Array<{ namespace: string; values: string[] }> {
  const values = genre
    .split(",")
    .map(value => value.trim())
    .filter(value => value.length > 0)
  return values.length > 0 ? [{ namespace: "", values }] : []
}

/** Mihon 的 SManga.status：1 連載 / 2 完結 / 4 完結（停止出版）/ 5 腰斬 / 6 休刊。 */
const STATUS_BY_CODE: Record<number, ComicStatus> = {
  1: "ongoing",
  2: "completed",
  4: "completed",
  5: "cancelled",
  6: "hiatus",
}

function toComicItem(ref: MihonRef, manga: MihonManga): ComicListItem | null {
  if (!manga.url) return null
  return {
    id: manga.url,
    title: textOf(manga.title) || t("sources.untitled"),
    subtitle: textOf(manga.author) || undefined,
    cover: absolute(manga.thumbnailUrl, ref.baseUrl) || undefined,
    tags: manga.genre
      ? manga.genre
          .split(",")
          .map(value => value.trim())
          .filter(value => value.length > 0)
      : [],
    description: textOf(manga.description) || undefined,
  }
}

function toListPage(ref: MihonRef, raw: MihonMangaPage, page: number): ComicListPage {
  const mangas = Array.isArray(raw?.mangas) ? raw.mangas : []
  for (const manga of mangas) memo.rememberManga(ref.sourceKey, manga)
  return {
    comics: mangas.map(manga => toComicItem(ref, manga)).filter((item): item is ComicListItem => item !== null),
    maxPage: raw?.hasNextPage === true ? page + 1 : page,
  }
}

/** 瀏覽：熱門／最新。`kind` 由探索頁的序號決定（`exploreOf` 的順序）。 */
export async function listPage(
  source: InstalledSource,
  kind: MihonListKind,
  page: number
): Promise<ComicListPage> {
  const ref = refOf(source)
  return await mapAsk(source, kind, async () => {
    await ensureExtension(ref.apkKey)
    const raw = kind === "latest" ? await latest(ref.apkKey, ref.sourceId, page) : await popular(ref.apkKey, ref.sourceId, page)
    return toListPage(ref, raw, page)
  })
}

export async function searchPage(
  source: InstalledSource,
  keyword: string,
  page = 1
): Promise<ComicListPage> {
  const ref = refOf(source)
  return await mapAsk(source, "search", async () => {
    await ensureExtension(ref.apkKey)
    return toListPage(ref, await search(ref.apkKey, ref.sourceId, keyword, page), page)
  })
}

/**
 * 詳情＋章節：一次 `mangaUpdate`（fetchDetails／fetchChapters 都開）取代原本的兩個 op。
 * 回來的完整 SManga 與 SChapter 寫進 side store：之後 `pages` 只拿 epId 也組得回去。
 */
export async function detail(source: InstalledSource, comicId: string, background = false): Promise<ComicDetail> {
  const ref = refOf(source)
  const priority: SourcePriority = background ? "background" : "user"
  return await mapAsk(source, "detail", async () => {
    await ensureExtension(ref.apkKey, priority)
    const known = memo.mangaOf(ref.dir, ref.sourceKey, comicId)
    const update = await mangaUpdate(ref.apkKey, ref.sourceId, known, {
      fetchDetails: true,
      fetchChapters: true,
      priority,
    })
    // 同 Mihon `UpdateManga`：詳情沒給封面就留著清單那張（包子的詳情頁不解析封面）。
    const manga = update.manga.thumbnailUrl ? update.manga : { ...update.manga, thumbnailUrl: known.thumbnailUrl }
    const list = update.chapters
    memo.rememberComic(ref.dir, ref.sourceKey, comicId || manga.url, manga, list)
    return {
      id: comicId,
      title: textOf(manga.title) || t("sources.untitled"),
      cover: absolute(manga.thumbnailUrl, ref.baseUrl) || undefined,
      description: textOf(manga.description) || undefined,
      status: STATUS_BY_CODE[Number(manga.status)],
      tags: tagsOf(manga.genre ?? ""),
      // Mihon 回新→舊；Vesper 全 App 一律舊→新（同 Aidoku 在這裡轉一次）。
      chapters: list
        .map(chapter => ({
          group: chapter.scanlator ?? "",
          id: chapter.url,
          title: textOf(chapter.name) || chapter.url,
          locked: false,
        }))
        .filter(chapter => chapter.id)
        .reverse(),
      uploader: textOf(manga.author) || undefined,
      artists: textOf(manga.artist) || undefined,
      url: /^https?:/i.test(manga.url ?? "") ? manga.url : absolute(manga.url ?? "", ref.baseUrl) || undefined,
    }
  })
}

/** 診斷用：這一部會傳給 dexvm 的 Manga（有存過就是完整物件）。 */
export function mangaArgumentOf(source: InstalledSource, comicId: string): MihonManga {
  const ref = refOf(source)
  return memo.mangaOf(ref.dir, ref.sourceKey, comicId)
}

/** 診斷用：這一話會傳給 dexvm 的 Chapter（重開 App 後也拿得到）。 */
export function chapterArgumentOf(source: InstalledSource, comicId: string, epId: string): MihonChapter {
  const ref = refOf(source)
  return memo.chapterOf(ref.dir, ref.sourceKey, comicId, epId)
}

// ---------------------------------------------------------------- 圖片鍵
//
// 圖片鍵就是「一頁」的身分：正文快取的檔名、離線 manifest、下載與預取全部只認它。

/**
 * 鍵的格式版本。舊版（沒有這一段）用裸的 `Page.url` 當鍵，對不上這裡的任何鍵，
 * 所以舊快取檔一個都不會命中，開章時被 `dropStalePages` 清掉。
 */
const IMAGE_KEY_TAG = "m1"

/**
 * 一頁的鍵：`m1` ⏎ 頁索引 ⏎ `Page.url` ⏎ `Page.imageUrl`。
 *
 * Mihon 用 `Page.index`（頁在清單裡的位置）定位一頁，而同一個 `Page.url` 可以出現在好幾頁上
 * （極速漫畫 42 頁的 url 全是同一個章節網址，只有 `imageUrl` 不同）。索引因此必須在鍵裡；
 * 鍵又是「整話命中磁碟就不問源」時唯一的線索，所以 url 與 imageUrl 也要一起帶，
 * 才還原得出能直接抓的 PageRef。換行分隔：網址與索引都放不下換行，不會有歧義。
 */
export function imageKeyOfPage(page: MihonPage, index: number): string {
  return [IMAGE_KEY_TAG, String(index), page.url ?? "", page.imageUrl ?? ""].join("\n")
}

/** 磁碟上的鍵還是現在這一版嗎。 */
export function isCurrentImageKey(imageKey: string): boolean {
  const parts = imageKey.split("\n")
  return parts.length === 4 && parts[0] === IMAGE_KEY_TAG && /^\d+$/.test(parts[1])
}

/** 整份鍵清單還算數嗎（舊版的鍵是裸網址，一頁對不上就整份不用）。 */
export function acceptsImageKeys(imageKeys: string[]): boolean {
  return imageKeys.every(isCurrentImageKey)
}

/** 鍵 → PageRef；不是這一版的鍵就回 null。 */
function pageOfImageKey(imageKey: string): MihonPage | null {
  if (!isCurrentImageKey(imageKey)) return null
  const [, index, url, imageUrl] = imageKey.split("\n")
  return { index: Number(index), name: "", url, imageUrl }
}

export async function chapterImageKeys(
  source: InstalledSource,
  comicId: string,
  epId: string
): Promise<string[]> {
  const ref = refOf(source)
  return await mapAsk(source, "pages", async () => {
    await ensureExtension(ref.apkKey)
    const chapter = memo.chapterOf(ref.dir, ref.sourceKey, comicId, epId)
    const raw = await pages(ref.apkKey, ref.sourceId, chapter)
    const list = Array.isArray(raw) ? raw : []
    if (list.length === 0) throw new Error(t("sources.emptyChapter"))
    return list.map((page, index) => imageKeyOfPage(page, index))
  })
}

/** 正文取圖：`fetchImage` 在 VM 裡跑（含源的攔截器與解混淆），位元組回來後照常走快取與預取。 */
function pageRequestOf(source: InstalledSource, imageKey: string): ImageRequest {
  const ref = refOf(source)
  // 舊鍵（裸網址）沒有索引與 imageUrl：照舊當 url 用，dexvm 會自己去解析那一頁。
  const page = pageOfImageKey(imageKey) ?? { index: 0, name: "", url: imageKey, imageUrl: "" }
  return {
    url: page.imageUrl || page.url || imageKey,
    method: "GET",
    data: null,
    headers: {},
    // 第一張圖被擋也會是一筆挑戰：走同一條過盾再重試一次，不然讀者只看到破圖。
    fetch: () => withChallenge(source, () => fetchImage(ref.apkKey, ref.sourceId, page)),
  }
}

/** `engine/images.ts` 的 `onImageLoad` 契約：正文圖一律經 dexvm 拿位元組。 */
export function comicModule(source: InstalledSource): {
  onImageLoad(imageUrl: string, comicId: string, epId: string): Promise<ImageRequest>
} {
  return {
    onImageLoad: async (imageUrl: string) => pageRequestOf(source, imageUrl),
  }
}

// 封面照 Mihon `MangaCoverFetcher`：`GET(thumbnailUrl, source.headers)`，不經 VM 抓圖。
// headers 每個子源只問一次，同一頁的封面因此能並行下載。失敗不快取，下次再問。
const sourceHeaders = new Map<string, Promise<Record<string, string>>>()

function headersOf(source: InstalledSource): Promise<Record<string, string>> {
  const key = source.stored.key
  const hit = sourceHeaders.get(key)
  if (hit) return hit
  const ref = refOf(source)
  const pending = (async () => {
    await ensureExtension(ref.apkKey)
    return await headers(ref.apkKey, ref.sourceId)
  })()
  sourceHeaders.set(key, pending)
  pending.catch(() => {
    if (sourceHeaders.get(key) === pending) sourceHeaders.delete(key)
  })
  return pending
}

export async function coverRequest(source: InstalledSource, url: string): Promise<ImageRequest> {
  try {
    // 封面不包 `mapAsk`：問不到 headers 不該把整個子源標成不可用。
    return { url, method: "GET", data: null, headers: { ...(await headersOf(source)) } }
  } catch (failure) {
    log("warning", "mihon", `${source.stored.key} 的 headers 問不到，封面不帶 headers（${url}）`, failure)
    return { url, method: "GET", data: null, headers: {} }
  }
}
