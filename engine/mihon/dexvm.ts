// dexvm-wasm 的兩個成品檔（release 的 SHA256SUMS）：wasm 會執行第三方 apk 的位元組，
// loader 與 wasm 又共用同一個 ABI，所以載入前一定要驗，且兩個檔案要成對升級。
//
// 驗過的位元組留在記憶體：伺服器供出去的就是驗過的那一份，不會出現「驗的是 A、跑的是 B」。

import { Script } from "scripting"

import { join, readBytes } from "../fs"

export const DEXVM_VERSION = "v0.2.9"

/** `dist/dexvm_bridge.wasm`。 */
export const DEXVM_WASM_SHA256 = "37c5d37393d0f5b9ffae4ae8b12a7a024935b6fc5fd78994f94c0e12c9a681b0"
/** `dexvm-host.js`（WASI 子集與 `host` import 的 shim）。 */
export const DEXVM_HOST_SHA256 = "64d97f8759b660e33a92d4a746c10dbf5729959aa49c4e22691c46eff4c3356d"

export type DexvmAssetName = "dexvm_bridge.wasm" | "dexvm-host.js"

const EXPECTED_SHA256: Record<DexvmAssetName, string> = {
  "dexvm_bridge.wasm": DEXVM_WASM_SHA256,
  "dexvm-host.js": DEXVM_HOST_SHA256,
}

export function dexvmAssetPath(name: DexvmAssetName): string {
  return join(Script.directory, "assets/mihon", name)
}

/** 檔案的 SHA-256（小寫十六進位）。 */
export function sha256Of(bytes: Uint8Array): string {
  const exact = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
  const buffer = (exact ? bytes.buffer : bytes.slice().buffer) as ArrayBuffer
  return Crypto.sha256(Data.fromArrayBuffer(buffer)!).toHexString().toLowerCase()
}

/** 位元組與釘住的雜湊不符時回原因；相符回 null。 */
export function checksumFailure(name: DexvmAssetName, bytes: Uint8Array): string | null {
  const actual = sha256Of(bytes)
  const expected = EXPECTED_SHA256[name]
  if (actual === expected) return null
  return `assets/mihon/${name} 的 SHA-256 不符（dexvm ${DEXVM_VERSION}）：預期 ${expected}，實際 ${actual}`
}

export interface DexvmAssets {
  wasm: Uint8Array
  host: Uint8Array
}

let verified: DexvmAssets | null = null

/** 讀進來、驗過、留在記憶體。缺檔或雜湊不符都直接拋（訊息要能說明是哪一個檔）。 */
export function dexvmAssets(): DexvmAssets {
  if (verified) return verified
  const wasm = readVerified("dexvm_bridge.wasm")
  const host = readVerified("dexvm-host.js")
  verified = { wasm, host }
  return verified
}

function readVerified(name: DexvmAssetName): Uint8Array {
  const bytes = readBytes(dexvmAssetPath(name))
  if (!bytes || bytes.byteLength === 0) throw new Error(`assets/mihon/${name} 不存在或讀不到`)
  const failure = checksumFailure(name, bytes)
  if (failure) throw new Error(failure)
  return bytes
}

/** 測試或升級後重新驗一次（探針會在換檔後叫）。 */
export function forgetDexvmAssets(): void {
  verified = null
}
