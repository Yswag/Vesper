// 顯示層的已解碼點陣 LRU：只給縮圖（封面、頭像、留言圖）。
//
// 正文刻意不留長期點陣（Canvas 直接吃檔案），但縮圖是格線裡反覆進出的小圖，
// 每次滑回來都重新解一張 1024 寬的檔，在長書架上會明顯卡。
//
// 這裡存的是「已經裁好、縮到格子尺寸」的最終點陣，所以命中時連裁切都省了。

/**
 * 預算（位元組）。
 *
 * 一格：三欄網格在大手機上 `comicGridMetrics(393)` → cellWidth 114、cellHeight 165pt，
 * 顯示層存 3× 點數（`CoverImage.DISPLAY_SCALE`）→ 342×495 px，
 * 攤成點陣 342 × 495 × 4 ≈ 0.65MB。
 * 一屏 3 欄 × 3 排（格高 165 + 書名 + 列距，約 205pt 一列，可視高度約 700pt）＝ 9–12 格，
 * 三屏 ≈ 36 格 ≈ 23MB——那是「來回捲動不重解碼」的底。
 * 再留一截給非網格的大圖（詳情頁封面 fit 900×1350 一張就近 4.9MB、留言圖、頭像）→ 40MB。
 * 解碼後的點陣是常駐記憶體，所以停在這裡（上限 64MB）：不為了「不重解碼」無限放大。
 */
const MAX_BYTES = 40 * 1024 * 1024

/**
 * 項目數上限：36 格（三屏）再往上下各留一屏 → 72。
 * 小圖（頭像、留言縮圖）只佔幾十 KB，光靠位元組預算會讓它們堆到幾百個，
 * 每一個都是一個 UIImage 物件加一次查表，所以另外封一個數量上限。
 */
const MAX_ITEMS = 72

interface Entry<T> {
  value: T
  bytes: number
}

export interface LruCache<T> {
  /** 命中就搬到最後（最近用過）：插入順序就是 LRU 順序。 */
  get: (key: string) => T | null
  /** 放不進去（單張就超過位元組預算）回 false。 */
  put: (key: string, value: T, bytes: number) => boolean
  bytes: () => number
  size: () => number
  /** 由舊到新（探針驗淘汰順序用）。 */
  keys: () => string[]
  clear: () => void
}

/**
 * 兩個上限任一到了就從最舊的開始淘汰。純資料結構，不碰 UIImage（探針用假的小項目驗）。
 */
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
      // 單張就超預算：不收，不然它會把整個快取掃空。
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

/** 解碼後的點陣大小：像素寬 × 像素高 × 4（RGBA）。 */
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

/** 預算（探針拿它換算「一格的位元組 × 幾格」，不另外抄一份數字）。 */
export function displayCacheLimits(): { bytes: number; items: number } {
  return { bytes: MAX_BYTES, items: MAX_ITEMS }
}

export function clearDisplayCache(): void {
  cache.clear()
}
