import { Buffer } from "node:buffer"
import { gunzipSync } from "node:zlib"

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

export function maybeGunzip(bytes: Uint8Array): Uint8Array {
  if (!isGzip(bytes)) return bytes
  const out = gunzipSync(Buffer.from(bytes) as any) as any
  if (out instanceof Uint8Array) return out
  if (out instanceof ArrayBuffer) return new Uint8Array(out)
  return new Uint8Array(Buffer.from(out))
}
