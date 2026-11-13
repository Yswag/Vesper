// 閱讀器正文渲染管線落地層。
// 將圖片位元組寫入專屬 session 暫存目錄，供 Canvas.drawImage 讀取以避免 UIImage 點陣記憶體累積。

import { Convert } from "./convert"
import { appDataRoot, ensureDir, exists, join, listDir, remove, writeBytes } from "./fs"
import { log } from "./log"
import type { SlotHalf } from "./pageslots"

/** 一頁「可以直接畫」的東西。畫面只需要這兩個值就能顯示——不必碰 `UIImage`。 */
export interface PageRender {
  /** 可以直接交給 `Canvas.drawImage({ filePath })` 的路徑。 */
  path: string
  /** 整張的寬 / 高（半張檔也是整張的比例）。 */
  aspect: number
  /** 檔案只含這一半（寬圖切割後的超分圖）；沒有＝整張。 */
  half?: SlotHalf
}

/**
 * 一頁可用的顯示框（點）。只給 `width`＝以寬為準（條漫）；只給 `height`＝以高為準（橫向）；
 * 兩者都給＝contain 置中。
 */
export interface PageFrame {
  width?: number
  height?: number
  /** 這一頁最多能放大幾倍（畫廊模式可縮放）；不給＝1。不影響版面，只影響超分輸出多大。 */
  zoom?: number
}

/** 在框裡以 contain 放入 `aspect`（寬/高）的圖；只約束一邊時，另一邊按比例長。 */
export function fitBox(size: PageFrame, aspect: number): { width: number; height: number } {
  if (size.width !== undefined && size.height !== undefined) {
    const width = Math.min(size.width, size.height * aspect)
    return { width, height: width / aspect }
  }
  if (size.width !== undefined) return { width: size.width, height: size.width / aspect }
  if (size.height !== undefined) return { width: size.height * aspect, height: size.height }
  return { width: 0, height: 0 }
}

/** 超分要撐滿的框（像素）：`fitBox` × 螢幕倍率 × 可放大倍率（縮放時會用檔案本身重畫）。 */
export function displayPixels(size: PageFrame, aspect: number): { width: number; height: number } {
  const box = fitBox(size, aspect)
  const scale = Device.screen.scale * (size.zoom ?? 1)
  return { width: Math.round(box.width * scale), height: Math.round(box.height * scale) }
}

/** 每頁的寬高比（key＝頁索引）。長在 session 上：解碼過的頁重掛不必再等一次才知道要多高。 */
export interface PageAspects {
  get(index: number): number | null
  set(index: number, aspect: number): void
  /** 新量到（或變了）的比例。 */
  subscribe(listener: (index: number, aspect: number) => void): () => void
}

export function createPageAspects(): PageAspects {
  const aspects = new Map<number, number>()
  const listeners = new Set<(index: number, aspect: number) => void>()
  return {
    get: index => aspects.get(index) ?? null,
    set: (index, aspect) => {
      if (aspects.get(index) === aspect) return
      aspects.set(index, aspect)
      for (const listener of listeners) listener(index, aspect)
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
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
 * 快取檔名：頁索引＋圖片鍵的短雜湊。
 * 圖片鍵變了（源換圖）就對不上舊檔，不會拿到過期的圖。
 */
export function pageName(index: number, imageKey: string): string {
  const digest = Convert.hexEncode(Convert.md5(Convert.encodeUtf8(imageKey))).slice(0, 8)
  return `p${index}-${digest}`
}

/** 目錄裡這一頁的原圖檔；沒有就 null。超分圖不匹配（名字多一段 `-hi-`），寫到一半的 `.part` 也不算。 */
export function findPage(dir: string, name: string): string | null {
  const hit = listDir(dir).find(entry => entry.startsWith(`${name}.`) && !entry.endsWith(".part"))
  if (!hit) return null
  const path = join(dir, hit)
  return exists(path) ? path : null
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
  bytes: PagePayload,
  aspect: number
): PageRender | null {
  return writeInto(dir, name, "-hi", bytes, aspect)
}

/** 查詢目錄中是否已有處理完畢的超分圖檔案（等比 2×，aspect 不變）。 */
export function findSharpenedPage(dir: string, name: string, aspect: number): PageRender | null {
  const hit = listDir(dir).find(entry => entry.startsWith(`${name}-hi.`) && !entry.endsWith(".part"))
  if (!hit) return null
  const path = join(dir, hit)
  return exists(path) ? { path, aspect } : null
}

/** 寫入用的位元組。超分結果留在原生 `Data` 裡直接寫，不必先複製一份到 JS。 */
export type PagePayload = Uint8Array | Data

function writeInto(
  dir: string,
  name: string,
  suffix: string,
  bytes: PagePayload,
  aspect: number
): PageRender | null {
  const extension = sniffImageExtension(prefixOf(bytes))
  const path = join(dir, `${name}${suffix}.${extension}`)
  if (exists(path)) return { path, aspect }
  if (extension === "bin") {
    log("warning", "reader", `${name}${suffix} 的格式認不出來（落 .bin），可能畫不出來`)
  }
  // 先寫半成品再改名：這些檔會跨 session 存活，不能讓「寫到一半」被下一次當成好檔。
  const temp = `${path}.part`
  if (!writePayload(temp, bytes)) return null
  try {
    if (exists(path)) remove(path)
    FileManager.renameSync(temp, path)
  } catch {
    remove(temp)
    return null
  }
  return { path, aspect }
}

/** 嗅探只看檔頭；`Data` 也只切出那幾個位元組，不把整張複製過來。 */
function prefixOf(bytes: PagePayload): Uint8Array {
  return isData(bytes) ? new Uint8Array(bytes.slice(0, 12).toArrayBuffer()) : bytes
}

/** 看行為而不是 `instanceof`：跨執行環境拿到的 `Data` 一樣算。 */
function isData(bytes: PagePayload): bytes is Data {
  return !(bytes instanceof Uint8Array) && typeof (bytes as Data).toArrayBuffer === "function"
}

function writePayload(path: string, bytes: PagePayload): boolean {
  if (!isData(bytes)) return writeBytes(path, bytes)
  try {
    ensureDir(path.replace(/\/[^/]*$/, ""))
    FileManager.writeAsDataSync(path, bytes)
    return true
  } catch {
    return false
  }
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

/**
 * 一話快取目錄的索引：開章時拿一份目錄清單建好，之後每一頁都查它，不再列舉目錄。
 *
 * 為什麼要有它：連續模式每往下滑一頁都要決定「這一頁在不在磁碟上」，以前每次都要掃整個目錄，
 * 目錄一大就變成翻頁掉幀的來源。
 *
 * 它只是「上次看到什麼」的快照：檔案可能被別人刪掉（另一個 session 收攤、設定頁清快取），
 * 所以查得到不代表讀得到——讀失敗要 `forget()` 之後回去重抓，不能卡在「有索引沒檔」。
 * 檔案仍然只在磁碟上，`dropCache()`（放掉記憶體）不影響它。
 */
export interface PageIndex {
  readonly dir: string
  /** 這一頁的原圖路徑（不含超分圖）。`name` 是 `pageName()` 的結果。 */
  find(name: string): string | null
  /** 這一頁的超分圖（`name` 不含 `-hi`）。 */
  findSharpened(name: string, aspect: number): PageRender | null
  /** 寫原圖，成功就補進索引。 */
  write(name: string, bytes: Uint8Array, aspect: number): PageRender | null
  /** 寫超分圖，成功就補進索引。 */
  writeSharpened(name: string, bytes: PagePayload, aspect: number): PageRender | null
  /** 忘掉一頁（讀檔失敗時用；`name` 與 `find()` 相同）。 */
  forget(name: string): void
  /** 整份丟掉（目錄被清掉、session 收攤）。 */
  clear(): void
  /** 索引裡有幾個檔（除錯與探針用）。 */
  size(): number
}

/**
 * 用一份目錄清單建索引。預設自己列舉一次；`openChapterCache` 會把清理舊檔用的那份清單直接交給它。
 */
export function createPageIndex(dir: string, entries: string[] = listDir(dir)): PageIndex {
  /** 檔名去掉副檔名 → 路徑。同一頁有多種副檔名（或原圖與超分圖並存）時各佔一筆。 */
  const paths = new Map<string, string>()
  const remember = (path: string): void => {
    const entry = path.slice(path.lastIndexOf("/") + 1)
    // `.part` 是寫到一半的、`.` 開頭是標記檔：兩者都不是可以畫的頁。
    if (!entry || entry.startsWith(".") || entry.endsWith(".part")) return
    const stem = entry.slice(0, entry.lastIndexOf("."))
    // 同一個檔名有多種副檔名：留第一個（跟以前掃目錄取第一筆一致）。
    if (!stem || paths.has(stem)) return
    paths.set(stem, path)
  }
  for (const entry of entries) remember(join(dir, entry))
  return {
    dir,
    find: name => paths.get(name) ?? null,
    findSharpened: (name, aspect) => {
      const path = paths.get(`${name}-hi`)
      return path ? { path, aspect } : null
    },
    write: (name, bytes, aspect) => {
      const render = writePage(dir, name, bytes, aspect)
      if (render) remember(render.path)
      return render
    },
    writeSharpened: (name, bytes, aspect) => {
      const render = writeSharpenedPage(dir, name, bytes, aspect)
      if (render) remember(render.path)
      return render
    },
    forget: name => {
      paths.delete(name)
    },
    clear: () => {
      paths.clear()
    },
    size: () => paths.size,
  }
}

function sweepOrphans(root: string, keep: string): void {
  for (const entry of listDir(root)) {
    const path = join(root, entry)
    if (path === keep || liveDirs.has(path)) continue
    remove(path)
  }
}
