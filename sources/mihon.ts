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
  sourceQueuedCalls,
  takeSourceChallenge,
  type MihonLoadTimings,
  type SourceChallenge,
  type SourcePriority,
} from "../engine/sourcehost/host"
import { bareHost, deleteCookies, hostOf, setCookies, type Cookie } from "../engine/cookies"
import { solveCloudflare } from "../engine/cloudflare"
import { appDataRoot, ensureDir, exists, join, listDir, readBytes, readText, remove, writeBytes, writeText } from "../engine/fs"
import type { ImageRequest } from "../engine/images"
import { log } from "../engine/log"
import { t } from "../i18n"
import { getContentLanguages } from "../app/contentLanguages"

import * as memo from "./mihonMemo"
import { forgetJar, isEmptyJar, jarWithoutUrl, loadJar, normalizeJar, saveJar } from "./mihonCookies"
import type { MihonFilterState } from "./mihonFilters"
import { prefsFileOf, rootNodesOf, type MihonPreference, type MihonPreferenceValues } from "./mihonPrefs"
import type { StoredSource } from "./store"
import type { InstalledSource } from "./registry"
import type { ComicListItem, ComicListPage } from "../engine/adapt"
import type { ComicDetail, ComicStatus, ExploreEntry } from "./operations"

const PREFIX = "mihon:"

export const SUPPORTED_EXTENSION_LIBS = ["1.4", "1.6"]

const SLOW_OP_TIMEOUT_MS = 30_000
const SLOW_OPS = new Set(["details", "chapters", "pages", "mangaUpdate"])

export function keyOf(packageId: string): string {
  return PREFIX + packageId
}

export function sourceKeyOf(packageId: string, sourceId: string): string {
  return `${PREFIX}${packageId}:${sourceId}`
}

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

export function sourceIdOf(key: string): string | undefined {
  const packageKey = packageKeyOf(key)
  return key === packageKey ? undefined : key.slice(packageKey.length + 1)
}

export function isMihonKey(key: string): boolean {
  return key.startsWith(PREFIX)
}

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

export type MihonPrefs = Record<string, Record<string, unknown>>

export interface MihonLoaded {
  manifest: MihonManifest
  timings: MihonLoadTimings
}

const extensions = new Map<string, { bytes: Uint8Array; prefs: MihonPrefs }>()

const sourceLists = new Map<string, MihonSource[]>()

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure ?? "")
}

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

async function seedJar(apkKey: string): Promise<void> {
  const jar = loadJar(dirOf(apkKey))
  if (isEmptyJar(jar)) return
  try {
    await callMihon(apkKey, "cookies", { import: jar })
  } catch (failure) {
    log("warning", "mihon", `${apkKey} 的 cookie 沒放回 dexvm`, failure)
  }
}

async function persistJar(apkKey: string): Promise<void> {
  if (sourceQueuedCalls(apkKey) > 1) return
  try {
    const raw = await callMihon(apkKey, "cookies", {})
    saveJar(dirOf(apkKey), normalizeJar(raw?.cookies))
  } catch (failure) {
    log("warning", "mihon", `${apkKey} 的 cookie 沒存下來`, failure)
  }
}

async function ensureLoaded(apkKey: string): Promise<void> {
  if (isSourceLoaded(apkKey)) return
  const entry = extensions.get(apkKey)
  if (!entry) throw new Error(`${apkKey} 還沒開啟（先 open 一次）`)
  await loadMihonExtension(entry.bytes, apkKey, entry.prefs)
  await seedJar(apkKey)
}

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
        await seedJar(apkKey)
        return { manifest: loaded.manifest as MihonManifest, timings: loaded.timings }
      },
      priority
    )
  )
}

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
        const result = (await callMihon(apkKey, op, args, opTimeout(op))) as T
        await persistJar(apkKey)
        return result
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

export async function search(
  apkKey: string,
  sourceId: string,
  query: string,
  page = 1,
  filters: MihonFilterState[] = []
): Promise<MihonMangaPage> {
  return await call<MihonMangaPage>(apkKey, "search", { sourceId, query, page, filters })
}


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

export async function chapters(apkKey: string, sourceId: string, manga: MihonManga): Promise<MihonChapter[]> {
  return await call<MihonChapter[]>(apkKey, "chapters", { sourceId, manga })
}

export interface MihonMangaUpdate {
  manga: MihonManga
  chapters: MihonChapter[]
}

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

export async function fetchImage(apkKey: string, sourceId: string, page: MihonPage): Promise<Uint8Array> {
  const bytes = await attemptWithHealing(apkKey, "fetchImage", () =>
    runSourceExclusive(apkKey, async () => {
      await ensureLoaded(apkKey)
      const image = await fetchMihonImage(apkKey, { sourceId, page })
      await persistJar(apkKey)
      return image
    })
  )
  if (bytes.byteLength === 0) throw new Error(t("sources.emptyImage"))
  return bytes
}

export async function clearCookiesFor(apkKey: string, url: string): Promise<number> {
  deleteCookies(apkKey, url)
  const packageId = packageIdOf(apkKey)
  for (const child of installedOf(apkKey).sources ?? []) deleteCookies(sourceKeyOf(packageId, child.id), url)
  return await attemptWithHealing(apkKey, "cookies", () =>
    runSourceExclusive(apkKey, async () => {
      await ensureLoaded(apkKey)
      const raw = await callMihon(apkKey, "cookies", {})
      const { jar, removed } = jarWithoutUrl(normalizeJar(raw?.cookies), url)
      if (removed > 0) await callMihon(apkKey, "cookies", { clear: true, import: jar })
      saveJar(dirOf(apkKey), jar)
      return removed
    })
  )
}

export function isLoaded(apkKey: string): boolean {
  return isSourceLoaded(apkKey)
}

export async function simulateWorkerCrash(apkKey: string): Promise<void> {
  await runSourceExclusive(apkKey, async () => {
    await ensureLoaded(apkKey)
    await probeMihonWorker(apkKey, { case: "trap" })
  })
}

export async function evalJsInWorker(
  apkKey: string,
  src: string
): Promise<{ ok: boolean; value?: unknown; error?: string }> {
  return await runSourceExclusive(apkKey, async () => {
    await ensureLoaded(apkKey)
    return await probeMihonWorker(apkKey, { case: "eval", src })
  })
}

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
  sourceFilters.delete(sourceKey)
}


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
  disabled?: string[]
  schema?: number
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

export function dirOf(key: string): string {
  return join(appDataRoot(), "sources", "mihon", packageIdOf(key))
}

function installedOf(packageKey: string): InstallRecord {
  return readJson(join(dirOf(packageKey), "installed.json")) ?? {}
}

function writeInstalled(packageKey: string, record: InstallRecord): void {
  writeText(join(dirOf(packageKey), "installed.json"), JSON.stringify(record, null, 2))
}

export function languageVisible(lang: string): boolean {
  return getContentLanguages().includes(lang)
}

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


function prefsPath(apkKey: string): string {
  return join(dirOf(apkKey), "prefs.json")
}

export function prefsOf(apkKey: string): MihonPrefs {
  const record = readJson(prefsPath(apkKey))
  return record && typeof record === "object" && !Array.isArray(record) ? (record as MihonPrefs) : {}
}

function savePrefs(apkKey: string, prefs: MihonPrefs): void {
  writeText(prefsPath(apkKey), JSON.stringify(prefs, null, 2))
  const entry = extensions.get(apkKey)
  if (entry) entry.prefs = prefs
}

export interface MihonPreferences {
  nodes: MihonPreference[]
  values: MihonPreferenceValues
}

export async function preferencesOf(source: InstalledSource): Promise<MihonPreferences> {
  const ref = refOf(source)
  return await mapAsk(source, "preferences", async () => {
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


const failures = new Map<string, string>()

let stateListener: (() => void) | null = null

export function setStateListener(listener: (() => void) | null): void {
  stateListener = listener
}

export function failureOf(key: string): string | undefined {
  return failures.get(key)
}

export function clearFailure(key: string): void {
  if (failures.delete(key)) stateListener?.()
}

export function markFailure(key: string, reason: string): void {
  failures.set(key, reason)
  log("error", "mihon", `${key} 已標記為不可用：${reason}`)
  stateListener?.()
}


export interface MihonInstallInfo {
  origin?: string | null
  packageKey?: string
  extensionLib?: string
  iconUrl?: string | null
  version?: string
}

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
  forgetJar(dirOf(packageKey))
  log("info", "mihon", `已移除 ${packageIdOf(packageKey)}`)
}


export interface MihonRef {
  sourceKey: string
  apkKey: string
  sourceId: string
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

export async function ensureExtension(apkKey: string, priority: SourcePriority = "user"): Promise<void> {
  if (extensions.has(apkKey) || isSourceLoaded(apkKey)) return
  const apk = readBytes(join(dirOf(apkKey), "extension.apk"))
  if (!apk) throw new Error(t("sources.mihon.missing"))
  await open(apkKey, apk, prefsOf(apkKey), priority)
}

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


export class MihonVerificationError extends Error {}

const HOST_JAR_CLEARANCE: readonly string[] = ["cf_clearance"]

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
  clearFailure(source.stored.key)
  try {
    return await task()
  } finally {
    takeSourceChallenge(ref.apkKey)
  }
}

async function passChallenge(source: InstalledSource, challenge: SourceChallenge): Promise<Cookie[]> {
  const ref = refOf(source)
  try {
    const cookies = await solveCloudflare(ref.sourceKey, challenge.url, challenge.userAgent, {
      hostJarNames: HOST_JAR_CLEARANCE,
    })
    if (ref.apkKey !== ref.sourceKey) {
      setCookies(ref.apkKey, challenge.url, cookies.filter(cookie => HOST_JAR_CLEARANCE.includes(cookie.name)))
    }
    return cookies
  } catch (failure) {
    log("warning", "mihon", `${ref.sourceKey} 的 Cloudflare 過盾失敗`, failure)
    throw new MihonVerificationError(t("sources.mihon.verification", { reason: messageOf(failure) }))
  }
}

function jarKeyOf(cookie: Cookie, host: string): string {
  const domain = String(cookie.domain ?? "")
  return domain.startsWith(".") ? `.${bareHost(domain.slice(1))}` : host
}

async function deliverClearance(ref: MihonRef, url: string, cookies: Cookie[]): Promise<void> {
  const host = bareHost(hostOf(url))
  const pairs = cookies
    .filter(cookie => cookie.name && host)
    .map(cookie => [jarKeyOf(cookie, host), cookie.name, cookie.value ?? ""])
  if (pairs.length === 0) return
  try {
    await call(ref.apkKey, "cookies", { set: pairs })
  } catch (failure) {
    log("warning", "mihon", `${ref.sourceKey} 的 clearance 沒進 dexvm 的 jar（宿主 jar 仍會補）`, failure)
  }
}

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

type MihonListKind = "popular" | "latest"

function listKinds(apkKey: string, sourceId: string): MihonListKind[] {
  const list = sourceLists.get(apkKey)
  if (!list) return ["popular"]
  const child = list.find(item => item.id === sourceId)
  return child?.supportsLatest === true ? ["popular", "latest"] : ["popular"]
}

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
  page = 1,
  filters: MihonFilterState[] = []
): Promise<ComicListPage> {
  const ref = refOf(source)
  return await mapAsk(source, "search", async () => {
    await ensureExtension(ref.apkKey)
    return toListPage(ref, await search(ref.apkKey, ref.sourceId, keyword, page, filters), page)
  })
}

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

export function mangaArgumentOf(source: InstalledSource, comicId: string): MihonManga {
  const ref = refOf(source)
  return memo.mangaOf(ref.dir, ref.sourceKey, comicId)
}

export function chapterArgumentOf(source: InstalledSource, comicId: string, epId: string): MihonChapter {
  const ref = refOf(source)
  return memo.chapterOf(ref.dir, ref.sourceKey, comicId, epId)
}


const IMAGE_KEY_TAG = "m1"

export function imageKeyOfPage(page: MihonPage, index: number): string {
  return [IMAGE_KEY_TAG, String(index), page.url ?? "", page.imageUrl ?? ""].join("\n")
}

export function isCurrentImageKey(imageKey: string): boolean {
  const parts = imageKey.split("\n")
  return parts.length === 4 && parts[0] === IMAGE_KEY_TAG && /^\d+$/.test(parts[1])
}

export function acceptsImageKeys(imageKeys: string[]): boolean {
  return imageKeys.every(isCurrentImageKey)
}

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

function pageRequestOf(source: InstalledSource, imageKey: string): ImageRequest {
  const ref = refOf(source)
  const page = pageOfImageKey(imageKey) ?? { index: 0, name: "", url: imageKey, imageUrl: "" }
  return {
    url: page.imageUrl || page.url || imageKey,
    method: "GET",
    data: null,
    headers: {},
    fetch: () => withChallenge(source, () => fetchImage(ref.apkKey, ref.sourceId, page)),
  }
}

export function comicModule(source: InstalledSource): {
  onImageLoad(imageUrl: string, comicId: string, epId: string): Promise<ImageRequest>
} {
  return {
    onImageLoad: async (imageUrl: string) => pageRequestOf(source, imageUrl),
  }
}

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
    return { url, method: "GET", data: null, headers: { ...(await headersOf(source)) } }
  } catch (failure) {
    log("warning", "mihon", `${source.stored.key} 的 headers 問不到，封面不帶 headers（${url}）`, failure)
    return { url, method: "GET", data: null, headers: {} }
  }
}


const sourceFilters = new Map<string, Promise<unknown>>()

export function filterDefs(source: InstalledSource): Promise<unknown> {
  const key = source.stored.key
  const hit = sourceFilters.get(key)
  if (hit) return hit
  const ref = refOf(source)
  const pending = attemptWithHealing(ref.apkKey, "filters", async () => {
    await ensureExtension(ref.apkKey)
    return await runSourceExclusive(
      ref.apkKey,
      async () => await callMihon(ref.apkKey, "filters", { sourceId: ref.sourceId })
    )
  })
  sourceFilters.set(key, pending)
  pending.catch(() => {
    if (sourceFilters.get(key) === pending) sourceFilters.delete(key)
  })
  return pending
}
