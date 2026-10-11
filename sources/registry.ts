// 源的執行期註冊中心：把盤上的源載進沙箱、快取實例、對 UI 廣播變動。
//
// 單一真相源是 store（Storage）。這裡只是「載入後的即時視圖」，不持有第二份資料，
// 避免出現「註冊中心有一份、盤上又有一份」的同步問題。

import { clearCookies } from "../engine/cookies"
import { clearCredentials, loadCredentials, saveCredentials } from "../engine/credentials"
import { createEmitter } from "../engine/emitter"
import { log } from "../engine/log"
import { createHostContext } from "../engine/host"
import { hostUI } from "../app/hostUI"
import { extractSettings, loadSource, mergeSettings, type SettingSpec, type SourceCapabilities, type SourceMeta } from "../engine/loader"
import { t } from "../i18n"
import { fetch } from "scripting"

import { catalogBaseOf, compareVersion, parseCatalog, resolveEntryUrl, type CatalogEntry } from "./catalog"
import * as repositoryStore from "./repository"
import type { StoredRepository } from "./repository"
import * as store from "./store"
import { runWebLogin } from "./webLogin"

export interface InstalledSource {
  stored: store.StoredSource
  enabled: boolean
  /** 載入失敗時為 undefined，原因記在 error。 */
  instance?: any
  meta?: SourceMeta
  capabilities?: SourceCapabilities
  /** 源宣告的設定項（唯讀，供之後的設定 UI 用）。 */
  settingsSpecs?: SettingSpec[]
  error?: string
}

let current: InstalledSource[] = []

/**
 * 「載入後的視圖」換過幾次。`app/comic.ts` 拿它當源描述快取的版本號：數字一變，
 * 那邊留著的描述就整份作廢。`reloadRegistry()` 會換掉全部源物件（物件本身就能當版本），
 * 但 `reloginSource()` 刻意**不**重建註冊中心（見該函式），它改的是登入狀態，所以也要推一格。
 */
let revision = 0

/** 目前這一份視圖的版本號（見 revision）。 */
export function sourcesRevision(): number {
  return revision
}

/** 訂閱者出事要看得到（以前是 "訂閱者拋錯 " 記一筆 log，行為照舊）。 */
const bus = createEmitter({
  onListenerError: error => log("error", "sources", "訂閱者拋錯", error),
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
  return current
}

export function enabledSources(): InstalledSource[] {
  return current.filter(source => source.enabled && source.instance)
}

export function findSource(key: string): InstalledSource | undefined {
  return current.find(source => source.stored.key === key)
}

/** 從盤上重新載入全部源。啟動時呼叫一次，匯入/刪除後再呼叫。 */
export function reloadRegistry() {
  revision++
  initTasks.clear()
  current = store.listSources().map(rawEntry => {
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
      // 回填：settings 是後來才開始存的，舊資料沒有，這裡自動補預設值並寫回，
      // 不需要使用者重新安裝。
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
  })
  bus.emit()
}

export function setSourceEnabled(key: string, enabled: boolean) {
  store.setEnabled(key, enabled)
  reloadRegistry()
}

/**
 * 拖曳排序：把已安裝的源換成新的先後順序。
 *
 * 刻意**不呼叫 `reloadRegistry()`**：順序只是視圖的排列，源的實例（已 eval 的沙箱）完全不受影響，
 * 重建一次就是把每個源重新 eval。也**不推 `revision`**：源自己的描述（名稱／能力／optionList）
 * 沒變，推一格會讓 `app/comic.ts` 那份描述快取整份作廢、每一頁重算。這裡只要把 `current` 排成同一個順序再廣播。
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

/**
 * 呼叫每個源的 init()（Venera 在安裝/重載時會呼叫，最多等 15 秒）。
 * 有些源會在這裡先把網域清單、token、預設設定準備好，沒跑的話第一個請求就會壞掉
 * （例如 mxs 的 URL 是 init 準備的，不跑就送空網址）。
 */
/** 已經跑過 init() 的源（以 key 記；重載清空）。 */
const initTasks = new Map<string, Promise<void>>()

/**
 * 確保某個源的 init() 跑過。**按需觸發**，不在開場對所有源跑。
 *
 * 為什麼不開場全跑：你可能裝了 30 個源只用 3 個；開場會被最慢的那個綁住；
 * 而且一個源的 init 寫壞（例如 comic_walker 的無限重試迴圈）就會拖垮整個 App，
 * 就算你根本不用它。改成「要用之前才 init」。
 *
 * **不可取消**：這是每源一個共用的 promise（同一個源的所有呼叫端共用同一個），取消只能「不再等」，
 * 不能真的殺掉已經在跑的 `init()`（取消的範圍只包住源的呼叫，見 `engine/scope.ts`）。
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

/** 把某個設定回復成源宣告的預設值。 */
export function resetSourceSetting(key: string, id: string) {
  const source = findSource(key)
  const spec = source?.settingsSpecs?.find(item => item.id === id)
  if (!spec || spec.default === undefined) return
  updateSourceSetting(key, id, spec.default)
}

/** 呼叫源宣告的 `type: "callback"` 設定（例如 mxs 的「檢測當前域名」）。 */
export async function runSourceSettingCallback(key: string, id: string): Promise<void> {
  const source = findSource(key)
  const callback = source?.instance?.settings?.[id]?.callback
  if (typeof callback !== "function") throw new Error(t("sources.settingNoAction"))
  await callback.call(source?.instance)
}

export function uninstallSource(key: string) {
  store.removeSource(key)
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
 * 從單一源的原始碼安裝。`expectedKey` 有值時會驗證源宣告的 key 相符
 * （Venera 更新時就是這樣擋「把一個源換成另一個源」）。
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

export interface ImportReport {
  installed: InstallResult[]
  /** 被跳過的條目：撞 key（同批有兩個同 key 的變體）或下載失敗。 */
  skipped: Array<{ key: string; name: string; reason: string }>
}

/**
 * 安裝一個倉庫索引裡的全部條目。
 * `catalogUrl` 是索引本身的 URL，用來解析相對路徑；貼上純文字時為 null，
 * 那種情況下只接受帶絶對 url 的條目（跟 Venera 要求補「原始來源列表地址」同理）。
 *
 * 撞 key 照 Q33：同批只留第一個，其餘進 skipped 讓 UI 告知使用者
 * （venera-configs 的 copy_manga 就是兩個變體共用一個 key）。
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

/** 抓一份倉庫索引並解析。內容不是 JSON 陣列（例如貼到單一源）就給人話。 */
async function fetchCatalogEntries(url: string): Promise<CatalogEntry[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await fetchText(url))
  } catch {
    throw new Error(t("sources.catalog.repositoryNotArray"))
  }
  const { entries, rejected } = parseCatalog(parsed)
  if (entries.length === 0) {
    throw new Error(catalogEmptyError(rejected))
  }
  return entries
}

/**
 * 加入一個倉庫：抓索引、驗證、存起來。同一個網址再加入就是重新抓取
 * （保留原本的加入時間與名稱）。**這裡不裝任何源**，裝哪個由使用者在倉庫裡挑。
 */
export async function addRepository(url: string): Promise<StoredRepository> {
  const target = url.trim()
  if (!target) throw new Error(t("sources.repository.urlRequired"))
  const entries = await fetchCatalogEntries(target)
  const now = Date.now()
  const existing = repositoryStore.getRepository(target)
  const repository: StoredRepository = {
    url: target,
    name: existing?.name ?? repositoryStore.repositoryNameFor(target),
    addedAt: existing?.addedAt ?? now,
    fetchedAt: now,
    entries,
  }
  repositoryStore.saveRepository(repository)
  log("info", "sources", `已加入倉庫 ${repository.name}（${entries.length} 個源）`)
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
 * Cookie 欄位登入：源宣告 `fields` 與一個 `validate(values)`，值只交給源自己判斷。
 *
 * 跟 Venera 一樣，**宿主不代寫 cookie**：源的 `validate` 需要 cookie 就會自己呼叫
 * `Network.setCookies`（mycomic 的 cf_clearance、ehentai 的 ipb_* 都是這樣寫的）。
 * 而且源宣告的 `url` 欄位是「更新網址」（jsdelivr），拿它當 cookie 網域本來就是錯的。
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
 * 登入過期時，用存好的憑證再登入一次（憑證在 Keychain，`engine/credentials.ts`）。
 *
 * 刻意**不重建註冊中心**：`reloadRegistry()` 會把全部源重載，而且會換掉進行中操作
 * 持有的實例（換掉之後重試就會用到沒登入的舊實例）。這裡直接重跑源自己的
 * `account.login` / `loginWithCookies.validate`，登入狀態就落在同一個實例上。
 *
 * 只能瀏覽器登入（`loginWithWebview`）的源沒有存下憑證 → `no-credentials`。
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
