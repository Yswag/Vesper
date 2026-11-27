import { clearCookies } from "../engine/cookies"
import { setCloudflareSourceNameLookup } from "../engine/cloudflare"
import { clearCredentials, loadCredentials, saveCredentials } from "../engine/credentials"
import { createEmitter } from "../engine/emitter"
import { maybeGunzip } from "../engine/gzip"
import { log } from "../engine/log"
import { requirePro } from "../engine/pro"
import { createHostContext } from "../engine/host"
import { hostUI } from "../app/hostUI"
import { ensureContentLanguagesFromRepositories, subscribeContentLanguages } from "../app/contentLanguages"
import { extractSettings, loadSource, mergeSettings, type SettingSpec, type SourceCapabilities, type SourceMeta } from "../engine/loader"
import { t } from "../i18n"
import { fetch } from "scripting"

import { catalogBaseOf, compareVersion, indexUrlOf, parseCatalog, resolveEntryUrl, type CatalogEntry } from "./catalog"
import { applyGroupOrder, reorderSourceGroups as reorderGroups } from "./groups"
import * as aidoku from "./aidoku"
import { aidokuIndexSchema, parseAidokuIndex } from "./aidokuIndex"
import * as mihon from "./mihon"
import { loadMihonIndex, mihonIndexSchema } from "./mihonIndex"
import * as repositoryStore from "./repository"
import type { RepositoryKind, RepositoryMeta, StoredRepository } from "./repository"
import * as store from "./store"
import { sourceLocale, sourceText } from "./translation"
import { runWebLogin } from "./webLogin"

export type SourceKind = "venera" | "aidoku" | "mihon"

export interface InstalledSource {
  stored: store.StoredSource
  enabled: boolean
  instance?: any
  meta?: SourceMeta
  capabilities?: SourceCapabilities
  settingsSpecs?: SettingSpec[]
  settingsSpec?: aidoku.AidokuSettingsSpec
  language?: string
  manualDisabled?: boolean
  error?: string
}

let current: InstalledSource[] = []

let revision = 0

export function sourcesRevision(): number {
  return revision
}

const bus = createEmitter({
  onListenerError: error => log("error", "sources", "訂閱者拋錯", error),
})

aidoku.setStateListener(() => sourceStateChanged())
mihon.setStateListener(() => sourceStateChanged())
subscribeContentLanguages(() => reloadMihonSources())

function sourceStateChanged() {
  revision++
  bus.emit()
}

setCloudflareSourceNameLookup(key => {
  const source = findSource(key)
  return source?.meta?.name || source?.stored?.name
})

function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${ms}ms 逾時`)), ms)
    task.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export const subscribeSources = bus.subscribe

export function allSources(): InstalledSource[] {
  return current.map(withFailure)
}

export function sourceKindOf(source: InstalledSource): SourceKind {
  if (aidoku.isAidoku(source)) return "aidoku"
  if (mihon.isMihon(source)) return "mihon"
  return "venera"
}

export function sourceNeedsPro(kind: SourceKind): boolean {
  return kind !== "venera"
}

function failureOfSource(source: InstalledSource): string | undefined {
  if (aidoku.isAidoku(source)) return aidoku.failureOf(source.stored.key)
  if (mihon.isMihon(source)) return mihon.failureOf(source.stored.key)
  return undefined
}

function withFailure(source: InstalledSource): InstalledSource {
  if (!aidoku.isAidoku(source) && !mihon.isMihon(source)) return source
  const reason = failureOfSource(source)
  if (!reason) return source
  return { ...source, error: source.error ?? reason }
}

export function isReady(source: InstalledSource): boolean {
  if (aidoku.isAidoku(source) || mihon.isMihon(source)) {
    return source.error === undefined && failureOfSource(source) === undefined
  }
  return source.instance != null
}

export function enabledSources(): InstalledSource[] {
  return current.filter(source => source.enabled && isReady(source))
}

export function findSource(key: string): InstalledSource | undefined {
  const found = current.find(source => source.stored.key === key)
  return found && withFailure(found)
}

export function reloadRegistry() {
  revision++
  initTasks.clear()
  ensureContentLanguagesFromRepositories()
  current = applyGroupOrder([...store.listSources().map(loadVenera), ...aidoku.installedSources(), ...mihon.installedSources()])
  bus.emit()
}

export function reloadMihonSources() {
  if (!current.some(source => mihon.isMihon(source))) return
  const others = current.filter(source => !mihon.isMihon(source))
  current = applyGroupOrder([...others, ...mihon.installedSources()])
  revision++
  bus.emit()
}

const veneraLoads = new Map<string, number>()

export function debugSourceLoads(): { total: number; byKey: Record<string, number> } {
  const byKey: Record<string, number> = {}
  let total = 0
  for (const [key, count] of veneraLoads) {
    byKey[key] = count
    total += count
  }
  return { total, byKey }
}

function buildSource(key: string): InstalledSource | undefined {
  const raw = store.getSource(key)
  if (raw) return loadVenera(raw)
  return [...aidoku.installedSources(), ...mihon.installedSources()].find(entry => entry.stored.key === key)
}

export function reloadSource(key: string) {
  const index = current.findIndex(entry => entry.stored.key === key)
  const rebuilt = buildSource(key)
  if (!rebuilt) {
    if (index < 0) return
    current = current.filter(entry => entry.stored.key !== key)
  } else if (index >= 0) {
    current = current.map((entry, at) => (at === index ? rebuilt : entry))
  } else {
    reloadRegistry()
    return
  }
  initTasks.delete(key)
  revision++
  bus.emit()
}

function loadVenera(rawEntry: store.StoredSource): InstalledSource {
  let entry = rawEntry
  const enabled = entry.enabled
  veneraLoads.set(entry.key, (veneraLoads.get(entry.key) ?? 0) + 1)
  const code = store.getSourceCode(entry.key)
  if (!code) {
    return { stored: entry, enabled, error: t("sources.codeMissing") }
  }
  try {
    const loaded = loadSource(
      code,
      createHostContext(entry.key, {
        settings: entry.settings ?? {},
        locale: sourceLocale(),
        loggedIn: entry.loggedIn === true,
        ui: hostUI,
      })
    )
    const { defaults, specs } = extractSettings(loaded.instance, text => sourceText(loaded.instance, text))
    const merged = mergeSettings(defaults, entry.settings)
    if (JSON.stringify(merged) !== JSON.stringify(entry.settings ?? {})) {
      store.updateSettings(entry.key, merged)
      entry = { ...entry, settings: merged }
    }
    return {
      stored: entry,
      enabled,
      instance: loaded.instance,
      meta: loaded.meta,
      capabilities: loaded.capabilities,
      settingsSpecs: specs,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log("error", "sources", `載入 ${entry.key} 失敗`, message)
    return { stored: entry, enabled, error: message }
  }
}

export function setSourceEnabled(key: string, enabled: boolean) {
  const source = findSource(key)
  if (source && aidoku.isAidoku(source)) aidoku.setEnabled(key, enabled)
  else if (source && mihon.isMihon(source)) mihon.setEnabled(key, enabled)
  else store.setEnabled(key, enabled)
  reloadSource(key)
}

export function reorderSources(keys: string[]): boolean {
  if (!store.reorderSources(keys)) return false
  const byKey = new Map(current.map(entry => [entry.stored.key, entry]))
  const ordered: InstalledSource[] = []
  for (const key of keys) {
    const entry = byKey.get(key)
    if (!entry) continue
    ordered.push(entry)
    byKey.delete(key)
  }
  for (const entry of current) {
    if (byKey.has(entry.stored.key)) ordered.push(entry)
  }
  if (ordered.length === current.length) current = ordered
  bus.emit()
  return true
}

export function reorderSourceGroups(ids: string[]): boolean {
  if (!reorderGroups(current, ids)) return false
  current = applyGroupOrder(current)
  bus.emit()
  return true
}

const initTasks = new Map<string, Promise<void>>()

export function ensureSourceReady(key: string): Promise<void> {
  const existing = initTasks.get(key)
  if (existing) return existing
  const source = findSource(key)
  const task = (async () => {
    if (!source?.instance) return
    try {
      if (typeof source.instance.init === "function") {
        await withTimeout(Promise.resolve(source.instance.init()), 15000)
      }
    } catch (error) {
      log("warning", "sources", `${key} 的 init() 失敗（源還是可以用，只是可能缺前置資料）`, error)
    }
  })()
  initTasks.set(key, task)
  return task
}

export function updateSourceSetting(key: string, id: string, value: unknown) {
  const source = findSource(key)
  const next = { ...(source?.stored.settings ?? {}), [id]: value }
  store.updateSettings(key, next)
  reloadSource(key)
}

export function hasAidokuSettings(source: InstalledSource): boolean {
  return (
    aidoku.isAidoku(source) &&
    ((source.settingsSpec?.count ?? 0) > 0 || (source.settingsSpec?.languages.length ?? 0) > 1)
  )
}

export function hasMihonSettings(source: InstalledSource): boolean {
  return mihon.isMihon(source) && !source.error
}

export function updateAidokuSetting(key: string, id: string, value: unknown) {
  aidoku.setSetting(key, id, value)
  reloadSource(key)
}

export function loginAidokuBasic(key: string, settingKey: string, username: string, password: string) {
  aidoku.loginBasic(key, settingKey, username, password)
  reloadSource(key)
}

export function logoutAidokuBasic(key: string, settingKey: string) {
  aidoku.logoutBasic(key, settingKey)
  reloadSource(key)
}

export function loginAidokuWebview(key: string, settingKey: string, data: aidoku.AidokuWebLoginData) {
  aidoku.loginWebview(key, settingKey, data)
  reloadSource(key)
}

export function logoutAidokuWebview(key: string, settingKey: string) {
  aidoku.logoutWebview(key, settingKey)
  reloadSource(key)
}

export function loginAidokuOAuth(key: string, settingKey: string, value: string) {
  aidoku.loginOAuth(key, settingKey, value)
  reloadSource(key)
}

export function logoutAidokuOAuth(key: string, settingKey: string) {
  aidoku.logoutOAuth(key, settingKey)
  reloadSource(key)
}

export async function notifyAidokuSource(key: string, notification: string) {
  const source = findSource(key)
  if (!source) return
  await aidoku.notify(source, notification)
}

export function resetAidokuSettings(key: string) {
  aidoku.resetSettings(key)
  reloadSource(key)
}

export function resetSourceSetting(key: string, id: string) {
  const source = findSource(key)
  const spec = source?.settingsSpecs?.find(item => item.id === id)
  if (!spec || spec.default === undefined) return
  updateSourceSetting(key, id, spec.default)
}

export async function runSourceSettingCallback(key: string, id: string): Promise<void> {
  await ensureSourceReady(key)
  const source = findSource(key)
  const callback = source?.instance?.settings?.[id]?.callback
  if (typeof callback !== "function") throw new Error(t("sources.settingNoAction"))
  await callback.call(source?.instance)
}

export function uninstallSource(key: string) {
  const source = findSource(key)
  if (source && aidoku.isAidoku(source)) aidoku.uninstall(key)
  else if (source && mihon.isMihon(source)) mihon.uninstall(key)
  else if (mihon.isMihonKey(key)) mihon.uninstall(key)
  else store.removeSource(key)
  log("info", "sources", `已移除源 ${key}`)
  reloadRegistry()
}

export interface InstallResult {
  key: string
  name: string
  version: string
  updated: boolean
}

export function installSourceCode(code: string, origin: string | null, expectedKey?: string): InstallResult {
  const probe = loadSource(code, createHostContext("probe", { settings: {} }))
  if (expectedKey && probe.meta.key !== expectedKey) {
    throw new Error(t("sources.catalog.keyMismatch", { expected: expectedKey, actual: probe.meta.key }))
  }
  const existed = store.hasSource(probe.meta.key)
  const { defaults } = extractSettings(probe.instance)
  const settings = mergeSettings(defaults, store.getSource(probe.meta.key)?.settings)
  store.saveSource(
    {
      key: probe.meta.key,
      name: probe.meta.name,
      version: probe.meta.version,
      minAppVersion: probe.meta.minAppVersion,
      homeUrl: probe.meta.url,
      origin,
      settings,
    },
    code
  )
  reloadRegistry()
  log("info", "sources", `${existed ? "已更新" : "已安裝"} ${probe.meta.name} v${probe.meta.version}`)
  return { key: probe.meta.key, name: probe.meta.name, version: probe.meta.version, updated: existed }
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { timeout: 30, allowInsecureRequest: true } as any)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(t("sources.catalog.downloadFailed", { status: response.status }))
  }
  return await response.text()
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { timeout: 60, allowInsecureRequest: true } as any)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(t("sources.catalog.downloadFailed", { status: response.status }))
  }
  return new Uint8Array(await response.arrayBuffer())
}

export interface ImportReport {
  installed: InstallResult[]
  skipped: Array<{ key: string; name: string; reason: string }>
}

export async function installCatalog(entries: CatalogEntry[], catalogUrl: string | null): Promise<ImportReport> {
  const installed: InstallResult[] = []
  const skipped: Array<{ key: string; name: string; reason: string }> = []
  const seen = new Set<string>()

  for (const entry of entries) {
    if (seen.has(entry.key)) {
      skipped.push({ key: entry.key, name: entry.name, reason: t("sources.catalog.duplicateSkipped") })
      continue
    }
    seen.add(entry.key)
    try {
      const sourceUrl = entry.url ?? (catalogUrl ? resolveEntryUrl(entry, catalogBaseOf(catalogUrl)) : null)
      if (!sourceUrl) throw new Error(t("sources.catalog.relativeOnly"))
      const code = await fetchText(sourceUrl)
      installed.push(installSourceCode(code, catalogUrl ?? sourceUrl, entry.key))
    } catch (error) {
      skipped.push({ key: entry.key, name: entry.name, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return { installed, skipped }
}

function catalogEmptyError(rejected: Array<{ reason: string }>): string {
  return rejected.length > 0
    ? t("sources.catalog.emptyWithReason", { reason: rejected[0].reason })
    : t("sources.catalog.empty")
}

export async function importPasted(text: string, catalogUrl: string | null): Promise<ImportReport> {
  const trimmed = text.trim()
  if (trimmed.startsWith("[")) {
    const { entries, rejected } = parseCatalog(JSON.parse(trimmed))
    if (entries.length === 0) {
      throw new Error(catalogEmptyError(rejected))
    }
    const report = await installCatalog(entries, catalogUrl)
    for (const bad of rejected) {
      report.skipped.push({ key: `#${bad.index}`, name: t("sources.catalog.entryLabel"), reason: bad.reason })
    }
    return report
  }
  if (trimmed.startsWith("{")) {
    throw new Error(t("sources.catalog.singleObject"))
  }
  return { installed: [installSourceCode(trimmed, catalogUrl)], skipped: [] }
}

export async function importFromUrl(url: string): Promise<ImportReport> {
  return importPasted(await fetchText(url), url)
}

export function installManualSource(text: string, origin: string | null): InstallResult {
  const trimmed = text.trim()
  if (trimmed.startsWith("[")) throw new Error(t("sources.catalog.isRepository"))
  return installSourceCode(trimmed, origin)
}


function detectRepositoryKind(raw: unknown): RepositoryKind {
  if (mihonIndexSchema(raw) !== null) return "mihon-index"
  if (aidokuIndexSchema(raw) === "community") return "aidoku-index"
  if (Array.isArray(raw)) {
    const records = raw
      .slice(0, 20)
      .filter(item => item && typeof item === "object") as Array<Record<string, unknown>>
    if (records.some(item => typeof item.key === "string")) return "venera"
    if (records.some(item => typeof item.id === "string" && (item.downloadURL != null || item.file != null))) {
      return "aidoku-index"
    }
  }
  return "venera"
}

interface LoadedIndex {
  kind: RepositoryKind
  entries: CatalogEntry[]
  name?: string
  meta?: RepositoryMeta
}

async function fetchIndexBody(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { timeout: 60, allowInsecureRequest: true } as any)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(t("sources.catalog.downloadFailed", { status: response.status }))
  }
  return maybeGunzip(new Uint8Array(await response.arrayBuffer()))
}

function parseIndexBody(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body))
  } catch {
    throw new Error(t("sources.catalog.repositoryNotArray"))
  }
}

function kindOfBody(body: Uint8Array): RepositoryKind {
  const first = body[0]
  if (first !== 0x5b && first !== 0x7b) return "mihon-index"
  return detectRepositoryKind(parseIndexBody(body))
}

async function loadIndex(url: string, kind?: RepositoryKind): Promise<LoadedIndex> {
  const target = indexUrlOf(url)
  const body = await fetchIndexBody(target)
  const resolved = kind ?? kindOfBody(body)

  if (resolved === "mihon-index") {
    const loaded = await loadMihonIndex(target, body)
    if (loaded.entries.length === 0) throw new Error(catalogEmptyError(loaded.rejected))
    return { kind: resolved, entries: loaded.entries, name: loaded.name, meta: loaded.meta }
  }

  const parsed = parseIndexBody(body)
  const base = catalogBaseOf(target)

  if (resolved === "aidoku-index") {
    const { entries, rejected, name } = parseAidokuIndex(parsed, base)
    if (entries.length === 0) throw new Error(catalogEmptyError(rejected))
    return { kind: resolved, entries, name }
  }

  const { entries, rejected } = parseCatalog(parsed)
  if (entries.length === 0) throw new Error(catalogEmptyError(rejected))
  return { kind: resolved, entries }
}

export async function addRepository(url: string, kind?: RepositoryKind): Promise<StoredRepository> {
  const target = url.trim()
  if (!target) throw new Error(t("sources.repository.urlRequired"))
  const existing = repositoryStore.getRepository(target)
  const loaded = await loadIndex(target, kind ?? existing?.kind)
  const now = Date.now()
  const repository: StoredRepository = {
    url: target,
    kind: loaded.kind,
    name: loaded.name ?? existing?.name ?? repositoryStore.repositoryNameFor(target),
    addedAt: existing?.addedAt ?? now,
    fetchedAt: now,
    entries: loaded.entries,
  }
  if (loaded.meta) repository.meta = loaded.meta
  repositoryStore.saveRepository(repository)
  log("info", "sources", `已加入倉庫 ${repository.name}（${loaded.entries.length} 個源）`)
  return repository
}

export async function refreshRepository(url: string): Promise<StoredRepository> {
  const existing = repositoryStore.getRepository(url)
  if (!existing) throw new Error(t("sources.repository.notFound"))
  try {
    return await addRepository(url)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    repositoryStore.saveRepository({ ...existing, error: message })
    log("warning", "sources", `倉庫 ${existing.name} 重新整理失敗`, message)
    throw error
  }
}

export function removeRepository(url: string) {
  repositoryStore.removeRepository(url)
  log("info", "sources", `已移除倉庫 ${url}`)
}

export interface RepositoryEntryStatus {
  entry: CatalogEntry
  installed?: InstalledSource
  fromThisRepo: boolean
  updateAvailable: boolean
}

export function entryUnsupportedReason(entry: CatalogEntry): string | null {
  if (!mihon.isMihonKey(entry.key)) return null
  if (mihon.isSupportedExtensionLib(entry.extensionLib)) return null
  return t("sources.mihon.unsupportedLib", { version: entry.extensionLib ?? "" })
}

function installedOfEntry(entry: CatalogEntry, sources: InstalledSource[] = allSources()): InstalledSource | undefined {
  if (mihon.isMihonKey(entry.key)) {
    return sources.find(source => mihon.isMihon(source) && mihon.packageKeyOf(source.stored.key) === entry.key)
  }
  return findSource(entry.key)
}

export function repositoryEntries(repositoryUrl: string): RepositoryEntryStatus[] {
  const repository = repositoryStore.getRepository(repositoryUrl)
  if (!repository) return []
  const sources = allSources()
  return repository.entries.map(entry => {
    const installed = installedOfEntry(entry, sources)
    const installedVersion = installed?.meta?.version ?? installed?.stored.version
    const fromThisRepo = Boolean(installed && repositoryStore.isFromRepository(installed.stored.origin, repository.url))
    return {
      entry,
      installed,
      fromThisRepo,
      updateAvailable: fromThisRepo && Boolean(installedVersion && compareVersion(entry.version, installedVersion) > 0),
    }
  })
}

export async function installRepositoryEntry(repositoryUrl: string, key: string): Promise<InstallResult> {
  const repository = repositoryStore.getRepository(repositoryUrl)
  if (!repository) throw new Error(t("sources.repository.notFound"))
  const entry = repository.entries.find(item => item.key === key)
  if (!entry) throw new Error(t("sources.repository.entryNotFound"))

  if (repositoryStore.kindOf(repository) === "aidoku-index") {
    requirePro("aidoku")
    if (!entry.url) throw new Error(t("sources.catalog.relativeOnly"))
    const existed = findSource(entry.key) !== undefined
    const aix = await fetchBytes(entry.url)
    const stored = aidoku.install(aix, { origin: repository.url, expectedKey: entry.key, iconUrl: entry.iconUrl })
    reloadRegistry()
    log("info", "sources", `${existed ? "已更新" : "已安裝"} ${stored.name} v${stored.version}`)
    return { key: stored.key, name: stored.name, version: stored.version, updated: existed }
  }

  if (repositoryStore.kindOf(repository) === "mihon-index") {
    requirePro("mihon")
    const unsupported = entryUnsupportedReason(entry)
    if (unsupported) throw new Error(unsupported)
    if (!entry.url) throw new Error(t("sources.catalog.relativeOnly"))
    const existed = installedOfEntry(entry) !== undefined
    const apk = await fetchBytes(entry.url)
    const children = await mihon.install(apk, {
      origin: repository.url,
      packageKey: entry.key,
      extensionLib: entry.extensionLib,
      iconUrl: entry.iconUrl,
      version: entry.version,
    })
    reloadRegistry()
    const version = children[0]?.version || entry.version
    log("info", "sources", `${existed ? "已更新" : "已安裝"} ${entry.name} v${version}（${children.length} 個子源）`)
    return { key: entry.key, name: entry.name, version, updated: existed }
  }

  const sourceUrl = entry.url ?? resolveEntryUrl(entry, catalogBaseOf(repository.url))
  const code = await fetchText(sourceUrl)
  return installSourceCode(code, repository.url, entry.key)
}


export interface AccountSpec {
  supportsPassword: boolean
  cookieFields: string[]
  webviewUrl?: string
  registerUrl?: string
}

export function accountSpec(source: InstalledSource): AccountSpec | null {
  const account = source.instance?.account
  if (!account || typeof account !== "object") return null
  const cookies = account.loginWithCookies
  const webview = account.loginWithWebview
  return {
    supportsPassword: typeof account.login === "function",
    cookieFields: Array.isArray(cookies?.fields) ? cookies.fields.map(String) : [],
    webviewUrl: typeof webview?.url === "string" && webview.url ? webview.url : undefined,
    registerUrl: typeof account.registerWebsite === "string" ? account.registerWebsite : undefined,
  }
}

export async function loginWithPassword(key: string, account: string, password: string): Promise<void> {
  const source = findSource(key)
  if (!source?.instance) throw new Error(t("sources.notLoadedShort"))
  const login = source.instance.account?.login
  if (typeof login !== "function") throw new Error(t("sources.unsupported.account"))
  await login.call(source.instance, account, password)
  saveCredentials(key, { account, password })
  store.setAccount(key, { loggedIn: true, accountName: account })
  reloadSource(key)
  log("info", "account", `${key} 已登入（${account}）`)
}

export async function loginWithCookies(key: string, values: string[]): Promise<void> {
  const source = findSource(key)
  const spec = source?.instance?.account?.loginWithCookies
  if (!spec) throw new Error(t("sources.unsupported.cookie"))
  const valid = typeof spec.validate === "function" ? await spec.validate(values) : true
  if (!valid) throw new Error(t("sources.login.validateFailed"))
  saveCredentials(key, { cookies: values })
  store.setAccount(key, { loggedIn: true })
  reloadSource(key)
  log("info", "account", `${key} 已登入（cookie 欄位）`)
}

export async function loginWithWebview(key: string): Promise<string> {
  const source = findSource(key)
  if (!source?.instance) throw new Error(t("sources.notLoadedShort"))
  const spec = source.instance.account?.loginWithWebview
  const url = typeof spec?.url === "string" ? spec.url : ""
  if (!url) throw new Error(t("sources.unsupported.browser"))

  const result = await runWebLogin({
    sourceKey: key,
    sourceName: source.meta?.name || source.stored.name,
    spec: {
      url,
      checkStatus: typeof spec.checkStatus === "function" ? (current, title) => spec.checkStatus.call(source.instance, current, title) : undefined,
      onLoginSuccess: typeof spec.onLoginSuccess === "function" ? () => spec.onLoginSuccess.call(source.instance) : undefined,
    },
  })

  if (result.outcome === "cancelled") return t("sources.login.cancelled")
  store.setAccount(key, { loggedIn: true, accountName: t("sources.login.webAccount") })
  reloadSource(key)
  log("info", "account", `${key} 已登入（瀏覽器，${result.cookies} 個 cookie）`)
  return result.outcome === "manual" ? t("sources.login.cookiesSaved", { count: result.cookies }) : t("sources.login.done")
}

export async function logoutSource(key: string): Promise<void> {
  const source = findSource(key)
  const instance = source?.instance
  try {
    const logout = instance?.account?.logout
    if (typeof logout === "function") await logout.call(instance)
  } catch (error) {
    log("warning", "account", `${key} 的 logout() 失敗`, error)
  }
  clearCredentials(key)
  clearCookies(key)
  store.setAccount(key, { loggedIn: false })
  reloadSource(key)
}


export type ReloginOutcome = "ok" | "failed" | "no-credentials"

function syncStoredAccount(source: InstalledSource) {
  source.stored = store.getSource(source.stored.key) ?? source.stored
  revision++
}

export async function reloginSource(source: InstalledSource): Promise<ReloginOutcome> {
  const account = source.instance?.account
  if (!account) return "no-credentials"
  const credentials = loadCredentials(source.stored.key)
  if (!credentials) return "no-credentials"

  try {
    if (credentials.account && credentials.password && typeof account.login === "function") {
      await account.login.call(source.instance, credentials.account, credentials.password)
      store.setAccount(source.stored.key, { loggedIn: true, accountName: credentials.account })
      syncStoredAccount(source)
      log("info", "account", `${source.stored.key} 登入過期，已用帳密自動重登`)
      return "ok"
    }
    const validate = account.loginWithCookies?.validate
    if (credentials.cookies?.length && typeof validate === "function") {
      const valid = await validate.call(source.instance, credentials.cookies)
      if (!valid) return "failed"
      store.setAccount(source.stored.key, { loggedIn: true })
      syncStoredAccount(source)
      log("info", "account", `${source.stored.key} 登入過期，已用 cookie 自動重登`)
      return "ok"
    }
    return "no-credentials"
  } catch (error) {
    log("warning", "account", `${source.stored.key} 自動重登失敗`, error)
    return "failed"
  }
}

export { parseCatalog, resolveEntryUrl, catalogBaseOf }
export type { CatalogEntry }
