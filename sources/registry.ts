// 來源執行期註冊中心：載入漫畫源沙箱實例，管理生命週期並對外廣播變更。
// 單一真相源為 Storage（store.ts）。

import { clearCookies } from "../engine/cookies"
import { clearCredentials, loadCredentials, saveCredentials } from "../engine/credentials"
import { createEmitter } from "../engine/emitter"
import { log } from "../engine/log"
import { createHostContext } from "../engine/host"
import { hostUI } from "../app/hostUI"
import { extractSettings, loadSource, mergeSettings, type SettingSpec, type SourceCapabilities, type SourceMeta } from "../engine/loader"
import { t } from "../i18n"
import { fetch } from "scripting"

import { catalogBaseOf, compareVersion, indexUrlOf, parseCatalog, resolveEntryUrl, type CatalogEntry } from "./catalog"
import * as aidoku from "./aidoku"
import { aidokuIndexSchema, parseAidokuIndex } from "./aidokuIndex"
import * as repositoryStore from "./repository"
import type { RepositoryKind, StoredRepository } from "./repository"
import * as store from "./store"
import { runWebLogin } from "./webLogin"

export type SourceKind = "venera" | "aidoku"

export interface InstalledSource {
  stored: store.StoredSource
  enabled: boolean
  /** 載入失敗時為 undefined，原因記在 error。 */
  instance?: any
  meta?: SourceMeta
  capabilities?: SourceCapabilities
  /** Venera 源宣告的設定項。 */
  settingsSpecs?: SettingSpec[]
  /** Aidoku 源的 `settings.json`（順序與原欄位都保留）；沒有這個檔就是空的。 */
  settingsSpec?: aidoku.AidokuSettingsSpec
  error?: string
}

let current: InstalledSource[] = []

/**
 * 來源視圖版本號：在 reloadRegistry 或更新登入狀態時遞增，供外部快取判定失效。
 */
let revision = 0

/** 目前這一份視圖的版本號（見 revision）。 */
export function sourcesRevision(): number {
  return revision
}

const bus = createEmitter({
  onListenerError: error => log("error", "sources", "訂閱者拋錯", error),
})

/** Aidoku 源在執行期被標成不可用時，讓畫面跟著更新。 */
aidoku.setStateListener(() => bus.emit())

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

/** 畫面要顯示來源類型時走這裡，不必知道 Aidoku 的內部形狀。 */
export function sourceKindOf(source: InstalledSource): SourceKind {
  return aidoku.isAidoku(source) ? "aidoku" : "venera"
}

/** 執行期被標成不可用的 Aidoku 源：錯誤要能被畫面讀到。 */
function withFailure(source: InstalledSource): InstalledSource {
  if (!aidoku.isAidoku(source)) return source
  const reason = aidoku.failureOf(source.stored.key)
  if (!reason) return source
  return { ...source, error: source.error ?? reason }
}

/** 這個源現在能不能用（Venera 要載入成功，Aidoku 要在磁碟上、沒壞、也沒被標成不可用）。 */
export function isReady(source: InstalledSource): boolean {
  if (aidoku.isAidoku(source)) {
    return source.error === undefined && aidoku.failureOf(source.stored.key) === undefined
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

/** 從盤上重新載入全部源。啟動時呼叫一次，匯入/刪除後再呼叫。 */
export function reloadRegistry() {
  revision++
  initTasks.clear()
  current = [...store.listSources().map(loadVenera), ...aidoku.installedSources()]
  bus.emit()
}

/** Venera 源：原始碼在 store 裡，這裡建沙箱實例。 */
function loadVenera(rawEntry: store.StoredSource): InstalledSource {
  let entry = rawEntry
  const enabled = entry.enabled
  const code = store.getSourceCode(entry.key)
  if (!code) {
    return { stored: entry, enabled, error: t("sources.codeMissing") }
  }
  try {
    const loaded = loadSource(
      code,
      createHostContext(entry.key, {
        settings: entry.settings ?? {},
        loggedIn: entry.loggedIn === true,
        ui: hostUI,
      })
    )
    const { defaults, specs } = extractSettings(loaded.instance)
    // 回填：自動補齊宣告的預設設定值
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
  else store.setEnabled(key, enabled)
  reloadRegistry()
}

/**
 * 拖曳排序：更新已安裝來源的順序並廣播變更（不重建沙箱實例與 revision）。
 */
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

const initTasks = new Map<string, Promise<void>>()

/**
 * 確保來源的 init() 異步初始化已執行（按需觸發，共用 Promise 不重複發起）。
 */
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

/**
 * 改一個設定值。寫回 index.json 後重建實例，所以源下次被用到時會用新設定重跑 init()。
 * 這對自架類的源（komga / kavita / lanraragi 的伺服器位址）是能不能用的前提。
 */
export function updateSourceSetting(key: string, id: string, value: unknown) {
  const source = findSource(key)
  const next = { ...(source?.stored.settings ?? {}), [id]: value }
  store.updateSettings(key, next)
  reloadRegistry()
}

/** 源詳情要不要顯示「源設定」列：Aidoku 源的 schema 非空。 */
export function hasAidokuSettings(source: InstalledSource): boolean {
  return aidoku.isAidoku(source) && (source.settingsSpec?.count ?? 0) > 0
}

/**
 * 改一個 Aidoku 源的設定值：寫進 `installed.json` 的 `settings`，並讓源下次呼叫時重載。
 * 只寫改過的 key（沒有的就是 schema 預設）。
 */
export function updateAidokuSetting(key: string, id: string, value: unknown) {
  aidoku.setSetting(key, id, value)
  reloadRegistry()
}

/** Aidoku 源的 `method: "basic"` 登入：寫入三個設定鍵後重載源。 */
export function loginAidokuBasic(key: string, settingKey: string, username: string, password: string) {
  aidoku.loginBasic(key, settingKey, username, password)
  reloadRegistry()
}

/** Aidoku 源的 `method: "basic"` 登出：移除那三個鍵。 */
export function logoutAidokuBasic(key: string, settingKey: string) {
  aidoku.logoutBasic(key, settingKey)
  reloadRegistry()
}

/** Aidoku 源的 `method: "webview"` 登入：寫入 cookie／localStorage 後重載源。 */
export function loginAidokuWebview(key: string, settingKey: string, data: aidoku.AidokuWebLoginData) {
  aidoku.loginWebview(key, settingKey, data)
  reloadRegistry()
}

/** Aidoku 源的 `method: "webview"` 登出：移除 cookie、localStorage 與狀態鍵。 */
export function logoutAidokuWebview(key: string, settingKey: string) {
  aidoku.logoutWebview(key, settingKey)
  reloadRegistry()
}

/** 把 Aidoku 源的設定全部拿掉（回到 schema 預設）。 */
export function resetAidokuSettings(key: string) {
  aidoku.resetSettings(key)
  reloadRegistry()
}

/** 把某個設定回復成源宣告的預設值。 */
export function resetSourceSetting(key: string, id: string) {
  const source = findSource(key)
  const spec = source?.settingsSpecs?.find(item => item.id === id)
  if (!spec || spec.default === undefined) return
  updateSourceSetting(key, id, spec.default)
}

/** 呼叫源宣告的 `type: "callback"` 設定（例如 mxs 的「檢測當前域名」）。 */
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

/**
 * 從單一來源原始碼安裝或更新。
 */
export function installSourceCode(code: string, origin: string | null, expectedKey?: string): InstallResult {
  const probe = loadSource(code, createHostContext("probe", { settings: {} }))
  if (expectedKey && probe.meta.key !== expectedKey) {
    throw new Error(t("sources.catalog.keyMismatch", { expected: expectedKey, actual: probe.meta.key }))
  }
  const existed = store.hasSource(probe.meta.key)
  // 源宣告的設定預設值必須存下來，loadSetting 才有東西回；更新時保留使用者改過的值。
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

/** 二進位下載（Aidoku 的 `.aix`）。 */
async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { timeout: 60, allowInsecureRequest: true } as any)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(t("sources.catalog.downloadFailed", { status: response.status }))
  }
  return new Uint8Array(await response.arrayBuffer())
}

export interface ImportReport {
  installed: InstallResult[]
  /** 被跳過的條目：撞 key（同批有兩個同 key 的變體）或下載失敗。 */
  skipped: Array<{ key: string; name: string; reason: string }>
}

/**
 * 安裝倉庫索引中的來源條目（同批若有同 key 條目僅安裝首項）。
 */
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

/** 索引裡一條可用的源都沒有的錯誤；有被跳過的條目就附上第一個的原因。 */
function catalogEmptyError(rejected: Array<{ reason: string }>): string {
  return rejected.length > 0
    ? t("sources.catalog.emptyWithReason", { reason: rejected[0].reason })
    : t("sources.catalog.empty")
}

/** 匯入使用者貼上的字串：開頭是 `[` 就當倉庫索引，否則當單一源（Venera 的判斷方式）。 */
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

/** 從網址匯入：內容是索引就裝全部，是單一源就裝一個。 */
export async function importFromUrl(url: string): Promise<ImportReport> {
  return importPasted(await fetchText(url), url)
}

/**
 * 手動加入單一源（貼原始碼，或先抓網址再交給這裡）。
 * 內容看起來像倉庫索引就直接擋掉——那要走倉庫，否則會一次裝進一堆源。
 */
export function installManualSource(text: string, origin: string | null): InstallResult {
  const trimmed = text.trim()
  if (trimmed.startsWith("[")) throw new Error(t("sources.catalog.isRepository"))
  return installSourceCode(trimmed, origin)
}

// ---------------------------------------------------------------- 源倉庫

/** 倉庫索引的長相：物件帶 `sources` 或條目帶 `id` ＋ 下載路徑的都是 Aidoku。 */
function detectRepositoryKind(raw: unknown): RepositoryKind {
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
  /** 索引自己宣告的名稱（Aidoku community 才有）。 */
  name?: string
}

/** 抓一份倉庫索引並解析；kind 沒指定就依內容判斷。 */
async function loadIndex(url: string, kind?: RepositoryKind): Promise<LoadedIndex> {
  const target = indexUrlOf(url)
  let parsed: unknown
  try {
    parsed = JSON.parse(await fetchText(target))
  } catch {
    throw new Error(t("sources.catalog.repositoryNotArray"))
  }
  const resolved = kind ?? detectRepositoryKind(parsed)
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

/**
 * 加入一個倉庫：抓索引、驗證、存起來。同一個網址再加入就是重新抓取
 * （保留原本的加入時間、名稱與類型）。**這裡不裝任何源**，裝哪個由使用者在倉庫裡挑。
 */
export async function addRepository(url: string, kind?: RepositoryKind): Promise<StoredRepository> {
  const target = url.trim()
  if (!target) throw new Error(t("sources.repository.urlRequired"))
  const existing = repositoryStore.getRepository(target)
  const loaded = await loadIndex(target, kind ?? existing?.kind)
  const now = Date.now()
  const repository: StoredRepository = {
    url: target,
    kind: loaded.kind,
    name: existing?.name ?? loaded.name ?? repositoryStore.repositoryNameFor(target),
    addedAt: existing?.addedAt ?? now,
    fetchedAt: now,
    entries: loaded.entries,
  }
  repositoryStore.saveRepository(repository)
  log("info", "sources", `已加入倉庫 ${repository.name}（${loaded.entries.length} 個源）`)
  return repository
}

/** 重新抓索引。失敗時把原因寫進倉庫（清單顯示得到），舊快取留著。 */
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

/** 倉庫裡的一筆源，加上它在本地端的安裝狀態。 */
export interface RepositoryEntryStatus {
  entry: CatalogEntry
  /** 已經裝了同 key 的源；沒有就是未安裝。 */
  installed?: InstalledSource
  /** 倉庫的版本比已安裝的新。 */
  updateAvailable: boolean
}

export function repositoryEntries(repositoryUrl: string): RepositoryEntryStatus[] {
  const repository = repositoryStore.getRepository(repositoryUrl)
  if (!repository) return []
  return repository.entries.map(entry => {
    const installed = findSource(entry.key)
    const installedVersion = installed?.meta?.version ?? installed?.stored.version
    return {
      entry,
      installed,
      updateAvailable: Boolean(installedVersion && compareVersion(entry.version, installedVersion) > 0),
    }
  })
}

/** 從倉庫安裝（或更新）單一筆源。 */
export async function installRepositoryEntry(repositoryUrl: string, key: string): Promise<InstallResult> {
  const repository = repositoryStore.getRepository(repositoryUrl)
  if (!repository) throw new Error(t("sources.repository.notFound"))
  const entry = repository.entries.find(item => item.key === key)
  if (!entry) throw new Error(t("sources.repository.entryNotFound"))

  if (repositoryStore.kindOf(repository) === "aidoku-index") {
    if (!entry.url) throw new Error(t("sources.catalog.relativeOnly"))
    const existed = findSource(entry.key) !== undefined
    const aix = await fetchBytes(entry.url)
    const stored = aidoku.install(aix, { origin: repository.url, expectedKey: entry.key, iconUrl: entry.iconUrl })
    reloadRegistry()
    log("info", "sources", `${existed ? "已更新" : "已安裝"} ${stored.name} v${stored.version}`)
    return { key: stored.key, name: stored.name, version: stored.version, updated: existed }
  }

  const sourceUrl = entry.url ?? resolveEntryUrl(entry, catalogBaseOf(repository.url))
  const code = await fetchText(sourceUrl)
  return installSourceCode(code, repository.url, entry.key)
}

// ------------------------------------------------------------------ 登入

/** 源宣告的登入方式（給 UI 描述表單用）。 */
export interface AccountSpec {
  supportsPassword: boolean
  /** loginWithCookies 的欄位名稱（lanraragi 是 ["apiKey"]）。 */
  cookieFields: string[]
  /** loginWithWebview 的起始網址；有值就代表這個源要開瀏覽器登入。 */
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

/** 帳密登入：呼叫源自己的 `account.login`，源會把 session 存進它自己的資料。 */
export async function loginWithPassword(key: string, account: string, password: string): Promise<void> {
  const source = findSource(key)
  if (!source?.instance) throw new Error(t("sources.notLoadedShort"))
  const login = source.instance.account?.login
  if (typeof login !== "function") throw new Error(t("sources.unsupported.account"))
  await login.call(source.instance, account, password)
  saveCredentials(key, { account, password })
  store.setAccount(key, { loggedIn: true, accountName: account })
  reloadRegistry()
  log("info", "account", `${key} 已登入（${account}）`)
}

/**
 * Cookie 欄位登入：由來源的 validate(values) 進行校驗與 cookie 注入。
 */
export async function loginWithCookies(key: string, values: string[]): Promise<void> {
  const source = findSource(key)
  const spec = source?.instance?.account?.loginWithCookies
  if (!spec) throw new Error(t("sources.unsupported.cookie"))
  const valid = typeof spec.validate === "function" ? await spec.validate(values) : true
  if (!valid) throw new Error(t("sources.login.validateFailed"))
  saveCredentials(key, { cookies: values })
  store.setAccount(key, { loggedIn: true })
  reloadRegistry()
  log("info", "account", `${key} 已登入（cookie 欄位）`)
}

/**
 * 瀏覽器登入：開一個真的瀏覽器讓使用者登入。Cloudflare 過盾與 localStorage 型的憑證
 * （mycomic / ccc / manga_dex / nhentai / ehentai）都走這條。回傳一句給 UI 顯示的狀態。
 *
 * 流程本身在 `webLogin.ts`；這裡負責挑出源的宣告、把狀態落地（loggedIn + 重建實例）。
 */
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
  reloadRegistry()
  log("info", "account", `${key} 已登入（瀏覽器，${result.cookies} 個 cookie）`)
  return result.outcome === "manual" ? t("sources.login.cookiesSaved", { count: result.cookies }) : t("sources.login.done")
}

/** 登出：讓源自己清理，再清掉 Keychain 與 cookie jar。 */
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
  reloadRegistry()
}

// ------------------------------------------------------------------ 自動重登

/**
 * 自動重登的結果：成功 / 有憑證但重登失敗 / 沒有可用的憑證。
 * 呼叫端（`operations.ts` 的重試包裝）依這個決定要重試、丟原本的錯誤，還是給看得懂的訊息。
 */
export type ReloginOutcome = "ok" | "failed" | "no-credentials"

/**
 * 登入狀態寫進 store 之後，把記憶體裡那份 `stored` 也換成 store 的最新版本（單一真相源是 store），
 * 並推進 revision。不重建註冊中心——進行中的操作還握著這個實例——但 `needsLogin` 這類
 * 從 `stored` 讀出來的描述必須跟著更新。
 */
function syncStoredAccount(source: InstalledSource) {
  source.stored = store.getSource(source.stored.key) ?? source.stored
  revision++
}

/**
 * 登入過期時以既有憑證重試登入（直接在既有實例上執行，不重建沙箱）。
 */
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
