// 檔案存取的授權與安全讀寫。
//
// Scripting 的 FileManager 需要 `fileSystem` 能力授權，沒授權的話**每一個**呼叫都會失敗
// （連 App 自己的暫存目錄也一樣），錯誤訊息看起來就像「檔案不存在」。所以在碰檔案之前
// 一定要先確保授權，而且要把結果記下來，不要讓每個呼叫各自去猜。

import { Script } from "scripting"

import { log } from "./log"

let granted: boolean | null = null

/** 開場要一次（系統會記住使用者的選擇，已決定過就不再彈）。 */
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

/** null = 還沒問過。 */
export function fileAccess(): boolean | null {
  return granted
}

export function hasFileAccess(): boolean {
  return granted === true
}

/** 所有 App 資料的根目錄（Files app 裡看得到，方便除錯）。 */
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
    // 建立失敗就讓後續的讀寫自己報錯
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

/**
 * 讀整個檔案的位元組。
 *
 * 注意：Scripting 的 `readAsBytesSync` 宣告回 `Uint8Array`，**實際回的是 `ArrayBuffer`**，
 * 直接再丟給 `writeAsBytesSync` 會說「invalid "Data" argument」（連 `Data` 也不收）。
 * 所以這裡一律轉成真正的 `Uint8Array`。
 */
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
