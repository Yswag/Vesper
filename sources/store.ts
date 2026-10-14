// 漫畫來源本地儲存模組：儲存 index.json 與各源獨立 .js 原始檔。
// 若未獲檔案系統授權則自動退守 Storage KV 備援機制。

import { appDataRoot, ensureDir, exists, fileAccess, hasFileAccess, join, readText, remove, writeText } from "../engine/fs"
import { kv } from "../engine/storage"

const KV_META_KEY = "venera:sourceMeta"
const KV_CODE_PREFIX = "venera:sourceCode:"
const KV_ENABLED_PREFIX = "venera:sourceEnabled:"

export interface StoredSource {
  key: string
  name: string
  version: string
  minAppVersion: string
  /** 源自己宣告的網站網址。 */
  homeUrl: string
  /** 安裝來源（倉庫 URL 或 null 表示手動貼上）。 */
  origin: string | null
  installedAt: number
  updatedAt: number
  enabled: boolean
  /** 設定值（v1 只有源的預設值，唯讀；之後開放編輯就寫在這裡）。 */
  settings?: Record<string, unknown>
  /** 登入狀態（憑證本體在 Keychain）。 */
  loggedIn?: boolean
  accountName?: string
}

interface SourceIndex {
  version: number
  sources: StoredSource[]
}

const INDEX_VERSION = 1

function sourcesDir(): string {
  return join(appDataRoot(), "sources")
}

function indexPath(): string {
  return join(sourcesDir(), "index.json")
}

function codePath(key: string): string {
  return join(sourcesDir(), `${safeFileName(key)}.js`)
}

/** key 的合法字元集是 `^\w+$`，但仍防一手避免路徑跳脫。 */
function safeFileName(key: string): string {
  return key.replace(/[^\w.-]/g, "_")
}

// ---------------------------------------------------------------- 檔案後端

function readIndex(): StoredSource[] {
  const raw = readText(indexPath())
  if (raw == null) return []
  try {
    const parsed = JSON.parse(raw) as SourceIndex
    if (!Array.isArray(parsed?.sources)) return []
    return parsed.sources.filter(entry => entry && typeof entry.key === "string")
  } catch {
    return []
  }
}

function writeIndex(list: StoredSource[]) {
  const payload: SourceIndex = { version: INDEX_VERSION, sources: list }
  writeText(indexPath(), JSON.stringify(payload, null, 2))
}

/** 獲得檔案授權時將 KV 舊資料單向遷移至磁碟檔案（一次性）。 */
function migrateFromKvIfNeeded() {
  if (exists(indexPath())) return
  const legacy = kv.get(KV_META_KEY)
  if (!Array.isArray(legacy) || legacy.length === 0) {
    writeIndex([])
    return
  }
  ensureDir(sourcesDir())
  const list: StoredSource[] = []
  for (const entry of legacy as Array<Omit<StoredSource, "enabled">>) {
    const code = kv.get(KV_CODE_PREFIX + entry.key)
    if (typeof code === "string") writeText(codePath(entry.key), code)
    list.push({ ...entry, enabled: kv.get(KV_ENABLED_PREFIX + entry.key) !== false })
  }
  writeIndex(list)
}

// ---------------------------------------------------------------- KV 後端（無授權時的備援）

function kvReadIndex(): StoredSource[] {
  const raw = kv.get(KV_META_KEY)
  if (!Array.isArray(raw)) return []
  return (raw as Array<Omit<StoredSource, "enabled">>).map(entry => ({
    ...entry,
    enabled: kv.get(KV_ENABLED_PREFIX + entry.key) !== false,
  }))
}

function kvWriteIndex(list: StoredSource[]) {
  kv.set(
    KV_META_KEY,
    list.map(({ enabled: _enabled, ...rest }) => rest)
  )
}

function useFiles(): boolean {
  return hasFileAccess()
}

export function storageMode(): "files" | "kv" | "unknown" {
  const access = fileAccess()
  if (access === null) return "unknown"
  return access ? "files" : "kv"
}

// ---------------------------------------------------------------- 對外 API

export function listSources(): StoredSource[] {
  if (!useFiles()) return kvReadIndex()
  migrateFromKvIfNeeded()
  return readIndex()
}

export function getSource(key: string): StoredSource | undefined {
  return listSources().find(entry => entry.key === key)
}

export function getSourceCode(key: string): string | null {
  if (!useFiles()) {
    const code = kv.get(KV_CODE_PREFIX + key)
    return typeof code === "string" ? code : null
  }
  return readText(codePath(key))
}

export function hasSource(key: string): boolean {
  return getSource(key) !== undefined
}

export function saveSource(
  meta: Omit<StoredSource, "installedAt" | "updatedAt" | "enabled">,
  code: string
): StoredSource {
  const now = Date.now()
  const list = listSources()
  const index = list.findIndex(entry => entry.key === meta.key)
  const next: StoredSource = {
    ...meta,
    enabled: index >= 0 ? list[index].enabled : true,
    settings: meta.settings ?? (index >= 0 ? list[index].settings : undefined) ?? {},
    installedAt: index >= 0 ? list[index].installedAt : now,
    updatedAt: now,
  }
  if (index >= 0) list[index] = next
  else list.push(next)

  if (useFiles()) {
    ensureDir(sourcesDir())
    writeText(codePath(meta.key), code)
    writeIndex(list)
  } else {
    kv.set(KV_CODE_PREFIX + meta.key, code)
    kvWriteIndex(list)
  }
  return next
}

export function removeSource(key: string) {
  const list = listSources().filter(entry => entry.key !== key)
  if (useFiles()) {
    remove(codePath(key))
    writeIndex(list)
  } else {
    kv.remove(KV_CODE_PREFIX + key)
    kvWriteIndex(list)
  }
}

export function isEnabled(key: string): boolean {
  return getSource(key)?.enabled !== false
}

function writeIndexOrKv(list: StoredSource[]) {
  if (useFiles()) writeIndex(list)
  else kvWriteIndex(list)
}

export function setAccount(key: string, account: { loggedIn: boolean; accountName?: string }) {
  const list = listSources()
  const index = list.findIndex(entry => entry.key === key)
  if (index < 0) return
  list[index] = {
    ...list[index],
    loggedIn: account.loggedIn,
    accountName: account.accountName ?? (account.loggedIn ? list[index].accountName : undefined),
    updatedAt: Date.now(),
  }
  writeIndexOrKv(list)
}

/** 只改設定值（不重寫源碼）。 */
export function updateSettings(key: string, settings: Record<string, unknown>) {
  const list = listSources()
  const index = list.findIndex(entry => entry.key === key)
  if (index < 0) return
  list[index] = { ...list[index], settings, updatedAt: Date.now() }
  writeIndexOrKv(list)
}

export function setEnabled(key: string, enabled: boolean) {
  const list = listSources()
  const index = list.findIndex(entry => entry.key === key)
  if (index < 0) return
  list[index] = { ...list[index], enabled, updatedAt: Date.now() }
  writeIndexOrKv(list)
}

/**
 * 依 `keys` 的順序重排 index.json（拖曳排序的落點）。目前**沒有任何 order 欄位**——
 * 清單順序就是這份陣列的順序，所以只改陣列本身。
 *
 * 防禦：沒提到的鍵保持原本的相對順序接在後面（呼叫端給的清單不完整時不會弄丟源）；
 * 鍵集對不上、或順序真的沒變就回 false 不寫盤。
 */
export function reorderSources(keys: string[]): boolean {
  const list = listSources()
  const byKey = new Map(list.map(entry => [entry.key, entry]))
  const ordered: StoredSource[] = []
  for (const key of keys) {
    const entry = byKey.get(key)
    if (!entry) continue
    ordered.push(entry)
    byKey.delete(key)
  }
  for (const entry of list) {
    if (byKey.has(entry.key)) ordered.push(entry)
  }
  if (ordered.length !== list.length) return false
  if (!ordered.some((entry, index) => entry.key !== list[index].key)) return false
  writeIndexOrKv(ordered)
  return true
}

export function conflictingKeys(keys: string[]): string[] {
  const installed = new Set(listSources().map(entry => entry.key))
  return keys.filter(key => installed.has(key))
}
