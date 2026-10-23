// Aidoku 源（WASM）：把源的四段查詢映射成 Vesper 既有的型別。
//
// 宿主只有一個 worker、一次只載一份源，所以每個橋接呼叫都排隊，而且呼叫前先確認
// worker 裡載的就是這一份（多個 Aidoku 源同時搜尋時才不會互相蓋掉）。
// 宿主這一層壞掉（頁面死、worker 掛、逾時）就重建一次再重試；再失敗就把源標成不可用。
// 失敗一律包成「源出錯」：畫面要能分辨是源壞了，不是網路壞了。

import type { ComicListItem, ComicListPage } from "../engine/adapt"
import { normalizeTags } from "../engine/adapt"
import {
  callAidoku,
  hasImageProcessorAidoku,
  initializeAidokuSource,
  isAidokuHostError,
  loadAidokuPackage,
  loadedAidokuSourceKey,
  notifyAidoku,
  processAidokuPageImage,
  resetAidokuHost,
  runAidokuExclusive,
  setAidokuSettingWriter,
  takeAidokuChallenge,
  type AidokuPackage,
  type AidokuPageImageRequest,
} from "../engine/aidoku/host"
import { appDataRoot, exists, join, listDir, readBytes, readText, remove, writeBytes, writeText } from "../engine/fs"
import type { ImageRequest, ImageResponseInfo } from "../engine/images"
import type { SourceViewer } from "../library/readerSettings"
import type { SourceCapabilities, SourceMeta } from "../engine/loader"
import { log } from "../engine/log"
import { solveCloudflare } from "../engine/cloudflare"
import { unzip } from "../engine/zip"
import { t } from "../i18n"
import type { StoredSource } from "./store"
import type { ComicDetail, ComicStatus, ContentRating, ExploreEntry } from "./operations"
import type { InstalledSource } from "./registry"

const PREFIX = "aidoku:"

/** 章節與頁面清單在真實源上可能很慢；其他呼叫維持宿主的 15s 預設。 */
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

// ---------------------------------------------------------------- 磁碟上的源

/** `sources/aidoku/<id>/`（內含 `Payload/` 與 `installed.json`）。 */
export function dirOf(key: string): string {
  return join(appDataRoot(), "sources", "aidoku", idOf(key))
}

function payloadDir(key: string): string {
  return join(dirOf(key), "Payload")
}

/** `installed.json`：安裝來源、版本、時間、啟用狀態、圖示、使用者改過的設定。 */
interface InstallRecord {
  origin?: string | null
  version?: string
  installedAt?: number
  enabled?: boolean
  /** 倉庫索引給的圖示網址（沒有就是 null）。 */
  iconUrl?: string | null
  /**
   * 使用者改過的設定值：**只存改過的 key**，沒有的 key 由 schema 的預設（安裝的新版本或
   * 源改預設）決定。全部灌進來的話，源換了預設我們就蓋不掉。
   */
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

// 源自己用 `defaults.set` 寫的設定（例如 oauth 刷新後的 token）：由宿主回流到 installed.json。
setAidokuSettingWriter((key, name, value) => {
  if (!exists(dirOf(key))) return
  const settings = { ...settingsOf(key) }
  if (value == null) delete settings[name]
  else settings[name] = value
  writeInstalled(key, { ...installedOf(key), settings })
})

/**
 * 顯示用的圖示：安裝時解出來的 `Payload/icon.png` 優先（沒網路也看得到），
 * 沒有才退回倉庫索引的網址。
 */
function iconOf(key: string, installed: InstallRecord): string | undefined {
  const local = join(payloadDir(key), "icon.png")
  if (exists(local)) return local
  return typeof installed.iconUrl === "string" && installed.iconUrl ? installed.iconUrl : undefined
}

/** 讀 manifest（不讀 wasm 的位元組；載入時才讀）。 */
function manifestOf(key: string): any {
  const manifest = readJson(join(payloadDir(key), "source.json"))
  if (!manifest || !exists(join(payloadDir(key), "main.wasm"))) throw new Error(t("sources.aidoku.missing"))
  // runtime 的 `extractAix` 會補上這兩個：從 `.aix` 解開的檔案要自己補。
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

/** 載入用的一整包。 */
function readPayload(key: string): AidokuPackage {
  const manifest = manifestOf(key)
  const wasm = readBytes(join(payloadDir(key), "main.wasm"))
  if (!wasm) throw new Error(t("sources.aidoku.missing"))
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
    // Aidoku 源沒有 class，這個欄位只給「載入紀錄」用。
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
    // 圖片請求一律經過 `modifyImageRequest`（宿主側），所以永遠是 true。
    modifyImage: true,
    loginWithPassword: false,
    loginWithWebview: false,
    loginWithCookies: false,
    translation: false,
  }
}

/** 源的通知（`handle_notification`）：設定完成後叫一次；源沒匯出就是 no-op。失敗只記 log。 */
export async function notify(source: InstalledSource, notification: string): Promise<void> {
  try {
    await withHealing(
      source,
      "handleNotification",
      async () => {
        await notifyAidoku(notification)
      },
      false
    )
  } catch (failure) {
    log("warning", "aidoku", `${source.stored.key} 的 ${notification} 通知失敗`, failure)
  }
}

/** 磁碟上有哪些 Aidoku 源（registry 用；不碰網路、不載 wasm）。 */
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
  /** 來源索引網址（從倉庫裝的才有）。 */
  origin?: string | null
  /** 倉庫條目的 key；有給就檢查包裡的 id 與它一致（下載前擋掉裝錯的檔）。 */
  expectedKey?: string
  /** 倉庫索引給的圖示網址（`.aix` 沒帶 `Payload/icon.png` 時顯示用）。 */
  iconUrl?: string | null
}

/**
 * 把 `.aix` 解到 `sources/aidoku/<id>/`：`Payload/` 內的檔案 ＋ `installed.json`。
 * 舊的 `Payload/` 先清掉，重裝／更新不會留著上一個版本的檔案。
 */
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

/** 停用／啟用（寫回 `installed.json`；`registry.setSourceEnabled` 會走這裡）。 */
export function setEnabled(key: string, enabled: boolean): void {
  if (!exists(dirOf(key))) return
  writeInstalled(key, { ...installedOf(key), enabled })
  clearFailure(key)
}

/** 移除：整包檔案删掉（`registry.uninstallSource` 會走這裡）。 */
export function uninstall(key: string): void {
  remove(dirOf(key))
  clearFailure(key)
  listings.delete(key)
  forgetLoaded(key)
  log("info", "aidoku", `已移除 ${key}`)
}

// ---------------------------------------------------------------- 設定

/** 一個設定項在畫面上要用哪一種列。 */
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
  /** schema 原樣：UI 不認得的欄位（`keyboardType`、`notification`…）照留。 */
  raw: Record<string, unknown>
  key: string
  /** schema 的 `type`。 */
  type: string
  title: string
  subtitle?: string
  placeholder?: string
  secure: boolean
  control: AidokuSettingControl
  options: AidokuSettingOption[]
  /** 值是陣列（`multi-select` / `multi-single-select`）。 */
  multiple: boolean
  /**
   * 選項的值是**索引**（`segment`）：Aidoku 存 Int，不是選項字串。
   * 畫面仍然當字串選，寫回去才轉成 number。
   */
  indexValue: boolean
  min?: number
  max?: number
  step?: number
  default?: unknown
  /** 源宣告改完要刷新什麼（`content` / `listings` / `settings`）；目前一律重載，見 `setSetting`。 */
  refreshes: string[]
  /** `login` 的登入方式（`basic`／`webview`／`oauth`）。 */
  method?: string
  /** `login`（oauth）的授權網址；`urlKey` 有值時優先讀那個設定。 */
  url?: string
  urlKey?: string
  /** `login`（oauth）的 callback scheme（預設 `aidoku`）。 */
  callbackScheme?: string
  /** `login`（oauth + pkce）的 token 交換網址。 */
  tokenUrl?: string
  /** `login`（oauth）是否走 PKCE。 */
  pkce: boolean
  /** `login` 完成後要叫源的 `handle_notification`。 */
  notification?: string
  /** `login`（webview）要收的 localStorage 鍵；空陣列＝不讀 localStorage。 */
  localStorageKeys: string[]
  /** `login` 的帳號是 email（只是鍵盤提示）。 */
  useEmail: boolean
  /** `login` 登出按鈕的字（源給的）。 */
  logoutTitle?: string
  /** `button` 是危險動作（紅字，確認鈕也紅）。 */
  destructive: boolean
  /** `button` 的確認框標題；有它就先問。 */
  confirmTitle?: string
  /** `button` 的確認框說明；有它也先問。 */
  confirmText?: string
  /** `editable-list` 直接攤在設定頁裡（Aidoku 的 `inline`），否則進子頁。 */
  inline: boolean
  /** `editable-list` 每列的行數上限（0＝不限）。 */
  lineLimit: number
  /** 不支援的種類：只留登入（Aidoku 新增而我們還不認得的型別）。 */
  unsupported?: "login"
}

export interface AidokuSettingGroup {
  title: string
  footer?: string
  /** 來自 `page`：畫面上攤平成一個 Section，不做巢狀子頁。 */
  fromPage: boolean
  items: AidokuSettingItem[]
}

export interface AidokuSettingsSpec {
  groups: AidokuSettingGroup[]
  /** schema 的預設值（key → default）：沒改過的 key 用這裡。 */
  defaults: Record<string, unknown>
  /** 設定的項數（源詳情顯示用）。 */
  count: number
  /** 源支援的語言代碼（manifest）；>1 才顯示語言列。 */
  languages: string[]
  /** 語言只能選一個（manifest 的 `languageSelectType === "single"`）。 */
  singleLanguage: boolean
  /** 沒選過時源會用的語言（isDefault 優先，否則第一個；single 只留第一個）。 */
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

/** Aidoku 的網頁登入在 schema 寫 `web`；`webview` 是舊版／手寫源的別名。 */
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
  // `segment` 的選項在 `options`，其餘在 `values`（兩種都收，舊源還有 `titles`）。
  const rawValues = Array.isArray(node.values) ? node.values : Array.isArray(node.options) ? node.options : []
  const values = rawValues.map(value => String(value ?? ""))
  const titles = Array.isArray(node.titles) ? node.titles.map(value => String(value ?? "")) : []
  const key = textOf(node.key)
  const method = textOf(node.method) || undefined
  const control = controlOf(type, method)
  const indexValue = type === "segment"
  // `button` 沒有 key、也沒有值，但它是真的能按的列。
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
    // `segment` 沒宣告就是第一項（Aidoku 的預設也是 0）。
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

/** 一層 items：group / page 直接攤平（不再往下分頁）。 */
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

/** `settings.json` 的 schema → 畫面用的 spec（保留順序與原欄位）。 */
export function parseSettingsSpec(schema: unknown): AidokuSettingsSpec {
  const groups: AidokuSettingGroup[] = []
  const defaults: Record<string, unknown> = {}
  let count = 0
  /** 沒有 group 的欄位：合成一組（標題空字串＝不顯示小標題）。 */
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

/** manifest 的語言資訊：兼容頂層 `languages`、`info.languages` 與字串／物件兩種形狀。 */
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

/** 讀 `Payload/settings.json` 轉成 spec；沒有這個檔（或壞掉）就是空的。 */
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
    // 檔案壞掉的源：語言資訊就沒有，源清單已經有錯誤訊息。
  }
  return { ...spec, ...language }
}

/** 使用者改過的值（只含改過的 key）。 */
export function settingsOf(key: string): Record<string, unknown> {
  const settings = installedOf(key).settings
  return settings && typeof settings === "object" ? settings : {}
}

/**
 * 寫一個設定值，讓源下次呼叫時重載。
 *
 * 源的 `refreshes` 有細粒度（`content` / `listings` / `settings`），這裡一律當成
 * 「重載源 ＋ 丟掉 listings 快取」：對 Aidoku 源來說重載很便宜（下次呼叫才真的做），
 * 而漏刷新的代價（清單還用舊設定）比多重載一次明顯得多。
 */
export function setSetting(key: string, id: string, value: unknown): void {
  if (!exists(dirOf(key))) return
  const settings = { ...settingsOf(key) }
  if (value === undefined) delete settings[id]
  else settings[id] = value
  writeInstalled(key, { ...installedOf(key), settings })
  forgetLoaded(key)
}

/**
 * `method: "basic"` 的登入：只是往源的設定寫三個鍵，源自己用 `defaults.get(...)` 讀。
 * 宿主不驗證帳密（Aidoku 的 wasm 源都是宿主直接寫），所以寫完就算登入。
 */
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

/** webview 登入收集到的資料：只含要寫進源設定的部分。 */
export interface AidokuWebLoginData {
  cookies: Array<{ name: string; value: string }>
  /** 只含源指定要收的鍵；沒指定就是空的。 */
  localStorage: Record<string, string>
}

/**
 * `method: "web"` 的登入：把 cookie 寫成同序的 `.keys`／`.values`，
 * localStorage 寫成 `.ls.<名>`，最後把狀態設成 `logged_in`。
 */
export function loginWebview(key: string, settingKey: string, data: AidokuWebLoginData): void {
  if (!exists(dirOf(key))) return
  const settings = { ...settingsOf(key) }
  // 同一個登入項底下舊的 localStorage 先清掉，不讓上一次的憑證混進這次。
  for (const name of Object.keys(settings)) {
    if (name.startsWith(`${settingKey}.ls.`)) delete settings[name]
  }
  const cookies = (data.cookies ?? []).filter(cookie => typeof cookie?.name === "string" && cookie.name.length > 0)
  settings[`${settingKey}.keys`] = cookies.map(cookie => cookie.name)
  settings[`${settingKey}.values`] = cookies.map(cookie => String(cookie.value ?? ""))
  const storage = Object.entries(data.localStorage ?? {}).filter(([name]) => name.length > 0)
  for (const [name, value] of storage) settings[`${settingKey}.ls.${name}`] = String(value)
  // 什麼都沒收到就不標成已登入（上游同樣不把空 cookie 當登入）。
  if (cookies.length > 0 || storage.length > 0) settings[settingKey] = "logged_in"
  else delete settings[settingKey]
  writeInstalled(key, { ...installedOf(key), settings })
  forgetLoaded(key)
}

/** 登出 webview 登入：把 cookie、localStorage 與狀態鍵全部拿掉。 */
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

/** oauth：把 token 原文（或 callback URL）寫到 key；`<key>.codeVerifier` 保留給源刷新用。 */
export function loginOAuth(key: string, settingKey: string, value: string): void {
  if (!exists(dirOf(key))) return
  const settings = { ...settingsOf(key), [settingKey]: value }
  writeInstalled(key, { ...installedOf(key), settings })
  forgetLoaded(key)
}

/** 登出 oauth：token 與 codeVerifier 一起拿掉。 */
export function logoutOAuth(key: string, settingKey: string): void {
  if (!exists(dirOf(key))) return
  const settings = { ...settingsOf(key) }
  delete settings[settingKey]
  delete settings[`${settingKey}.codeVerifier`]
  writeInstalled(key, { ...installedOf(key), settings })
  forgetLoaded(key)
}

/** 登出 basic 登入：把寫進去的三個鍵拿掉。 */
export function logoutBasic(key: string, settingKey: string): void {
  if (!exists(dirOf(key))) return
  const settings = { ...settingsOf(key) }
  delete settings[`${settingKey}.username`]
  delete settings[`${settingKey}.password`]
  delete settings[settingKey]
  writeInstalled(key, { ...installedOf(key), settings })
  forgetLoaded(key)
}

/** 全部回復成 schema 的預設值（把改過的 key 整個拿掉）。 */
export function resetSettings(key: string): void {
  if (!exists(dirOf(key))) return
  const { settings: _removed, ...rest } = installedOf(key)
  writeInstalled(key, rest)
  forgetLoaded(key)
}

// ---------------------------------------------------------------- 橋

/** 源已經被判定不可用（自癒也救不回來）：後續呼叫直接失敗，不再碰宿主。 */
class AidokuUnavailableError extends Error {}

/** 載入／初始化失敗（宿主或源自己的錯）：值得先重建宿主再試一次。 */
class SourceLoadError extends Error {}

/** 源級失敗原因（記憶體；重啟 App、重新安裝或重新啟用就會清掉）。 */
const failures = new Map<string, string>()

/** 載入時問到的「需要圖片後處理」（解密／解拼）：只有載入過才知道。 */
const imageProcessors = new Map<string, boolean>()

let stateListener: (() => void) | null = null

/** registry 用它廣播變更（不反向 import registry，避免循環）。 */
export function setStateListener(listener: (() => void) | null): void {
  stateListener = listener
}

/** 這個源需不需要圖片後處理；還沒載入過就是 false。 */
export function needsImageProcessing(key: string): boolean {
  return imageProcessors.get(key) === true
}

/** 載入後問一次 `hasImageProcessor`；結果改變才通知畫面。 */
async function rememberImageProcessor(key: string): Promise<void> {
  const previous = imageProcessors.get(key)
  const flag = await hasImageProcessorAidoku()
  if (flag === previous) return
  imageProcessors.set(key, flag)
  stateListener?.()
}

/** 這個源現在為什麼不可用；正常的話是 undefined。 */
export function failureOf(key: string): string | undefined {
  return failures.get(key)
}

/** 重新嘗試這個源（重新安裝／啟用時用）。 */
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

/** 給使用者看的一行原因：宿主層的技術字換成人話，源自己的錯誤原樣保留。 */
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

let initializedKey: string | null = null

/** 檔案被換掉／删掉了：宿主還載著這一份的話就丟掉，下次用到時重載新檔。 */
function forgetLoaded(key: string): void {
  listings.delete(key)
  imageProcessors.delete(key)
  if (loadedAidokuSourceKey() !== key) return
  resetAidokuHost()
  initializedKey = null
}

async function initializeGuarded(): Promise<void> {
  try {
    await initializeAidokuSource()
  } catch (failure) {
    throw new SourceLoadError(messageOf(failure))
  }
}

/** 確定 worker 裡載著這一份源（而且初始化過）。 */
async function ensureLoaded(source: InstalledSource): Promise<void> {
  const key = source.stored.key
  if (loadedAidokuSourceKey() === key) {
    if (initializedKey === key) return
    await initializeGuarded()
    initializedKey = key
    return
  }
  // 檔案不在／壞掉是源自己的問題，重建宿主也沒用。
  const payload = readPayload(key)
  const started = Date.now()
  try {
    await loadAidokuPackage(payload, key)
  } catch (failure) {
    throw new SourceLoadError(messageOf(failure))
  }
  await initializeGuarded()
  initializedKey = key
  await rememberImageProcessor(key)
  log("info", "aidoku", `${key} 已載入（${Date.now() - started}ms）`)
}

function shouldHeal(failure: unknown): boolean {
  return isAidokuHostError(failure) || failure instanceof SourceLoadError
}

/**
 * 一次原子操作：確保載著這份源 → 跑 task。
 * 宿主這一層壞掉就重建一次、重載、再試一次；第二次仍失敗預設標記源不可用，
 * 但 `markOnFailure=false` 的路徑（例如單張圖處理失敗）只把錯誤丟出去。
 */
function withHealing<T>(source: InstalledSource, step: string, task: () => Promise<T>, markOnFailure = true): Promise<T> {
  const key = source.stored.key
  return runAidokuExclusive(async () => {
    assertAvailable(key)
    try {
      await ensureLoaded(source)
      return await task()
    } catch (failure) {
      if (!shouldHeal(failure)) throw failure
      log("warning", "aidoku", `${key} 的 ${step} 失敗（${messageOf(failure)}），重建宿主後重試一次`)
      resetAidokuHost()
      initializedKey = null
      try {
        await ensureLoaded(source)
        return await task()
      } catch (retryFailure) {
        if (markOnFailure) markFailure(key, userMessageOf(retryFailure))
        throw retryFailure
      }
    }
  })
}

/** `onResponse` 拿到的可能是 ArrayBuffer 或 Uint8Array。 */
function toBytes(value: any): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value)
}

/** 有 `process_page_image` 的源：抓回來的位元組先交給源處理。 */
async function processPageImageBytes(
  source: InstalledSource,
  bytes: any,
  request: AidokuPageImageRequest
): Promise<Uint8Array> {
  try {
    return await withHealing(source, "processPageImage", () => processAidokuPageImage(toBytes(bytes), request), false)
  } catch (failure) {
    if (failure instanceof AidokuUnavailableError) throw failure
    log("error", "aidoku", `${source.stored.key} 的頁面圖處理失敗`, failure)
    throw new Error(t("sources.aidoku.failed", { message: userMessageOf(failure) }))
  }
}

/**
 * 一次源呼叫。撞到 Cloudflare 挑戰就先過盾再重試一次（只處理一次，避免重試又撞牆時繞圈）。
 * 過盾放在這裡而不是宿主：宿主那條路徑（HttpServer 回呼）建不了 timer。
 */
async function call(source: InstalledSource, method: string, args: unknown[] = [], timeoutMs?: number): Promise<any> {
  const run = () => withHealing(source, method, () => callAidoku(method, args, timeoutMs))
  let value: any
  let failure: unknown = null
  let failed = false
  try {
    value = await run()
  } catch (error) {
    failed = true
    failure = error
  }

  const challenge = takeAidokuChallenge(source.stored.key)
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
  // 第一次就被判死的源（例如 initialize 被擋）要先解掉，不然重試會直接被 assertAvailable 擋下。
  clearFailure(source.stored.key)
  try {
    return await run()
  } finally {
    // 重試自己撞到的挑戰不再留給下一次（避免每次呼叫都多過一次盾）。
    takeAidokuChallenge(source.stored.key)
  }
}

/** 把失敗包成「源出錯」（畫面才不會把它當成網路問題）。 */
async function ask<T>(step: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task()
  } catch (failure) {
    if (failure instanceof AidokuUnavailableError) throw failure
    log("error", "aidoku", `${step} 失敗`, failure)
    throw new Error(t("sources.aidoku.failed", { message: userMessageOf(failure) }))
  }
}

// ---------------------------------------------------------------- 映射

function names(raw: unknown): string {
  return Array.isArray(raw)
    ? raw
        .map(value => String(value ?? "").trim())
        .filter(value => value.length > 0)
        .join(", ")
    : ""
}

/** Aidoku 的 PublishingStatus（0 未知 / 1 連載 / 2 完結 / 3 腰斬 / 4 休刊 / 5 未出版）。 */
const STATUS_BY_CODE: Record<number, ComicStatus> = {
  1: "ongoing",
  2: "completed",
  3: "cancelled",
  4: "hiatus",
  5: "notPublished",
}

/** Aidoku 的 MangaContentRating（0 安全 / 1 建議 / 2 R18）。 */
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

/** Aidoku 的 MangaViewer：0 預設 / 1 rtl / 2 ltr / 3 vertical / 4 scroll。 */
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

/**
 * 漢化組就是 Vesper 的章節分組（`chapterGrouping.ts` 靠這個切分頁）。
 * 這個 runtime 給的是單一 `scanlator` 字串；`scanlators` 陣列留給之後的 ABI。
 */
function scanlatorOf(raw: any): string {
  if (Array.isArray(raw?.scanlators)) {
    return raw.scanlators
      .map((value: unknown) => String(value ?? "").trim())
      .filter((value: string) => value.length > 0)
      .join(", ")
  }
  return typeof raw?.scanlator === "string" ? raw.scanlator.trim() : ""
}

/** 章節編號：wasm 用 f32 傳，200.1 會變成 200.100006…；跟 Aidoku 的 `%g` 一樣收成 6 位有效數字。 */
function chapterNumberText(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return ""
  return String(parseFloat(value.toPrecision(6)))
}

/**
 * 章節標題：卷號與話數照 Aidoku 的 makeTitle 組合（「第 3 卷 · 第 12 話 · 標題」）。
 * 標題自己已經帶編號的（中文源很常這樣）就照原樣，不重複疊。
 */
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

/** 搜尋（第一頁；翻頁由 hasNextPage 轉成 maxPage）。`filters` 是 `aidokuFilters.encodeFilters` 的結果。 */
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

/** 舊版源宣告的篩選（`filters.json` → manifest）：定義的原始 JSON。 */
export function filterDefsOf(key: string): unknown[] {
  const list = manifestOf(key)?.filters
  return Array.isArray(list) ? list : []
}

/** v2 源自己回報的篩選（wasm 的 `get_filters`）；沒有的話回空陣列。 */
export async function runtimeFilterDefs(source: InstalledSource): Promise<unknown[]> {
  await ready(source)
  const defs = await ask("filters", async () => await call(source, "getFilters"))
  return Array.isArray(defs) ? defs : []
}

/** 詳情＋章節：`getMangaDetails` 之後立刻補 `getChapterList`（章節就在詳情裡）。 */
export function detail(source: InstalledSource, comicId: string): Promise<ComicDetail> {
  return ask("detail", async () => {
    const raw = await call(source, "getMangaDetails", [{ key: comicId, id: comicId }], SLOW_CALL_TIMEOUT_MS)
    const mangaId = String(raw?.key ?? raw?.id ?? comicId)
    const chapters = await call(source, "getChapterList", [{ key: mangaId, id: mangaId }], SLOW_CALL_TIMEOUT_MS)
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
        .filter((chapter): chapter is { group: string; id: string; title: string; locked: boolean; lang?: string } => chapter !== null),
      uploader: names(raw?.authors) || undefined,
      artists: names(raw?.artists) || undefined,
      url: typeof raw?.url === "string" && raw.url ? raw.url : undefined,
    }
  })
}

/** 章節的頁面清單（回圖片的原始網址，取圖前會再問 `modifyImageRequest`）。 */
export async function pages(source: InstalledSource, comicId: string, epId: string): Promise<string[]> {
  const urls = await ask("pages", async () => {
    const raw = await call(
      source,
      "getPageList",
      [{ key: comicId, id: comicId }, { key: epId, id: epId, mangaId: comicId }],
      SLOW_CALL_TIMEOUT_MS
    )
    return (Array.isArray(raw) ? raw : [])
      .map((page: any) => String(page?.url ?? ""))
      .filter((url: string) => url.length > 0)
  })
  if (urls.length === 0) throw new Error(t("sources.emptyChapter"))
  return urls
}

/** 圖片的請求：URL 與 header（UA／cookie／Referer）都由源的 `modifyImageRequest` 決定。 */
export function imageRequest(source: InstalledSource, url: string, chapterId?: string): Promise<ImageRequest> {
  return ask("image", async () => {
    const raw = await call(source, "modifyImageRequest", [url, chapterId ?? null])
    const headers: Record<string, string> = {}
    if (raw?.headers && typeof raw.headers === "object") {
      for (const [name, value] of Object.entries(raw.headers as Record<string, unknown>)) {
        if (value != null) headers[name] = String(value)
      }
    }
    const target = typeof raw?.url === "string" && raw.url ? raw.url : url
    const request: ImageRequest = { url: target, method: "GET", data: null, headers }
    // 只有真的有 hook 的源才多走一次處理（沒有的話連 onResponse 都不裝）。
    if (needsImageProcessing(source.stored.key)) {
      request.onResponse = (bytes: any, response?: ImageResponseInfo) =>
        processPageImageBytes(source, bytes, {
          url: target,
          headers,
          status: response?.status ?? 200,
          responseHeaders: response?.headers ?? {},
        })
    }
    return request
  })
}

/** 正文取圖用的模組：`engine/images.ts` 的 `onImageLoad` 契約。 */
export function comicModule(source: InstalledSource): {
  onImageLoad(imageUrl: string, comicId: string, epId: string): Promise<ImageRequest>
} {
  return {
    onImageLoad: (imageUrl: string, _comicId: string, epId: string) => imageRequest(source, imageUrl, epId),
  }
}

// ---------------------------------------------------------------- listings

/** `getListings()` 的原始條目（`explore()` 是同步的，所以先收在這裡）。 */
const listings = new Map<string, any[]>()

/** manifest 的靜態 `listings`。 */
function staticListingsOf(key: string): any[] {
  const staticListings = manifestOf(key)?.listings
  return Array.isArray(staticListings) ? staticListings : []
}

/**
 * 靜態（manifest）與動態（`getListings()`）合併，以 `id` 去重、先來的優先。
 * 官方執行期也是 `[...staticListings, ...dynamicListings]`。
 */
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

/** 載入源並收下 listings（第一次用到時）。 */
export function ready(source: InstalledSource): Promise<void> {
  const key = source.stored.key
  return ask("ready", () =>
    withHealing(source, "getListings", async () => {
      if (listings.has(key)) return
      const staticListings = staticListingsOf(key)
      let dynamicListings: any[] = []
      try {
        const raw = await callAidoku("getListings")
        if (Array.isArray(raw)) dynamicListings = raw
      } catch (failure) {
        // 只有宿主層會真的丟錯（源自己的 get_listings 丟錯時 runtime 回空陣列）：
        // manifest 已經有清單就照用，一個都沒有的話才把錯誤丟上去。
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

/** 一個 listing 的一頁（`getMangaListForListing`）。 */
export function listing(source: InstalledSource, index: number, page: number): Promise<ComicListPage> {
  return ask("listing", async () => {
    const item = listings.get(source.stored.key)?.[index]
    if (!item) throw new Error(t("sources.unsupported.exploreIndex", { n: index + 1 }))
    return toListPage(await call(source, "getMangaListForListing", [item, page]), page)
  })
}
