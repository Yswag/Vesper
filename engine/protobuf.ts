// 最小 protobuf wire 解碼：只解 tag、varint、length-delimited 與 fixed，未知欄位自然跳過。
// 64 位元整數一律 bigint（JS number 只到 2^53），要十進位字串時呼叫端自己 toString()。

export type ProtoWire = 0 | 1 | 2 | 5

export interface ProtoField {
  number: number
  wire: ProtoWire
  /** wire 0／1／5 的整數。 */
  integer?: bigint
  /** wire 2 的內容。 */
  bytes?: Uint8Array
}

function truncated(): never {
  throw new Error("protobuf：資料被截斷")
}

function readVarint(bytes: Uint8Array, at: number): { value: bigint; next: number } {
  let lo = 0
  let hi = 0
  let shift = 0
  let index = at
  for (;;) {
    if (index >= bytes.length) truncated()
    const byte = bytes[index++]
    const part = byte & 0x7f
    if (shift < 32) {
      lo = (lo | (part << shift)) >>> 0
      if (shift > 25) hi = (hi | (part >>> (32 - shift))) >>> 0
    } else {
      hi = (hi | (part << (shift - 32))) >>> 0
    }
    shift += 7
    if ((byte & 0x80) === 0) break
    if (shift > 63) throw new Error("protobuf：varint 太長")
  }
  return { value: (BigInt(hi) << 32n) | BigInt(lo), next: index }
}

function readFixed(bytes: Uint8Array, at: number, size: number): bigint {
  if (at + size > bytes.length) truncated()
  let value = 0n
  for (let index = size - 1; index >= 0; index--) value = (value << 8n) | BigInt(bytes[at + index])
  return value
}

/** 把一段 protobuf 訊息解成欄位陣列（含重複欄位，順序保留）。 */
export function decodeFields(bytes: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = []
  let at = 0
  while (at < bytes.length) {
    const tag = readVarint(bytes, at)
    at = tag.next
    const number = Number(tag.value >> 3n)
    const wire = Number(tag.value & 7n) as ProtoWire
    if (number === 0) throw new Error("protobuf：欄位編號是 0")

    if (wire === 0) {
      const value = readVarint(bytes, at)
      fields.push({ number, wire, integer: value.value })
      at = value.next
    } else if (wire === 1) {
      fields.push({ number, wire, integer: readFixed(bytes, at, 8) })
      at += 8
    } else if (wire === 2) {
      const length = readVarint(bytes, at)
      at = length.next
      const end = at + Number(length.value)
      if (end > bytes.length) truncated()
      fields.push({ number, wire, bytes: bytes.subarray(at, end) })
      at = end
    } else if (wire === 5) {
      fields.push({ number, wire, integer: readFixed(bytes, at, 4) })
      at += 4
    } else {
      throw new Error(`protobuf：不支援的 wire type ${wire}`)
    }
  }
  return fields
}

/** 有號 int64：wire 上是二補數，負數要減回 2^64。 */
export function signedDecimal(value: bigint): string {
  const high = 1n << 63n
  return (value >= high ? value - (1n << 64n) : value).toString()
}
