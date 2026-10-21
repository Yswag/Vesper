// 讀 ZIP：`.aix` 是 zip，安裝時要把它解成 `Payload/` 的檔案。
// 這個 runtime 沒有 `DecompressionStream`，deflate 走 node:zlib 的 `inflateRawSync`（要餵 Buffer）。

import { Buffer } from "node:buffer"
import { inflateRawSync } from "node:zlib"

export interface ZipEntry {
  name: string
  bytes: Uint8Array
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
/** 沒有註解的 EOCD 是 22 bytes；註解上限 64KB。 */
const EOCD_SEARCH = 0xffff + 22

function findEocd(view: DataView): number {
  const stop = Math.max(0, view.byteLength - EOCD_SEARCH)
  for (let at = view.byteLength - 22; at >= stop; at--) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at
  }
  throw new Error("不是 ZIP：找不到 EOCD")
}

function inflate(raw: Uint8Array): Uint8Array {
  const out = inflateRawSync(Buffer.from(raw) as any) as any
  if (out instanceof Uint8Array) return out
  if (out instanceof ArrayBuffer) return new Uint8Array(out)
  return new Uint8Array(Buffer.from(out))
}

/** 解出全部檔案（只支援 store 與 deflate，這兩種就是 zip 的預設）。 */
export function unzip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEocd(view)
  const count = view.getUint16(eocd + 10, true)
  let at = view.getUint32(eocd + 16, true)

  const entries: ZipEntry[] = []
  for (let index = 0; index < count; index++) {
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw new Error("ZIP 的中央目錄壞了")
    const method = view.getUint16(at + 10, true)
    const compressedSize = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const localOffset = view.getUint32(at + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))

    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) throw new Error(`ZIP 的本地標頭壞了：${name}`)
    const localName = view.getUint16(localOffset + 26, true)
    const localExtra = view.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + localName + localExtra
    const data = bytes.subarray(start, start + compressedSize)

    if (!name.endsWith("/")) {
      if (method === 0) entries.push({ name, bytes: data.slice() })
      else if (method === 8) entries.push({ name, bytes: inflate(data) })
      else throw new Error(`ZIP 壓縮方式不支援（${method}）：${name}`)
    }
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}
