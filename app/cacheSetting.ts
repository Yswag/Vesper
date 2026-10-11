// 縮圖快取策略設定：保留天數與容量上限，存於 Storage KV。
// 讀寫、驗值與預設值均集中在此。

import { kv } from "../engine/storage"

/** 保留天數設定：0 代表不限制。 */
export const CACHE_MAX_AGE_DAYS_KEY = "venera:cache:maxAgeDays"
/** 容量上限設定（Bytes）：0 代表不限制。 */
export const CACHE_MAX_SIZE_BYTES_KEY = "venera:cache:maxSizeBytes"

export const DEFAULT_MAX_AGE_DAYS = 30
export const DEFAULT_MAX_SIZE_BYTES = 500 * 1024 * 1024 // 500 MB

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
