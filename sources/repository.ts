// 源倉庫的落地儲存：使用者加入的索引（index.json）網址。
//
//   <documents>/Vesper/sources/repositories.json   { version, repositories: StoredRepository[] }
//
// 加入倉庫只保存索引（含快取），**不安裝任何源**；安裝由 registry 從快取的條目逐筆挑。
// 索引快取在本地，所以沒網路也看得到清單。沒有檔案授權時退回 Storage KV（跟 store.ts 同樣策略）。

import { createEmitter } from "../engine/emitter"
import { appDataRoot, ensureDir, hasFileAccess, join, readText, writeText } from "../engine/fs"
import { kv } from "../engine/storage"

import type { CatalogEntry } from "./catalog"

const KV_KEY = "venera:repositories"
const INDEX_VERSION = 1

export interface StoredRepository {
  /** 索引 URL，同時是識別碼：同一個網址只會有一筆，再加入就是重新抓取。 */
  url: string
  /** 顯示名稱（由 URL 推導）。 */
  name: string
  addedAt: number
  /** 最後一次成功抓取索引的時間。 */
  fetchedAt: number
  /** 索引快取（加入時抓一次，重新整理時覆蓋）。 */
  entries: CatalogEntry[]
  /** 最後一次抓取失敗的原因；成功時清掉。 */
  error?: string
}

interface RepositoryFile {
  version: number
  repositories: StoredRepository[]
}

function storeDir(): string {
  return join(appDataRoot(), "sources")
}

function indexPath(): string {
  return join(storeDir(), "repositories.json")
}

function isValid(entry: unknown): entry is StoredRepository {
  return Boolean(entry) && typeof (entry as StoredRepository).url === "string"
}

// ---------------------------------------------------------------- 讀寫

function readAll(): StoredRepository[] {
  if (!hasFileAccess()) {
    const raw = kv.get(KV_KEY)
    return Array.isArray(raw) ? raw.filter(isValid) : []
  }
  const raw = readText(indexPath())
  if (raw == null) return []
  try {
    const parsed = JSON.parse(raw) as RepositoryFile
    return Array.isArray(parsed?.repositories) ? parsed.repositories.filter(isValid) : []
  } catch {
    return []
  }
}

function writeAll(list: StoredRepository[]) {
  if (hasFileAccess()) {
    ensureDir(storeDir())
    const payload: RepositoryFile = { version: INDEX_VERSION, repositories: list }
    writeText(indexPath(), JSON.stringify(payload, null, 2))
  } else {
    kv.set(KV_KEY, list)
  }
}

// ---------------------------------------------------------------- 變動通知

const bus = createEmitter()

/** 倉庫清單有變動時通知（加入 / 重整 / 移除）。 */
export const subscribeRepositories = bus.subscribe

// ---------------------------------------------------------------- 對外 API

export function listRepositories(): StoredRepository[] {
  return readAll()
}

export function getRepository(url: string): StoredRepository | undefined {
  return readAll().find(entry => entry.url === url)
}

/** 新增或覆蓋一筆（同 url 保留原本的位置與加入時間由呼叫端決定）。 */
export function saveRepository(repository: StoredRepository) {
  const list = readAll()
  const index = list.findIndex(entry => entry.url === repository.url)
  if (index >= 0) list[index] = repository
  else list.push(repository)
  writeAll(list)
  bus.emit()
}

export function removeRepository(url: string) {
  writeAll(readAll().filter(entry => entry.url !== url))
  bus.emit()
}

/**
 * 從索引 URL 推一個好認的名字：GitHub 風格取 `擁有者/專案`，
 * 其餘取 `主機/第一層目錄`。純顯示用，不影響識別。
 */
export function repositoryNameFor(url: string): string {
  const clean = url.replace(/[?#].*$/, "")
  const match = clean.match(/^(?:https?:\/\/)?([^/]+)(?:\/(.*))?$/i)
  if (!match) return url
  const host = match[1]
  const parts = (match[2] ?? "").split("/").filter(Boolean)
  const dirs = parts.slice(0, -1) // 去掉結尾檔名
  const isGithub = /(^|\.)(githubusercontent|github)\.com$/i.test(host)
  if (isGithub && dirs.length >= 2) return `${dirs[0]}/${dirs[1]}`
  if (/(^|\.)jsdelivr\.net$/i.test(host) && dirs[0] === "gh" && dirs.length >= 3) {
    return `${dirs[1]}/${dirs[2].split("@")[0]}`
  }
  if (dirs.length >= 1) return `${host}/${dirs[0]}`
  return host
}
