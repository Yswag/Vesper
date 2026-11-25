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
import { appDataRoot, ensureDir, exists, join, listDir, readText, remove, writeBytes, writeText } from "../engine/fs"
import { log } from "../engine/log"
import { getLocale, t } from "../i18n"

import type { StoredSource } from "./store"
import type { InstalledSource } from "./registry"

const PREFIX = "mihon:"

/** dexvm 目前解得動的 ext-lib。索引沒給這個欄位（舊格式）就不擋。 */
export const SUPPORTED_EXTENSION_LIBS = ["1.4", "1.6"]

/** 章節／頁面／詳情在真實源上就是慢；其餘呼叫維持宿主的 15 秒。 */
const SLOW_OP_TIMEOUT_MS = 30_000
const SLOW_OPS = new Set(["details", "chapters", "pages"])

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

// ---------------------------------------------------------------- 磁碟上的擴充
//
//   <documents>/Vesper/sources/mihon/<packageId>/extension.apk
//   <documents>/Vesper/sources/mihon/<packageId>/installed.json
//
// 一個 apk 的多個語言子源各自是一個 Vesper 源，但共用一份 apk 與一個 worker。
// `installed.json` 記下子源清單（id／名稱／語言／網址）與各自的啟用狀態：啟動列源時
// 不必開 VM，也就沒有「列源要先跑 wasm」這種事。

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
  /** 子源 id → 啟用；安裝當下就把每一個算好寫進來，之後由使用者個別切換。 */
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

/** 子源預設啟用：`all` 一律開，其餘看 App 語言（繁簡中文→zh、英文→en）。 */
function enabledByDefault(lang: string): boolean {
  if (lang === "all") return true
  return lang === (getLocale().startsWith("zh") ? "zh" : "en")
}

/** 一個擴充有多個子源時，名稱後面帶語言——否則源列表會是一排同名。 */
function displayNameOf(child: ChildRecord, total: number): string {
  return total > 1 ? `${child.name} (${child.lang})` : child.name
}

function childSource(packageKey: string, record: InstallRecord, child: ChildRecord, total: number): InstalledSource {
  const key = sourceKeyOf(packageIdOf(packageKey), child.id)
  const name = displayNameOf(child, total)
  const version = String(record.version ?? "")
  const enabled = record.enabled?.[child.id] !== false
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
    meta: { className: "", key, name, version, minAppVersion: "", url: child.baseUrl },
  }
}

/** 磁碟上有哪些擴充（registry 用；不碰網路、不載 VM）。 */
export function installedSources(): InstalledSource[] {
  const out: InstalledSource[] = []
  for (const packageId of listDir(join(appDataRoot(), "sources", "mihon"))) {
    const packageKey = keyOf(packageId)
    const record = installedOf(packageKey)
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

/** 宿主或擴充自己把這個子源弄壞了（票 04 的呼叫路徑用；同一份 self-heal 策略）。 */
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

  const previous = installedOf(packageKey)
  const enabled: Record<string, boolean> = {}
  for (const child of children) {
    const id = String(child.id)
    enabled[id] = previous.enabled?.[id] ?? enabledByDefault(String(child.lang ?? ""))
  }

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
    enabled,
    sources: childRecords,
  }
  writeInstalled(packageKey, record)
  for (const child of children) clearFailure(sourceKeyOf(packageId, String(child.id)))
  log("info", "mihon", `已安裝 ${childRecords.length} 個子源（${packageId} v${record.version}）`)
  return childRecords.map(child => childSource(packageKey, record, child, childRecords.length).stored)
}

/** 停用／啟用一個子源（寫回 `installed.json`；`registry.setSourceEnabled` 會走這裡）。 */
export function setEnabled(key: string, enabled: boolean): void {
  const packageKey = packageKeyOf(key)
  if (!exists(dirOf(packageKey))) return
  const record = installedOf(packageKey)
  const next = { ...(record.enabled ?? {}) }
  const sourceId = sourceIdOf(key)
  if (sourceId !== undefined) next[sourceId] = enabled
  else for (const id of Object.keys(next)) next[id] = enabled
  writeInstalled(packageKey, { ...record, enabled: next })
  clearFailure(key)
}

/** 移除：整個擴充連同所有子源一起刪（`registry.uninstallSource` 會走這裡）。 */
export function uninstall(key: string): void {
  const packageKey = packageKeyOf(key)
  const record = installedOf(packageKey)
  remove(dirOf(packageKey))
  for (const child of record.sources ?? []) clearFailure(sourceKeyOf(packageIdOf(packageKey), child.id))
  clearFailure(packageKey)
  forget(packageKey)
  log("info", "mihon", `已移除 ${packageIdOf(packageKey)}`)
}
