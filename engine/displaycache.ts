// 顯示層的已解碼點陣 LRU：只給縮圖（封面、頭像、留言圖）。
//
// 正文刻意不留長期點陣（Canvas 直接吃檔案），但縮圖是格線裡反覆進出的小圖，
// 每次滑回來都重新解一張 1024 寬的檔，在長書架上會明顯卡。
//
// 這裡存的是「已經裁好、縮到格子尺寸」的最終點陣，所以命中時連裁切都省了。

/** 預算（位元組）。一格 360×522 約 0.75MB，大約放得下三十幾格。 */
const MAX_BYTES = 24 * 1024 * 1024

interface Entry {
  image: UIImage
  bytes: number
}

/** 插入順序就是 LRU：命中時搬到最後。 */
const entries = new Map<string, Entry>()
let used = 0

function bytesOf(image: UIImage): number {
  const pixelsWide = image.width * image.scale
  const pixelsHigh = image.height * image.scale
  return Math.max(1, Math.round(pixelsWide * pixelsHigh * 4))
}

export function getDisplayImage(key: string): UIImage | null {
  const hit = entries.get(key)
  if (!hit) return null
  entries.delete(key)
  entries.set(key, hit)
  return hit.image
}

export function putDisplayImage(key: string, image: UIImage): void {
  const size = bytesOf(image)
  if (size > MAX_BYTES) return
  const previous = entries.get(key)
  if (previous) {
    entries.delete(key)
    used -= previous.bytes
  }
  while (used + size > MAX_BYTES && entries.size > 0) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    const entry = entries.get(oldest)
    entries.delete(oldest)
    if (entry) used -= entry.bytes
  }
  entries.set(key, { image, bytes: size })
  used += size
}

export function displayCacheBytes(): number {
  return used
}

export function clearDisplayCache(): void {
  entries.clear()
  used = 0
}
