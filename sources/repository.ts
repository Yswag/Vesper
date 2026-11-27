import { createEmitter } from "../engine/emitter"
import { appDataRoot, ensureDir, hasFileAccess, join, readText, writeText } from "../engine/fs"
import { kv } from "../engine/storage"

import type { CatalogEntry } from "./catalog"

const KV_KEY = "venera:repositories"
const INDEX_VERSION = 1

export type RepositoryKind = "venera" | "aidoku-index" | "mihon-index"

export interface RepositoryMeta {
  badgeLabel?: string
  signingKey?: string
  website?: string
  discord?: string
}

export interface StoredRepository {
  url: string
  kind?: RepositoryKind
  name: string
  addedAt: number
  fetchedAt: number
  entries: CatalogEntry[]
  meta?: RepositoryMeta
  error?: string
}

export function repositoryKey(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^(https?:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/)refs\/heads\//, "$1")
    .replace(/\/(index(\.min)?\.json|index\.pb|repo\.json)$/, "")
    .replace(/\/+$/, "")
}

export function isFromRepository(origin: string | null, repositoryUrl: string): boolean {
  return origin !== null && repositoryKey(origin) === repositoryKey(repositoryUrl)
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

export function kindOf(repository: StoredRepository): RepositoryKind {
  if (repository.kind === "aidoku-index") return "aidoku-index"
  if (repository.kind === "mihon-index") return "mihon-index"
  return "venera"
}


let parsedCache: { raw: string; list: StoredRepository[] } | null = null

function readAll(): StoredRepository[] {
  if (!hasFileAccess()) {
    const raw = kv.get(KV_KEY)
    return Array.isArray(raw) ? raw.filter(isValid) : []
  }
  const raw = readText(indexPath())
  if (raw == null) return []
  if (parsedCache !== null && parsedCache.raw === raw) return parsedCache.list
  try {
    const parsed = JSON.parse(raw) as RepositoryFile
    const list = Array.isArray(parsed?.repositories) ? parsed.repositories.filter(isValid) : []
    parsedCache = { raw, list }
    return list
  } catch {
    return []
  }
}

function writeAll(list: StoredRepository[]) {
  if (hasFileAccess()) {
    ensureDir(storeDir())
    const payload: RepositoryFile = { version: INDEX_VERSION, repositories: list }
    const raw = JSON.stringify(payload, null, 2)
    writeText(indexPath(), raw)
    parsedCache = { raw, list }
  } else {
    kv.set(KV_KEY, list)
  }
}


const bus = createEmitter()

export const subscribeRepositories = bus.subscribe


export function listRepositories(): StoredRepository[] {
  return readAll()
}

export function getRepository(url: string): StoredRepository | undefined {
  return readAll().find(entry => entry.url === url)
}

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

export function repositoryNameFor(url: string): string {
  const clean = url.replace(/[?#].*$/, "")
  const match = clean.match(/^(?:https?:\/\/)?([^/]+)(?:\/(.*))?$/i)
  if (!match) return url
  const host = match[1]
  const parts = (match[2] ?? "").split("/").filter(Boolean)
  const dirs = parts.slice(0, -1)
  const isGithub = /(^|\.)(githubusercontent|github)\.com$/i.test(host)
  if (isGithub && dirs.length >= 2) return `${dirs[0]}/${dirs[1]}`
  if (/(^|\.)jsdelivr\.net$/i.test(host) && dirs[0] === "gh" && dirs.length >= 3) {
    return `${dirs[1]}/${dirs[2].split("@")[0]}`
  }
  if (dirs.length >= 1) return `${host}/${dirs[0]}`
  return host
}
