import { Script } from "scripting"

import { join, readBytes } from "../fs"

export const DEXVM_VERSION = "v0.2.9"

export const DEXVM_WASM_SHA256 = "37c5d37393d0f5b9ffae4ae8b12a7a024935b6fc5fd78994f94c0e12c9a681b0"
export const DEXVM_HOST_SHA256 = "64d97f8759b660e33a92d4a746c10dbf5729959aa49c4e22691c46eff4c3356d"

export type DexvmAssetName = "dexvm_bridge.wasm" | "dexvm-host.js"

const EXPECTED_SHA256: Record<DexvmAssetName, string> = {
  "dexvm_bridge.wasm": DEXVM_WASM_SHA256,
  "dexvm-host.js": DEXVM_HOST_SHA256,
}

export function dexvmAssetPath(name: DexvmAssetName): string {
  return join(Script.directory, "assets/mihon", name)
}

export function sha256Of(bytes: Uint8Array): string {
  const exact = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
  const buffer = (exact ? bytes.buffer : bytes.slice().buffer) as ArrayBuffer
  return Crypto.sha256(Data.fromArrayBuffer(buffer)!).toHexString().toLowerCase()
}

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

export function forgetDexvmAssets(): void {
  verified = null
}
