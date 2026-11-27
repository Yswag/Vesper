import type { ComicListItem, ComicListPage } from "../engine/adapt"
import { normalizeTags } from "../engine/adapt"
import {
  callAidoku,
  dropSource,
  forgetSource,
  hasImageProcessorAidoku,
  initializeAidokuSource,
  isSourceHostError,
  isSourceLoaded,
  isSourceWorkerError,
  loadAidokuPackage,
  notifyAidoku,
  processAidokuPageImage,
  resetSourceHost,
  runSourceExclusive,
  setSourceSettingWriter,
  takeSourceChallenge,
  type AidokuImageProcessors,
  type AidokuPackage,
  type AidokuPageImageRequest,
  type SourcePriority,
} from "../engine/sourcehost/host"
import { appDataRoot, exists, join, listDir, readBytes, readText, remove, writeBytes, writeText } from "../engine/fs"
import type { ImageRequest, ImageResponseInfo } from "../engine/images"
import type { SourceViewer } from "../library/readerSettings"
import type { SourceCapabilities, SourceMeta } from "../engine/loader"
import { log } from "../engine/log"
import { solveCloudflare } from "../engine/cloudflare"
import { unzip } from "../engine/zip"
import { t } from "../i18n"
import type { StoredSource } from "./store"
import type {
  ComicDetail,
  ComicStatus,
  ContentRating,
  ExploreEntry,
  HomeChapter,
  HomeChapterEntry,
  HomeComponent,
  HomeFilterItem,
  HomeLink,
  HomeLinkTarget,
  HomeListing,
  SourceHome,
} from "./operations"
import type { InstalledSource } from "./registry"

const PREFIX = "aidoku:"

const SLOW_CALL_TIMEOUT_MS = 30_000

export function keyOf(sourceId: string): string {
  return PREFIX + sourceId
}

export function isAidoku(source: InstalledSource): boolean {
  return source.stored.kind === "aidoku"
}

function idOf(key: string): string {
  return key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key
}


export function dirOf(key: string): string {
  return join(appDataRoot(), "sources", "aidoku", idOf(key))
}

const PAYLOAD_CACHE_LIMIT = 6

export class AidokuPayloadCache {
  private readonly entries = new Map<string, Uint8Array>()
  private readonly limit: number

  constructor(limit: number) {
    this.limit = Math.max(1, limit)
  }

  get(key: string): Uint8Array | undefined {
    const bytes = this.entries.get(key)
    if (!bytes) return undefined
    this.entries.delete(key)
    this.entries.set(key, bytes)
    return bytes
  }

  set(key: string, bytes: Uint8Array): void {
    this.entries.delete(key)
    this.entries.set(key, bytes)
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (oldest === undefined) return
      this.entries.delete(oldest)
    }
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  keys(): string[] {
    return [...this.entries.keys()]
  }
}

export const payloadCache = new AidokuPayloadCache(PAYLOAD_CACHE_LIMIT)

function payloadDir(key: string): string {
  return join(dirOf(key), "Payload")
}

interface InstallRecord {
  origin?: string | null
  version?: string
  installedAt?: number
  enabled?: boolean
  iconUrl?: string | null
  settings?: Record<string, unknown>
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

function installedOf(key: string): InstallRecord {
  return readJson(join(dirOf(key), "installed.json")) ?? {}
}

function writeInstalled(key: string, record: InstallRecord): void {
  writeText(join(dirOf(key), "installed.json"), JSON.stringify(record, null, 2))
}

setSourceSettingWriter((key, name, value) => {
  if (!exists(dirOf(key))) return
  const settings = { ...settingsOf(key) }
  if (value == null) delete settings[name]
  else settings[name] = value
  writeInstalled(key, { ...installedOf(key), settings })
})

function iconOf(key: string, installed: InstallRecord): string | undefined {
  const local = join(payloadDir(key), "icon.png")
  if (exists(local)) return local
  return typeof installed.iconUrl === "string" && installed.iconUrl ? installed.iconUrl : undefined
}

function manifestOf(key: string): any {
  const manifest = readJson(join(payloadDir(key), "source.json"))
  if (!manifest || !exists(join(payloadDir(key), "main.wasm"))) throw new Error(t("sources.aidoku.missing"))
  const info = manifest.info ?? {}
  if (!Array.isArray(info.languages)) {
    const language = info.lang ?? String(info.id ?? "").split(".")[0]
    info.languages = language ? [language] : []
  }
  if (!manifest.filters) {
    const filters = readJson(join(payloadDir(key), "filters.json"))
    if (filters) manifest.filters = filters
  }
  return manifest
}

function readPayload(key: string): AidokuPackage {
  const manifest = manifestOf(key)
  let wasm = payloadCache.get(key)
  if (!wasm) {
    const bytes = readBytes(join(payloadDir(key), "main.wasm"))
    if (!bytes) throw new Error(t("sources.aidoku.missing"))
    wasm = bytes
    payloadCache.set(key, wasm)
  }
  return {
    manifest,
    settingsJson: readJson(join(payloadDir(key), "settings.json")) ?? undefined,
    settings: settingsOf(key),
    wasm,
  }
}

function metaOf(manifest: any, key: string): SourceMeta {
  const info = manifest?.info ?? {}
  return {
    className: "",
    key,
    name: String(info.name ?? key),
    version: String(info.version ?? ""),
    minAppVersion: "",
    url: Array.isArray(info.urls) && info.urls.length > 0 ? String(info.urls[0]) : "",
  }
}

function capabilitiesOf(): SourceCapabilities {
  return {
    search: true,
    explore: true,
    category: false,
    categoryComics: false,
    comic: true,
    account: false,
    favorites: false,
    settings: false,
    comments: false,
    sendComment: false,
    archive: false,
    starRating: false,
    modifyImage: true,
    loginWithPassword: false,
    loginWithWebview: false,
    loginWithCookies: false,
    translation: false,
  }
}

export async function notify(source: InstalledSource, notification: string): Promise<void> {
  try {
    await withHealing(
      source,
      "handleNotification",
      async () => {
        await notifyAidoku(source.stored.key, notification)
      },
      false
    )
  } catch (failure) {
    log("warning", "aidoku", `${source.stored.key} 的 ${notification} 通知失敗`, failure)
  }
}

export function installedSources(): InstalledSource[] {
  const root = join(appDataRoot(), "sources", "aidoku")
  return listDir(root).map(sourceId => {
    const key = keyOf(sourceId)
    const installed = installedOf(key)
    let meta: SourceMeta | undefined
    let error: string | undefined
    try {
      meta = metaOf(manifestOf(key), key)
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure)
    }
    const stored: StoredSource = {
      key,
      kind: "aidoku",
      name: meta?.name ?? sourceId,
      version: meta?.version ?? String(installed.version ?? ""),
      minAppVersion: "",
      homeUrl: meta?.url ?? "",
      origin: installed.origin ?? null,
      installedAt: installed.installedAt ?? 0,
      updatedAt: installed.installedAt ?? 0,
      enabled: installed.enabled !== false,
      iconUrl: iconOf(key, installed),
      settings: settingsOf(key),
    }
    return {
      stored,
      enabled: stored.enabled,
      meta,
      capabilities: capabilitiesOf(),
      error,
      settingsSpec: settingsSpecOf(key),
    }
  })
}

export interface InstallInfo {
  origin?: string | null
  expectedKey?: string
  iconUrl?: string | null
}

export function install(aix: Uint8Array, info: InstallInfo = {}): StoredSource {
  const files = new Map(unzip(aix).map(entry => [entry.name, entry.bytes]))
  const sourceJson = files.get("Payload/source.json")
  const wasm = files.get("Payload/main.wasm")
  if (!sourceJson || !wasm) throw new Error(t("sources.aidoku.invalidPackage"))

  const text = new TextDecoder().decode(sourceJson)
  let manifest: any
  try {
    manifest = JSON.parse(text)
  } catch {
    throw new Error(t("sources.aidoku.invalidPackage"))
  }
  const sourceId = String(manifest?.info?.id ?? "")
  if (!sourceId) throw new Error(t("sources.aidoku.invalidPackage"))

  const key = keyOf(sourceId)
  if (info.expectedKey && key !== info.expectedKey) {
    throw new Error(t("sources.catalog.keyMismatch", { expected: info.expectedKey, actual: key }))
  }

  const dir = payloadDir(key)
  remove(dir)
  writeText(join(dir, "source.json"), text)
  writeBytes(join(dir, "main.wasm"), wasm)
  for (const name of ["settings.json", "filters.json", "icon.png"]) {
    const bytes = files.get(`Payload/${name}`)
    if (bytes) writeBytes(join(dir, name), bytes)
  }

  const previous = installedOf(key)
  const iconUrl = info.iconUrl ?? previous.iconUrl ?? null
  const stored: StoredSource = {
    key,
    kind: "aidoku",
    name: String(manifest.info.name ?? sourceId),
    version: String(manifest.info.version ?? ""),
    minAppVersion: "",
    homeUrl: Array.isArray(manifest.info.urls) && manifest.info.urls.length > 0 ? String(manifest.info.urls[0]) : "",
    origin: info.origin ?? previous.origin ?? null,
    installedAt: previous.installedAt ?? Date.now(),
    updatedAt: Date.now(),
    enabled: previous.enabled !== false,
    iconUrl: iconOf(key, { iconUrl }) ?? undefined,
  }
  const settings = previous.settings
  writeInstalled(key, {
    origin: stored.origin,
    version: stored.version,
    installedAt: stored.installedAt,
    enabled: stored.enabled,
    iconUrl,
    ...(settings && Object.keys(settings).length > 0 ? { settings } : {}),
  })
  log("info", "aidoku", `已安裝 ${stored.name} (${key}) v${stored.version}`)
  clearFailure(key)
  forgetLoaded(key)
  return stored
}

export function setEnabled(key: string, enabled: boolean): void {
  if (!exists(dirOf(key))) return
  writeInstalled(key, { ...installedOf(key), enabled })
  clearFailure(key)
}

export function uninstall(key: string): void {
  remove(dirOf(key))
  clearFailure(key)
  listings.delete(key)
  forgetLoaded(key)
  log("info", "aidoku", `已移除 ${key}`)
}


export type AidokuSettingControl =
  | "select"
  | "multi"
  | "switch"
  | "text"
  | "slider"
  | "stepper"
  | "login"
  | "list"
  | "button"
  | "unsupported"

export interface AidokuSettingOption {
  value: string
  text: string
}

export interface AidokuSettingItem {
  raw: Record<string, unknown>
  key: string
  type: string
  title: string
  subtitle?: string
  placeholder?: string
  secure: boolean
  control: AidokuSettingControl
  options: AidokuSettingOption[]
  multiple: boolean
  indexValue: boolean
  min?: number
  max?: number
  step?: number
  default?: unknown
  refreshes: string[]
  method?: string
  url?: string
  urlKey?: string
  callbackScheme?: string
  tokenUrl?: string
  pkce: boolean
  notification?: string
  localStorageKeys: string[]
  useEmail: boolean
  logoutTitle?: string
  destructive: boolean
  confirmTitle?: string
  confirmText?: string
  inline: boolean
  lineLimit: number
  unsupported?: "login"
}

export interface AidokuSettingGroup {
  title: string
  footer?: string
  fromPage: boolean
  items: AidokuSettingItem[]
}

export interface AidokuSettingsSpec {
  groups: AidokuSettingGroup[]
  defaults: Record<string, unknown>
  count: number
  languages: string[]
  singleLanguage: boolean
  defaultLanguages: string[]
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function isWebLoginMethod(method: string | undefined): boolean {
  return method === "web" || method === "webview"
}

function controlOf(type: string, method: string | undefined): AidokuSettingControl {
  if (type === "select" || type === "picker" || type === "segment") return "select"
  if (type === "multi-select" || type === "multi-single-select") return "multi"
  if (type === "switch") return "switch"
  if (type === "text") return "text"
  if (type === "slider") return "slider"
  if (type === "stepper") return "stepper"
  if (type === "login") return method === "basic" || isWebLoginMethod(method) || method === "oauth" ? "login" : "unsupported"
  if (type === "editable-list") return "list"
  if (type === "button") return "button"
  return "unsupported"
}

function unsupportedOf(type: string, method: string | undefined): AidokuSettingItem["unsupported"] {
  if (type === "login") {
    return method === "basic" || isWebLoginMethod(method) || method === "oauth" ? undefined : "login"
  }
  return undefined
}

function itemOf(node: Record<string, unknown>): AidokuSettingItem | null {
  const type = textOf(node.type)
  if (!type) return null
  const rawValues = Array.isArray(node.values) ? node.values : Array.isArray(node.options) ? node.options : []
  const values = rawValues.map(value => String(value ?? ""))
  const titles = Array.isArray(node.titles) ? node.titles.map(value => String(value ?? "")) : []
  const key = textOf(node.key)
  const method = textOf(node.method) || undefined
  const control = controlOf(type, method)
  const indexValue = type === "segment"
  if (!key && control !== "button" && control !== "unsupported") return null
  return {
    raw: node,
    key,
    type,
    title: textOf(node.title) || key,
    subtitle: textOf(node.subtitle) || undefined,
    placeholder: textOf(node.placeholder) || undefined,
    secure: node.secure === true,
    control,
    options: values.map((value, index) => ({
      value: indexValue ? String(index) : value,
      text: titles[index] || value,
    })),
    multiple: control === "multi",
    indexValue,
    min: numberOf(node.min),
    max: numberOf(node.max),
    step: numberOf(node.step),
    default: indexValue ? (numberOf(node.default) ?? 0) : node.default,
    refreshes: Array.isArray(node.refreshes) ? node.refreshes.map(String) : [],
    method,
    url: textOf(node.url) || undefined,
    urlKey: textOf(node.urlKey) || undefined,
    callbackScheme: textOf(node.callbackScheme) || undefined,
    tokenUrl: textOf(node.tokenUrl) || undefined,
    pkce: node.pkce === true,
    notification: textOf(node.notification) || undefined,
    localStorageKeys: Array.isArray(node.localStorageKeys) ? node.localStorageKeys.map(String).filter(Boolean) : [],
    useEmail: node.useEmail === true,
    logoutTitle: textOf(node.logoutTitle) || undefined,
    destructive: node.destructive === true,
    confirmTitle: textOf(node.confirmTitle) || undefined,
    confirmText: textOf(node.confirmText) || undefined,
    inline: node.inline === true,
    lineLimit: numberOf(node.lineLimit) ?? 0,
    unsupported: unsupportedOf(type, method),
  }
}

function itemsOf(nodes: unknown): AidokuSettingItem[] {
  const out: AidokuSettingItem[] = []
  for (const value of Array.isArray(nodes) ? nodes : []) {
    const node = recordOf(value)
    if (!node) continue
    if (node.type === "group" || node.type === "page") {
      out.push(...itemsOf(node.items))
      continue
    }
    const item = itemOf(node)
    if (item) out.push(item)
  }
  return out
}

export function parseSettingsSpec(schema: unknown): AidokuSettingsSpec {
  const groups: AidokuSettingGroup[] = []
  const defaults: Record<string, unknown> = {}
  let count = 0
  let loose: AidokuSettingItem[] | null = null

  for (const value of Array.isArray(schema) ? schema : []) {
    const node = recordOf(value)
    if (!node) continue
    const type = textOf(node.type)
    if (type === "group" || type === "page") {
      const items = itemsOf(node.items)
      if (items.length === 0) continue
      groups.push({
        title: textOf(node.title),
        footer: textOf(node.footer) || undefined,
        fromPage: type === "page",
        items,
      })
      loose = null
      continue
    }
    const item = itemOf(node)
    if (!item) continue
    if (!loose) {
      loose = []
      groups.push({ title: "", fromPage: false, items: loose })
    }
    loose.push(item)
  }

  for (const group of groups) {
    for (const item of group.items) {
      count += 1
      if (item.key && item.default !== undefined && item.control !== "unsupported") {
        defaults[item.key] = item.default
      }
    }
  }
  return { groups, defaults, count, languages: [], singleLanguage: false, defaultLanguages: [] }
}

function languageSpecOf(manifest: any): Pick<AidokuSettingsSpec, "languages" | "singleLanguage" | "defaultLanguages"> {
  const raw = manifest?.languages ?? manifest?.info?.languages ?? manifest?.config?.languages
  const codes: string[] = []
  const marked: string[] = []
  for (const value of Array.isArray(raw) ? raw : []) {
    const entry = typeof value === "string" ? { code: value } : recordOf(value)
    const code = typeof entry?.code === "string" ? entry.code : ""
    if (!code) continue
    codes.push(code)
    if (entry?.isDefault === true) marked.push(code)
  }
  const selectType =
    manifest?.config?.languageSelectType ?? manifest?.languageSelectType ?? manifest?.info?.languageSelectType
  const single = selectType === "single"
  const defaults = marked.length > 0 ? marked : codes.slice(0, 1)
  return { languages: codes, singleLanguage: single, defaultLanguages: single ? defaults.slice(0, 1) : defaults }
}

export function settingsSpecOf(key: string): AidokuSettingsSpec {
  const spec = parseSettingsSpec(readJson(join(payloadDir(key), "settings.json")))
  let language: Pick<AidokuSettingsSpec, "languages" | "singleLanguage" | "defaultLanguages"> = {
    languages: [],
    singleLanguage: false,
    defaultLanguages: [],
  }
  try {
    language = languageSpecOf(manifestOf(key))
  } catch {
  }
  return { ...spec, ...language }
}

export function settingsOf(key: string): Record<string, unknown> {
  const settings = installedOf(key).settings
  return settings && typeof settings === "object" ? settings : {}
}

export function setSetting(key: string, id: string, value: unknown): void {
  if (!exists(dirOf(key))) return
  const settings = { ...settingsOf(key) }
  if (value === undefined) delete settings[id]
  else settings[id] = value
  writeInstalled(key, { ...installedOf(key), settings })
  forgetLoaded(key)
}

export function loginBasic(key: string, settingKey: string, username: string, password: string): void {
  if (!exists(dirOf(key))) return
  const settings = {
    ...settingsOf(key),
    [`${settingKey}.username`]: username,
    [`${settingKey}.password`]: password,
    [settingKey]: "logged_in",
  }
  writeInstalled(key, { ...installedOf(key), settings })
  forgetLoaded(key)
}

export interface AidokuWebLoginData {
  cookies: Array<{ name: string; value: string }>
  localStorage: Record<string, string>
}

export function loginWebview(key: string, settingKey: string, data: AidokuWebLoginData): void {
  if (!exists(dirOf(key))) return
  const settings = { ...settingsOf(key) }
  for (const name of Object.keys(settings)) {
    if (name.startsWith(`${settingKey}.ls.`)) delete settings[name]
  }
  const cookies = (data.cookies ?? []).filter(cookie => typeof cookie?.name === "string" && cookie.name.length > 0)
  settings[`${settingKey}.keys`] = cookies.map(cookie => cookie.name)
  settings[`${settingKey}.values`] = cookies.map(cookie => String(cookie.value ?? ""))
  const storage = Object.entries(data.localStorage ?? {}).filter(([name]) => name.length > 0)
  for (const [name, value] of storage) settings[`${settingKey}.ls.${name}`] = String(value)
  if (cookies.length > 0 || storage.length > 0) settings[settingKey] = "logged_in"
  else delete settings[settingKey]
  writeInstalled(key, { ...installedOf(key), settings })
  forgetLoaded(key)
}

export function logoutWebview(key: string, settingKey: string): void {
  if (!exists(dirOf(key))) return
  const settings = { ...settingsOf(key) }
  delete settings[`${settingKey}.username`]
  delete settings[`${settingKey}.password`]
  delete settings[`${settingKey}.keys`]
  delete settings[`${settingKey}.values`]
  for (const name of Object.keys(settings)) {
    if (name.startsWith(`${settingKey}.ls.`)) delete settings[name]
  }
  delete settings[settingKey]
  writeInstalled(key, { ...installedOf(key), settings })
  forgetLoaded(key)
}

export function loginOAuth(key: string, settingKey: string, value: string): void {
  if (!exists(dirOf(key))) return
  const settings = { ...settingsOf(key), [settingKey]: value }
  writeInstalled(key, { ...installedOf(key), settings })
  forgetLoaded(key)
}

export function logoutOAuth(key: string, settingKey: string): void {
  if (!exists(dirOf(key))) return
  const settings = { ...settingsOf(key) }
  delete settings[settingKey]
  delete settings[`${settingKey}.codeVerifier`]
  writeInstalled(key, { ...installedOf(key), settings })
  forgetLoaded(key)
}

export function logoutBasic(key: string, settingKey: string): void {
  if (!exists(dirOf(key))) return
  const settings = { ...settingsOf(key) }
  delete settings[`${settingKey}.username`]
  delete settings[`${settingKey}.password`]
  delete settings[settingKey]
  writeInstalled(key, { ...installedOf(key), settings })
  forgetLoaded(key)
}

export function resetSettings(key: string): void {
  if (!exists(dirOf(key))) return
  const { settings: _removed, ...rest } = installedOf(key)
  writeInstalled(key, rest)
  forgetLoaded(key)
}


class AidokuUnavailableError extends Error {}

class SourceLoadError extends Error {}

const failures = new Map<string, string>()

const imageProcessors = new Map<string, AidokuImageProcessors>()

let stateListener: (() => void) | null = null

export function setStateListener(listener: (() => void) | null): void {
  stateListener = listener
}

export function needsImageProcessing(key: string): boolean {
  return imageProcessors.get(key)?.page === true
}

export function needsCoverProcessing(key: string): boolean {
  return imageProcessors.get(key)?.cover === true
}

async function rememberImageProcessor(key: string): Promise<void> {
  const previous = imageProcessors.get(key)
  const flags = await hasImageProcessorAidoku(key)
  if (flags.page === previous?.page && flags.cover === previous?.cover) return
  imageProcessors.set(key, flags)
  stateListener?.()
}

export function failureOf(key: string): string | undefined {
  return failures.get(key)
}

export function clearFailure(key: string): void {
  if (failures.delete(key)) stateListener?.()
}

function markFailure(key: string, reason: string): void {
  failures.set(key, reason)
  log("error", "aidoku", `${key} 已標記為不可用：${reason}`)
  stateListener?.()
}

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure ?? "")
}

function userMessageOf(failure: unknown): string {
  const message = messageOf(failure)
  if (/timed out|timeout/i.test(message)) return t("sources.aidoku.timeout")
  if (/did not become ready|failed to load|worker failed|failed to start/i.test(message)) {
    return t("sources.aidoku.initFailed")
  }
  return message
}

function assertAvailable(key: string): void {
  const reason = failures.get(key)
  if (reason) throw new AidokuUnavailableError(t("sources.aidoku.unavailable", { reason }))
}

const initialized = new Set<string>()

function forgetLoaded(key: string): void {
  listings.delete(key)
  homes.delete(key)
  homeProviders.delete(key)
  imageProcessors.delete(key)
  initialized.delete(key)
  payloadCache.delete(key)
  forgetSource(key)
}

async function initializeGuarded(key: string): Promise<void> {
  try {
    await initializeAidokuSource(key)
  } catch (failure) {
    throw new SourceLoadError(messageOf(failure))
  }
}

async function ensureLoaded(source: InstalledSource): Promise<void> {
  const key = source.stored.key
  if (isSourceLoaded(key)) {
    if (initialized.has(key)) return
    await initializeGuarded(key)
    initialized.add(key)
    return
  }
  const payload = readPayload(key)
  const started = Date.now()
  let loaded: any
  try {
    loaded = await loadAidokuPackage(payload, key)
  } catch (failure) {
    throw new SourceLoadError(messageOf(failure))
  }
  await initializeGuarded(key)
  initialized.add(key)
  rememberHomeProvider(key, loaded?.hasHome === true)
  await rememberImageProcessor(key)
  log("info", "aidoku", `${key} 已載入（${Date.now() - started}ms）`)
}

function shouldHeal(failure: unknown): boolean {
  return isSourceHostError(failure) || failure instanceof SourceLoadError
}

async function withHealing<T>(
  source: InstalledSource,
  step: string,
  task: () => Promise<T>,
  markOnFailure = true,
  priority: SourcePriority = "user"
): Promise<T> {
  const key = source.stored.key
  const attempt = (): Promise<T> =>
    runSourceExclusive(
      key,
      async () => {
        assertAvailable(key)
        await ensureLoaded(source)
        return await task()
      },
      priority
    )
  try {
    return await attempt()
  } catch (failure) {
    if (!shouldHeal(failure)) throw failure
    const scope = isSourceWorkerError(failure) ? `${key} 的 worker` : "宿主頁面"
    log("warning", "aidoku", `${key} 的 ${step} 失敗（${messageOf(failure)}），重建${scope}後重試一次`)
    initialized.delete(key)
    if (isSourceWorkerError(failure)) await dropSource(key)
    else await resetSourceHost()
    try {
      return await attempt()
    } catch (retryFailure) {
      if (markOnFailure) markFailure(key, userMessageOf(retryFailure))
      throw retryFailure
    }
  }
}

function toBytes(value: any): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value)
}

async function processPageImageBytes(
  source: InstalledSource,
  bytes: any,
  request: AidokuPageImageRequest
): Promise<Uint8Array> {
  try {
    return await withHealing(source, "processPageImage", () => processAidokuPageImage(source.stored.key, toBytes(bytes), request), false)
  } catch (failure) {
    if (failure instanceof AidokuUnavailableError) throw failure
    log("error", "aidoku", `${source.stored.key} 的${request.cover ? "封面" : "頁面圖"}處理失敗`, failure)
    throw new Error(t("sources.aidoku.failed", { message: userMessageOf(failure) }))
  }
}

async function call(
  source: InstalledSource,
  method: string,
  args: unknown[] = [],
  timeoutMs?: number,
  priority: SourcePriority = "user"
): Promise<any> {
  const run = () =>
    withHealing(source, method, () => callAidoku(source.stored.key, method, args, timeoutMs), true, priority)
  let value: any
  let failure: unknown = null
  let failed = false
  try {
    value = await run()
  } catch (error) {
    failed = true
    failure = error
  }

  const challenge = takeSourceChallenge(source.stored.key)
  if (!challenge) {
    if (failed) throw failure
    return value
  }

  log("info", "aidoku", `${source.stored.key} 撞到 Cloudflare 挑戰（${challenge.url}），過盾後重試一次`)
  try {
    await solveCloudflare(challenge.sourceKey, challenge.url, challenge.userAgent)
  } catch (solveFailure) {
    log("warning", "aidoku", `${source.stored.key} 的 Cloudflare 過盾失敗`, solveFailure)
    if (failed) throw failure
    throw solveFailure
  }
  clearFailure(source.stored.key)
  try {
    return await run()
  } finally {
    takeSourceChallenge(source.stored.key)
  }
}

async function ask<T>(step: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task()
  } catch (failure) {
    if (failure instanceof AidokuUnavailableError) throw failure
    log("error", "aidoku", `${step} 失敗`, failure)
    throw new Error(t("sources.aidoku.failed", { message: userMessageOf(failure) }))
  }
}


function names(raw: unknown): string {
  return Array.isArray(raw)
    ? raw
        .map(value => String(value ?? "").trim())
        .filter(value => value.length > 0)
        .join(", ")
    : ""
}

const STATUS_BY_CODE: Record<number, ComicStatus> = {
  1: "ongoing",
  2: "completed",
  3: "cancelled",
  4: "hiatus",
  5: "notPublished",
}

const RATING_BY_CODE: Record<number, ContentRating> = {
  0: "safe",
  1: "suggestive",
  2: "nsfw",
}

function statusOf(raw: any): ComicStatus | undefined {
  return STATUS_BY_CODE[Number(raw?.status)]
}

function contentRatingOf(raw: any): ContentRating | undefined {
  return RATING_BY_CODE[Number(raw?.contentRating)]
}

const VIEWER_BY_CODE: Record<number, SourceViewer> = {
  1: "rtl",
  2: "ltr",
  3: "vertical",
  4: "scroll",
}

function viewerOf(raw: any): SourceViewer | undefined {
  return VIEWER_BY_CODE[Number(raw?.viewer)]
}

function toComicItem(raw: any): ComicListItem | null {
  const id = raw?.key ?? raw?.id
  if (id == null || id === "") return null
  return {
    id: String(id),
    title: String(raw.title ?? raw.name ?? t("common.untitled")),
    subtitle: names(raw.authors) || undefined,
    cover: typeof raw.cover === "string" && raw.cover ? raw.cover : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    description: typeof raw.description === "string" && raw.description ? raw.description : undefined,
  }
}

function toListPage(raw: any, page: number): ComicListPage {
  const entries: any[] = Array.isArray(raw?.entries) ? raw.entries : []
  return {
    comics: entries.map(toComicItem).filter((item): item is ComicListItem => item !== null),
    maxPage: raw?.hasNextPage === true ? page + 1 : page,
  }
}

function scanlatorOf(raw: any): string {
  if (Array.isArray(raw?.scanlators)) {
    return raw.scanlators
      .map((value: unknown) => String(value ?? "").trim())
      .filter((value: string) => value.length > 0)
      .join(", ")
  }
  return typeof raw?.scanlator === "string" ? raw.scanlator.trim() : ""
}

function chapterNumberText(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return ""
  return String(parseFloat(value.toPrecision(6)))
}

function chapterTitleOf(raw: any, id: string): string {
  const title = typeof raw?.title === "string" ? raw.title.trim() : ""
  const volume = chapterNumberText(raw?.volumeNumber)
  const number = chapterNumberText(raw?.chapterNumber)
  if (/第\s*[\d.]+\s*[話话回章卷]/.test(title)) return title
  const parts: string[] = []
  if (volume) parts.push(t("sources.aidoku.volume", { n: volume }))
  if (number) parts.push(t("sources.aidoku.chapter", { n: number }))
  if (title) parts.push(title)
  return parts.join(" · ") || id
}

function toChapter(raw: any): { group: string; id: string; title: string; locked: boolean; lang?: string } | null {
  const key = raw?.key ?? raw?.id
  if (key == null || key === "") return null
  const id = String(key)
  const lang = typeof raw?.lang === "string" && raw.lang.trim() ? raw.lang.trim().toLowerCase() : undefined
  return {
    group: scanlatorOf(raw),
    id,
    title: chapterTitleOf(raw, id),
    locked: raw?.locked === true,
    lang,
  }
}

export function search(
  source: InstalledSource,
  keyword: string,
  page = 1,
  filters: unknown[] = []
): Promise<ComicListPage> {
  return ask("search", async () =>
    toListPage(await call(source, "getSearchMangaList", [keyword, page, filters]), page)
  )
}

export function filterDefsOf(key: string): unknown[] {
  const list = manifestOf(key)?.filters
  return Array.isArray(list) ? list : []
}

export async function runtimeFilterDefs(source: InstalledSource): Promise<unknown[]> {
  await ready(source)
  const defs = await ask("filters", async () => await call(source, "getFilters"))
  return Array.isArray(defs) ? defs : []
}

export function detail(source: InstalledSource, comicId: string, background = false): Promise<ComicDetail> {
  const priority: SourcePriority = background ? "background" : "user"
  return ask("detail", async () => {
    const raw = await call(source, "getMangaDetails", [{ key: comicId, id: comicId }], SLOW_CALL_TIMEOUT_MS, priority)
    const mangaId = String(raw?.key ?? raw?.id ?? comicId)
    const chapters = await call(source, "getChapterList", [{ key: mangaId, id: mangaId }], SLOW_CALL_TIMEOUT_MS, priority)
    return {
      id: comicId,
      title: String(raw?.title ?? t("sources.untitled")),
      cover: typeof raw?.cover === "string" && raw.cover ? raw.cover : undefined,
      description: typeof raw?.description === "string" && raw.description ? raw.description : undefined,
      status: statusOf(raw),
      contentRating: contentRatingOf(raw),
      viewer: viewerOf(raw),
      tags: normalizeTags(raw?.tags),
      chapters: (Array.isArray(chapters) ? chapters : [])
        .map(toChapter)
        .filter((chapter): chapter is { group: string; id: string; title: string; locked: boolean; lang?: string } => chapter !== null)
        .reverse(),
      uploader: names(raw?.authors) || undefined,
      artists: names(raw?.artists) || undefined,
      url: typeof raw?.url === "string" && raw.url ? raw.url : undefined,
    }
  })
}

const pageContexts = new Map<string, Record<string, string>>()
const PAGE_CONTEXT_LIMIT = 2000

function pageContextKey(sourceKey: string, url: string): string {
  return `${sourceKey}\n${url}`
}

function rememberPageContext(sourceKey: string, url: string, context: unknown): void {
  if (!context || typeof context !== "object") return
  const entries = Object.entries(context as Record<string, unknown>).filter(([, value]) => value != null)
  if (entries.length === 0) return
  const key = pageContextKey(sourceKey, url)
  pageContexts.delete(key)
  pageContexts.set(key, Object.fromEntries(entries.map(([name, value]) => [name, String(value)])))
  while (pageContexts.size > PAGE_CONTEXT_LIMIT) {
    pageContexts.delete(pageContexts.keys().next().value as string)
  }
}

export async function pages(source: InstalledSource, comicId: string, epId: string): Promise<string[]> {
  const urls = await ask("pages", async () => {
    const raw = await call(
      source,
      "getPageList",
      [{ key: comicId, id: comicId }, { key: epId, id: epId, mangaId: comicId }],
      SLOW_CALL_TIMEOUT_MS
    )
    const list: string[] = []
    for (const page of Array.isArray(raw) ? raw : []) {
      const url = String(page?.url ?? "")
      if (!url) continue
      rememberPageContext(source.stored.key, url, page?.context)
      list.push(url)
    }
    return list
  })
  if (urls.length === 0) throw new Error(t("sources.emptyChapter"))
  return urls
}

export function coverRequest(source: InstalledSource, url: string): Promise<ImageRequest> {
  return buildImageRequest(source, url, false)
}

export function imageRequest(source: InstalledSource, url: string, _chapterId?: string): Promise<ImageRequest> {
  return buildImageRequest(source, url, true)
}

function buildImageRequest(source: InstalledSource, url: string, isPage: boolean): Promise<ImageRequest> {
  return ask("image", async () => {
    const context = isPage ? pageContexts.get(pageContextKey(source.stored.key, url)) ?? null : null
    const raw = await call(source, "modifyImageRequest", [url, context])
    const headers: Record<string, string> = {}
    if (raw?.headers && typeof raw.headers === "object") {
      for (const [name, value] of Object.entries(raw.headers as Record<string, unknown>)) {
        if (value != null) headers[name] = String(value)
      }
    }
    const target = typeof raw?.url === "string" && raw.url ? raw.url : url
    const request: ImageRequest = { url: target, method: "GET", data: null, headers }
    const processing = isPage ? needsImageProcessing(source.stored.key) : needsCoverProcessing(source.stored.key)
    if (processing) {
      request.onResponse = (bytes: any, response?: ImageResponseInfo) =>
        processPageImageBytes(source, bytes, {
          url: target,
          headers,
          context,
          cover: !isPage,
          status: response?.status ?? 200,
          responseHeaders: response?.headers ?? {},
        })
    }
    return request
  })
}

export function comicModule(source: InstalledSource): {
  onImageLoad(imageUrl: string, comicId: string, epId: string): Promise<ImageRequest>
} {
  return {
    onImageLoad: (imageUrl: string, _comicId: string, epId: string) => imageRequest(source, imageUrl, epId),
  }
}


const listings = new Map<string, any[]>()

function staticListingsOf(key: string): any[] {
  const staticListings = manifestOf(key)?.listings
  return Array.isArray(staticListings) ? staticListings : []
}

export function mergeListings(staticListings: any[], dynamicListings: any[]): any[] {
  const merged: any[] = []
  const seen = new Set<string>()
  for (const item of [...staticListings, ...dynamicListings]) {
    if (!item || typeof item !== "object") continue
    const id = item.id == null ? "" : String(item.id)
    if (id) {
      if (seen.has(id)) continue
      seen.add(id)
    }
    merged.push(item)
  }
  return merged
}

export function load(source: InstalledSource): Promise<void> {
  return ask("load", () => withHealing(source, "load", () => ensureLoaded(source)))
}

export function ready(source: InstalledSource): Promise<void> {
  const key = source.stored.key
  return ask("ready", () =>
    withHealing(source, "getListings", async () => {
      if (listings.has(key)) return
      const staticListings = staticListingsOf(key)
      let dynamicListings: any[] = []
      try {
        const raw = await callAidoku(key, "getListings")
        if (Array.isArray(raw)) dynamicListings = raw
      } catch (failure) {
        if (staticListings.length === 0) throw failure
        log("warning", "aidoku", `${key} 的動態 listings 讀不到，只用 manifest 的`, failure)
      }
      listings.set(key, mergeListings(staticListings, dynamicListings))
    })
  )
}

export function explore(source: InstalledSource): ExploreEntry[] {
  return (listings.get(source.stored.key) ?? []).map((item, index) => ({
    index,
    title: String(item?.name ?? item?.title ?? t("sources.exploreFallback", { n: index + 1 })),
    type: "multiPageComicList",
    supportsNext: true,
  }))
}

export function listing(source: InstalledSource, ref: number | HomeListing, page: number): Promise<ComicListPage> {
  return ask("listing", async () => {
    if (typeof ref === "number") {
      const item = listings.get(source.stored.key)?.[ref]
      if (!item) throw new Error(t("sources.unsupported.exploreIndex", { n: ref + 1 }))
      return toListPage(await call(source, "getMangaListForListing", [item, page]), page)
    }
    return toListPage(await call(source, "getMangaListForListing", [ref, page]), page)
  })
}


const HOME_TTL_MS = 10 * 60_000
const homes = new Map<string, { layout: SourceHome; at: number }>()

const homeProviders = new Map<string, boolean>()

export function hasHome(key: string): boolean {
  return homeProviders.get(key) === true
}

function rememberHomeProvider(key: string, value: boolean): void {
  if ((homeProviders.get(key) ?? false) === value) return
  homeProviders.set(key, value)
  stateListener?.()
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

function toHomeListing(raw: any): HomeListing | undefined {
  const id = raw?.id != null ? String(raw.id) : ""
  if (!id) return undefined
  return { id, name: String(raw.name ?? id), kind: optionalNumber(raw.kind) }
}

function toHomeLink(raw: any): HomeLink | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw.value
  let target: HomeLinkTarget | undefined
  if (value?.type === "url" && typeof value.url === "string" && value.url) {
    target = { type: "url", url: value.url }
  } else if (value?.type === "listing") {
    const item = toHomeListing(value.listing)
    if (item) target = { type: "listing", listing: item }
  } else if (value?.type === "manga") {
    const manga = toComicItem(value.manga)
    if (manga) target = { type: "manga", manga }
  } else if (value) {
    log("warning", "aidoku home", `略過不認得的首頁連結種類「${String(value.type)}」`)
  }
  const title = typeof raw.title === "string" ? raw.title : ""
  return {
    title: title || (target?.type === "manga" ? target.manga.title : ""),
    subtitle: optionalText(raw.subtitle),
    imageUrl: optionalText(raw.imageUrl),
    target,
  }
}

function toHomeLinks(raw: unknown): HomeLink[] {
  if (!Array.isArray(raw)) return []
  return raw.map(toHomeLink).filter((link): link is HomeLink => link !== null)
}

function toHomeComics(raw: unknown): ComicListItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map(toComicItem).filter((item): item is ComicListItem => item !== null)
}

function toHomeChapter(raw: any): HomeChapter | undefined {
  const chapter = raw?.chapter
  if (!chapter) return undefined
  const id = chapter.key != null ? String(chapter.key) : ""
  return {
    id,
    title: chapterTitleOf(chapter, id),
    group: optionalText(chapter.scanlator),
    lang: optionalText(chapter.lang)?.toLowerCase(),
    uploadedAt: optionalNumber(chapter.dateUploaded),
  }
}

function toHomeComponent(raw: any, key: string): HomeComponent | null {
  const value = raw?.value ?? {}
  const type = typeof value.type === "string" ? value.type : ""
  const head = { title: optionalText(raw?.title), subtitle: optionalText(raw?.subtitle) }
  switch (type) {
    case "imageScroller":
      return {
        ...head,
        type,
        links: toHomeLinks(value.links),
        autoScrollInterval: optionalNumber(value.autoScrollInterval),
        width: optionalNumber(value.width),
        height: optionalNumber(value.height),
      }
    case "bigScroller":
      return { ...head, type, entries: toHomeComics(value.entries), autoScrollInterval: optionalNumber(value.autoScrollInterval) }
    case "scroller":
      return { ...head, type, entries: toHomeLinks(value.entries), listing: toHomeListing(value.listing) }
    case "mangaList":
      return {
        ...head,
        type,
        ranking: value.ranking === true,
        pageSize: optionalNumber(value.pageSize),
        entries: toHomeLinks(value.entries),
        listing: toHomeListing(value.listing),
      }
    case "mangaChapterList":
      return {
        ...head,
        type,
        pageSize: optionalNumber(value.pageSize),
        entries: (Array.isArray(value.entries) ? value.entries : [])
          .map((entry: any): HomeChapterEntry | null => {
            const manga = toComicItem(entry?.manga)
            return manga ? { manga, chapter: toHomeChapter(entry) } : null
          })
          .filter((entry: HomeChapterEntry | null): entry is HomeChapterEntry => entry !== null),
        listing: toHomeListing(value.listing),
      }
    case "filters":
      return {
        ...head,
        type,
        items: (Array.isArray(value.items) ? value.items : [])
          .map((item: any): HomeFilterItem => ({
            title: String(item?.title ?? ""),
            values: Array.isArray(item?.values) ? (item.values as unknown[]) : undefined,
          }))
          .filter((item: HomeFilterItem) => item.title.length > 0),
      }
    case "links":
      return { ...head, type, links: toHomeLinks(value.links) }
    default:
      log("warning", "aidoku home", `${key} 的首頁有未知的元件種類「${type || "?"}」，略過`)
      return null
  }
}

function toHomeLayout(raw: any, key: string): SourceHome {
  const components = Array.isArray(raw?.components) ? raw.components : []
  return {
    components: components
      .map((component: any) => toHomeComponent(component, key))
      .filter((component: HomeComponent | null): component is HomeComponent => component !== null),
  }
}

export async function home(source: InstalledSource, reload = false): Promise<SourceHome> {
  const key = source.stored.key
  const cached = homes.get(key)
  if (cached && !reload && Date.now() - cached.at < HOME_TTL_MS) return cached.layout
  await load(source)
  if (!hasHome(key)) throw new Error(t("sources.unsupported.home"))

  const started = Date.now()
  const layout = await ask("home", async () =>
    toHomeLayout(await call(source, "getHome", [], SLOW_CALL_TIMEOUT_MS), key)
  )
  homes.set(key, { layout, at: Date.now() })
  log("debug", "home", `${key} → ${layout.components.length} 個元件 (${Date.now() - started}ms)`)
  return layout
}
