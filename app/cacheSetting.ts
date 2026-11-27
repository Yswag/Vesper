import { kv } from "../engine/storage"

export const CACHE_MAX_AGE_DAYS_KEY = "venera:cache:maxAgeDays"
export const CACHE_MAX_SIZE_BYTES_KEY = "venera:cache:maxSizeBytes"

export const DEFAULT_MAX_AGE_DAYS = 30
export const DEFAULT_MAX_SIZE_BYTES = 500 * 1024 * 1024

export const MAX_AGE_DAYS_OPTIONS = [0, 3, 7, 14, 30] as const
export const MAX_SIZE_MB_OPTIONS = [0, 100, 250, 500, 1024] as const

export function getMaxAgeDays(): number {
  const raw = kv.get(CACHE_MAX_AGE_DAYS_KEY)
  if (typeof raw === "number" && (MAX_AGE_DAYS_OPTIONS as readonly number[]).includes(raw)) {
    return raw
  }
  return DEFAULT_MAX_AGE_DAYS
}

export function setMaxAgeDays(days: number): void {
  kv.set(CACHE_MAX_AGE_DAYS_KEY, days)
}

export function getMaxSizeBytes(): number {
  const raw = kv.get(CACHE_MAX_SIZE_BYTES_KEY)
  if (typeof raw === "number" && raw >= 0) {
    return raw
  }
  return DEFAULT_MAX_SIZE_BYTES
}

export function setMaxSizeBytes(bytes: number): void {
  kv.set(CACHE_MAX_SIZE_BYTES_KEY, bytes)
}


export const PAGE_CACHE_MB_KEY = "venera:pagecache:maxMb"
export const PAGE_CACHE_CHAPTERS_KEY = "venera:pagecache:chapters"

export const DEFAULT_PAGE_CACHE_MB = 1024
export const DEFAULT_PAGE_CACHE_CHAPTERS = 5

export const PAGE_CACHE_MB_OPTIONS = [0, 250, 500, 1024, 2048] as const
export const PAGE_CACHE_CHAPTER_OPTIONS = [1, 2, 3, 5, 10] as const

export function getPageCacheBytes(): number {
  const raw = kv.get(PAGE_CACHE_MB_KEY)
  const mb = typeof raw === "number" && raw >= 0 ? raw : DEFAULT_PAGE_CACHE_MB
  return mb * 1024 * 1024
}

export function setPageCacheMb(mb: number): void {
  kv.set(PAGE_CACHE_MB_KEY, mb)
}

export function getPageCacheMb(): number {
  const raw = kv.get(PAGE_CACHE_MB_KEY)
  return typeof raw === "number" && raw >= 0 ? raw : DEFAULT_PAGE_CACHE_MB
}

export function getPageCacheChapters(): number {
  const raw = kv.get(PAGE_CACHE_CHAPTERS_KEY)
  return typeof raw === "number" && raw >= 0 ? raw : DEFAULT_PAGE_CACHE_CHAPTERS
}

export function setPageCacheChapters(chapters: number): void {
  kv.set(PAGE_CACHE_CHAPTERS_KEY, chapters)
}
