const MAX_BYTES = 40 * 1024 * 1024

const MAX_ITEMS = 72

interface Entry<T> {
  value: T
  bytes: number
}

export interface LruCache<T> {
  get: (key: string) => T | null
  put: (key: string, value: T, bytes: number) => boolean
  bytes: () => number
  size: () => number
  keys: () => string[]
  clear: () => void
}

export function createLruCache<T>(maxBytes: number, maxItems: number): LruCache<T> {
  const entries = new Map<string, Entry<T>>()
  let used = 0

  return {
    get(key) {
      const hit = entries.get(key)
      if (!hit) return null
      entries.delete(key)
      entries.set(key, hit)
      return hit.value
    },
    put(key, value, bytes) {
      if (bytes > maxBytes) return false
      const previous = entries.get(key)
      if (previous) {
        entries.delete(key)
        used -= previous.bytes
      }
      while (entries.size > 0 && (used + bytes > maxBytes || entries.size >= maxItems)) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        const entry = entries.get(oldest)
        entries.delete(oldest)
        if (entry) used -= entry.bytes
      }
      entries.set(key, { value, bytes })
      used += bytes
      return true
    },
    bytes: () => used,
    size: () => entries.size,
    keys: () => [...entries.keys()],
    clear() {
      entries.clear()
      used = 0
    },
  }
}

function bytesOf(image: UIImage): number {
  const pixelsWide = image.width * image.scale
  const pixelsHigh = image.height * image.scale
  return Math.max(1, Math.round(pixelsWide * pixelsHigh * 4))
}

const cache = createLruCache<UIImage>(MAX_BYTES, MAX_ITEMS)

export function getDisplayImage(key: string): UIImage | null {
  return cache.get(key)
}

export function putDisplayImage(key: string, image: UIImage): void {
  cache.put(key, image, bytesOf(image))
}

export function displayCacheBytes(): number {
  return cache.bytes()
}

export function displayCacheLimits(): { bytes: number; items: number } {
  return { bytes: MAX_BYTES, items: MAX_ITEMS }
}

export function clearDisplayCache(): void {
  cache.clear()
}
