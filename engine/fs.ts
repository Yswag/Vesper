import { Script } from "scripting"

import { log } from "./log"

let granted: boolean | null = null

export async function ensureFileAccess(): Promise<boolean> {
  if (granted !== null) return granted
  try {
    const result = await Script.requestAccess(["fileSystem"])
    granted = result.includes("fileSystem")
    log(granted ? "info" : "warning", "fs", granted ? "已取得檔案存取" : "檔案存取被拒絕")
  } catch (error) {
    granted = false
    log("error", "fs", "要求檔案存取失敗", error)
  }
  return granted
}

export function fileAccess(): boolean | null {
  return granted
}

export function hasFileAccess(): boolean {
  return granted === true
}

export function appDataRoot(): string {
  return FileManager.documentsDirectory + "/Vesper"
}

export function join(...parts: string[]): string {
  return parts.join("/").replace(/\/{2,}/g, "/")
}

export function exists(path: string): boolean {
  try {
    return FileManager.existsSync(path)
  } catch {
    return false
  }
}

export function ensureDir(path: string) {
  try {
    if (!FileManager.existsSync(path)) FileManager.createDirectorySync(path, true)
  } catch {
  }
}

export function readText(path: string): string | null {
  try {
    if (!FileManager.existsSync(path)) return null
    return FileManager.readAsStringSync(path)
  } catch {
    return null
  }
}

export function readBytes(path: string): Uint8Array | null {
  try {
    if (!FileManager.existsSync(path)) return null
    const raw = FileManager.readAsBytesSync(path) as unknown
    if (raw instanceof Uint8Array) return raw
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
    const data = raw as { toArrayBuffer?: () => ArrayBuffer } | null
    const toBuffer = data?.toArrayBuffer
    return typeof toBuffer === "function" ? new Uint8Array(toBuffer.call(data)) : null
  } catch {
    return null
  }
}

export function writeBytes(path: string, bytes: Uint8Array | ArrayBuffer): boolean {
  try {
    ensureDir(path.replace(/\/[^/]*$/, ""))
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    FileManager.writeAsBytesSync(path, u8)
    return true
  } catch {
    return false
  }
}

export function writeText(path: string, contents: string): boolean {
  try {
    ensureDir(path.replace(/\/[^/]*$/, ""))
    FileManager.writeAsStringSync(path, contents)
    return true
  } catch {
    return false
  }
}

export function remove(path: string): boolean {
  try {
    if (!FileManager.existsSync(path)) return false
    FileManager.removeSync(path)
    return true
  } catch {
    return false
  }
}

export function listDir(path: string): string[] {
  try {
    if (!FileManager.existsSync(path)) return []
    return FileManager.readDirectorySync(path)
  } catch {
    return []
  }
}
