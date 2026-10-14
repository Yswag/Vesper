// 把「一頁的位元組」變成「可以直接畫的檔案」。
//
// 為什麼需要它：`Image` 每顯示一個新的 `UIImage` 就永久留一份點陣（成本 ∝ 像素），
// 而 `Canvas.drawImage({ filePath })` 不會（見 dev/probe-display-via.tsx）。
// 所以正文改走 Canvas——但 Canvas 要的是檔案路徑，於是需要一個地方負責落地。
//
// 生命週期由呼叫端（閱讀 session）決定：`openRenderDir` 開一個專屬目錄，
// `closeRenderDir` 收掉；開場順手清掉被系統殺掉時留下的孤兒（使用中的不會被動）。
// 這裡不做 LRU、不管容量。
//
// 副檔名靠 magic 嗅探（不看原本叫什麼），因為 Canvas／UIImage 是靠內容判斷格式，
// 給對的副檔名可以少一次猜測，也讓目錄在磁碟上看起來是合理的。

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

/**
 * 把原圖寫成 `p<n>.<ext>`。
 *
 * 已經存在就跳過寫入（回捲、重新掛載時省一次工）；寫不進去回 `null`。
 */
export function writePage(dir: string, name: string, bytes: Uint8Array, aspect: number): PageRender | null {
  return writeInto(dir, name, "", bytes, aspect)
}

/**
 * 把超分圖寫成 `p<n>-hi.<ext>`。
 *
 * **必須是不同檔名**：Canvas 的重繪時機是 state／layout 變動，路徑沒變它不會重畫，
 * 原圖換超分圖就不會發生。
 */
export function writeSharpenedPage(
  dir: string,
  name: string,
  bytes: Uint8Array,
  aspect: number
): PageRender | null {
  return writeInto(dir, name, "-hi", bytes, aspect)
}

/**
 * `dir` 裡已經算好的超分圖，沒有就回 `null`。
 *
 * 副檔名是嗅探出來的、不是記下來的，所以用前綴找（`p3-hi.` 開頭的就是）。
 * 用途：回捲或重新掛載時問「超分圖算過了嗎」——算過就直接給它，不重跑推論、也不先閃原圖。
 * `aspect` 沿用原圖的：超分是等比 2×，比例不變。
 */
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
 * 為一個 session 開專屬目錄。
 *
 * 名字帶序號：同一話可能先後／同時存在兩個 session（換話、離線與線上），共用一個目錄的話
 * 其中一個的清理會刪掉另一個正在顯示的檔案。
 *
 * 開場順手清掉 root 底下不是使用中的孤兒——那正是「App 被系統殺掉」留下的東西。
 * `root` 只有探針會傳（讓它不碰真正的 `cache/reader`）。
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
