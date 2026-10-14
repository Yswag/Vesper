// 閱讀器正文渲染管線落地層。
// 將圖片位元組寫入專屬 session 暫存目錄，供 Canvas.drawImage 讀取以避免 UIImage 點陣記憶體累積。

import { appDataRoot, exists, join, listDir, remove, writeBytes } from "./fs"
import { log } from "./log"

/** 一頁「可以直接畫」的東西。畫面只需要這兩個值就能顯示——不必碰 `UIImage`。 */
export interface PageRender {
  /** 可以直接交給 `Canvas.drawImage({ filePath })` 的路徑。 */
  path: string
  /** 寬 / 高。 */
  aspect: number
}

/** 認得的圖檔格式；`bin`＝認不出來（照寫，但記一筆 warning）。 */
type ImageExtension = "jpg" | "png" | "webp" | "gif" | "bin"

/** 每個格式的開頭幾個位元組。 */
const SIGNATURES: Array<{ extension: Exclude<ImageExtension, "bin">; bytes: number[] }> = [
  { extension: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { extension: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { extension: "gif", bytes: [0x47, 0x49, 0x46, 0x38] }, // "GIF8"
]

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false
  for (let index = 0; index < prefix.length; index++) {
    if (bytes[index] !== prefix[index]) return false
  }
  return true
}

/** WebP 是 RIFF 容器：`RIFF` ＋ 4 bytes 長度 ＋ `WEBP`。 */
function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false
  if (!startsWith(bytes, [0x52, 0x49, 0x46, 0x46])) return false // RIFF
  const webp = [0x57, 0x45, 0x42, 0x50] // WEBP
  for (let index = 0; index < 4; index++) {
    if (bytes[8 + index] !== webp[index]) return false
  }
  return true
}

/** 看開頭的位元組猜格式；認不出來回 `"bin"`。 */
function sniffImageExtension(bytes: Uint8Array): ImageExtension {
  if (isWebp(bytes)) return "webp"
  for (const signature of SIGNATURES) {
    if (startsWith(bytes, signature.bytes)) return signature.extension
  }
  return "bin"
}

/** 將原圖寫入 session 暫存檔（已存在則跳過寫入）。 */
export function writePage(dir: string, name: string, bytes: Uint8Array, aspect: number): PageRender | null {
  return writeInto(dir, name, "", bytes, aspect)
}

/**
 * 將超分圖寫入 session 暫存檔（-hi 後綴）。
 * 註：Canvas 依賴不同路徑變動觸發重繪更新。
 */
export function writeSharpenedPage(
  dir: string,
  name: string,
  bytes: Uint8Array,
  aspect: number
): PageRender | null {
  return writeInto(dir, name, "-hi", bytes, aspect)
}

/** 查詢目錄中是否已有處理完畢的超分圖檔案（等比 2×，aspect 不變）。 */
export function findSharpenedPage(dir: string, name: string, aspect: number): PageRender | null {
  const hit = listDir(dir).find(entry => entry.startsWith(`${name}-hi.`))
  if (!hit) return null
  const path = join(dir, hit)
  return exists(path) ? { path, aspect } : null
}

function writeInto(
  dir: string,
  name: string,
  suffix: string,
  bytes: Uint8Array,
  aspect: number
): PageRender | null {
  const extension = sniffImageExtension(bytes)
  const path = join(dir, `${name}${suffix}.${extension}`)
  if (exists(path)) return { path, aspect }
  if (extension === "bin") {
    log("warning", "reader", `${name}${suffix} 的格式認不出來（落 .bin），可能畫不出來`)
  }
  return writeBytes(path, bytes) ? { path, aspect } : null
}

/** 這一刻還在使用中的目錄（開場清理不碰它們）。App 被殺時整個 Set 隨 process 消失。 */
const liveDirs = new Set<string>()
let sequence = 0

/**
 * 建立 session 專屬暫存目錄（名稱帶序號避免並存清理衝突），並清除未被使用的孤兒目錄。
 */
export function openRenderDir(epId: string, root: string = readerRenderRoot()): string {
  const dir = join(root, `${epId || "page"}-${++sequence}`)
  liveDirs.add(dir)
  sweepOrphans(root, dir)
  return dir
}

/** 收掉一個 session 的暫存檔。 */
export function closeRenderDir(dir: string): void {
  liveDirs.delete(dir)
  if (exists(dir) && !remove(dir)) {
    // 刪不掉不是致命的（下次開場的清理會再試），但要看得到——殘檔留著會誤導下一個 session。
    log("debug", "reader", `暫存目錄刪不掉：${dir}`)
  }
}

/** 閱讀器暫存檔的根目錄（一個 session 一個子目錄）。 */
export function readerRenderRoot(): string {
  return join(appDataRoot(), "cache", "reader")
}

function sweepOrphans(root: string, keep: string): void {
  for (const entry of listDir(root)) {
    const path = join(root, entry)
    if (path === keep || liveDirs.has(path)) continue
    remove(path)
  }
}
