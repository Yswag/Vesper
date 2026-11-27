import { Convert } from "./convert"
import { appDataRoot, ensureDir, exists, join, listDir, remove, writeBytes } from "./fs"
import { log } from "./log"
import type { SlotHalf } from "./pageslots"

export interface PageRender {
  path: string
  aspect: number
  half?: SlotHalf
}

export interface PageFrame {
  width?: number
  height?: number
  zoom?: number
}

export function fitBox(size: PageFrame, aspect: number): { width: number; height: number } {
  if (size.width !== undefined && size.height !== undefined) {
    const width = Math.min(size.width, size.height * aspect)
    return { width, height: width / aspect }
  }
  if (size.width !== undefined) return { width: size.width, height: size.width / aspect }
  if (size.height !== undefined) return { width: size.height * aspect, height: size.height }
  return { width: 0, height: 0 }
}

export function displayPixels(size: PageFrame, aspect: number): { width: number; height: number } {
  const box = fitBox(size, aspect)
  const scale = Device.screen.scale * (size.zoom ?? 1)
  return { width: Math.round(box.width * scale), height: Math.round(box.height * scale) }
}

export interface PageAspects {
  get(index: number): number | null
  set(index: number, aspect: number): void
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

type ImageExtension = "jpg" | "png" | "webp" | "gif" | "bin"

const SIGNATURES: Array<{ extension: Exclude<ImageExtension, "bin">; bytes: number[] }> = [
  { extension: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { extension: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { extension: "gif", bytes: [0x47, 0x49, 0x46, 0x38] },
]

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false
  for (let index = 0; index < prefix.length; index++) {
    if (bytes[index] !== prefix[index]) return false
  }
  return true
}

function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false
  if (!startsWith(bytes, [0x52, 0x49, 0x46, 0x46])) return false
  const webp = [0x57, 0x45, 0x42, 0x50]
  for (let index = 0; index < 4; index++) {
    if (bytes[8 + index] !== webp[index]) return false
  }
  return true
}

function sniffImageExtension(bytes: Uint8Array): ImageExtension {
  if (isWebp(bytes)) return "webp"
  for (const signature of SIGNATURES) {
    if (startsWith(bytes, signature.bytes)) return signature.extension
  }
  return "bin"
}

export function pageName(index: number, imageKey: string): string {
  const digest = Convert.hexEncode(Convert.md5(Convert.encodeUtf8(imageKey))).slice(0, 8)
  return `p${index}-${digest}`
}

export function findPage(dir: string, name: string): string | null {
  const hit = listDir(dir).find(entry => entry.startsWith(`${name}.`) && !entry.endsWith(".part"))
  if (!hit) return null
  const path = join(dir, hit)
  return exists(path) ? path : null
}

export function writePage(dir: string, name: string, bytes: Uint8Array, aspect: number): PageRender | null {
  return writeInto(dir, name, "", bytes, aspect)
}

export function writeSharpenedPage(
  dir: string,
  name: string,
  bytes: PagePayload,
  aspect: number
): PageRender | null {
  return writeInto(dir, name, "-hi", bytes, aspect)
}

export function findSharpenedPage(dir: string, name: string, aspect: number): PageRender | null {
  const hit = listDir(dir).find(entry => entry.startsWith(`${name}-hi.`) && !entry.endsWith(".part"))
  if (!hit) return null
  const path = join(dir, hit)
  return exists(path) ? { path, aspect } : null
}

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

function prefixOf(bytes: PagePayload): Uint8Array {
  return isData(bytes) ? new Uint8Array(bytes.slice(0, 12).toArrayBuffer()) : bytes
}

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

const liveDirs = new Set<string>()
let sequence = 0

export function openRenderDir(epId: string, root: string = readerRenderRoot()): string {
  const dir = join(root, `${epId || "page"}-${++sequence}`)
  liveDirs.add(dir)
  sweepOrphans(root, dir)
  return dir
}

export function closeRenderDir(dir: string): void {
  liveDirs.delete(dir)
  if (exists(dir) && !remove(dir)) {
    log("debug", "reader", `暫存目錄刪不掉：${dir}`)
  }
}

export function readerRenderRoot(): string {
  return join(appDataRoot(), "cache", "reader")
}

export interface PageIndex {
  readonly dir: string
  find(name: string): string | null
  findSharpened(name: string, aspect: number): PageRender | null
  write(name: string, bytes: Uint8Array, aspect: number): PageRender | null
  writeSharpened(name: string, bytes: PagePayload, aspect: number): PageRender | null
  forget(name: string): void
  clear(): void
  size(): number
}

export function createPageIndex(dir: string, entries: string[] = listDir(dir)): PageIndex {
  const paths = new Map<string, string>()
  const remember = (path: string): void => {
    const entry = path.slice(path.lastIndexOf("/") + 1)
    if (!entry || entry.startsWith(".") || entry.endsWith(".part")) return
    const stem = entry.slice(0, entry.lastIndexOf("."))
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
