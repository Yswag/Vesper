// Convert 模組：提供來源沙箱所需之雜湊（MD5/SHA/HMAC）、對稱加密（AES 四種模式）與編碼轉換。
// 雜湊與 HMAC 走全域 Crypto（原生 CommonCrypto）；AES 走 node:crypto 的 createCipheriv，
// 兩者都是同步呼叫，符合源端的用法。

import { Buffer } from "node:buffer"
import { createCipheriv, createDecipheriv } from "node:crypto"

import { log } from "./log"

export type Bytes = Uint8Array

const HEX = "0123456789abcdef"

function toBytes(value: any): Bytes {
  if (value == null) return new Uint8Array(0)
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (typeof value === "string") return utf8Encode(value)
  if (Array.isArray(value)) return new Uint8Array(value)
  throw new TypeError("Convert: 不支援的輸入型別")
}

/** 只複製必要區段：呼叫端可能傳進來的是大 buffer 的切片。 */
function toData(bytes: Bytes): Data {
  const buffer = (
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer
  ) as ArrayBuffer
  return Data.fromArrayBuffer(buffer)!
}

function fromData(data: Data): Bytes {
  return new Uint8Array(data.toArrayBuffer())
}

/**
 * node:crypto / node:buffer 的宣告只吃 ArrayBuffer-backed 的緩衝區，型別上對不起來；
 * 執行期只需要一份位元組，所以這裡統一轉一份並把型別放寬。
 */
function toBuffer(bytes: Bytes): any {
  return Buffer.from(Array.from(bytes))
}

function utf8Encode(str: string): Bytes {
  const out: number[] = []
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
        i++
      }
    }
    if (code < 0x80) out.push(code)
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
  }
  return new Uint8Array(out)
}

// 逐位元組解 UTF-8，遇到無效序列以 U+FFFD 取代，避免解密資料觸發 URIError 導致中斷。
function utf8Decode(bytes: Bytes): string {
  let out = ""
  let invalid = 0
  let i = 0
  while (i < bytes.length) {
    const b0 = bytes[i]
    if (b0 < 0x80) {
      out += String.fromCharCode(b0)
      i++
      continue
    }
    let need = 0
    let code = 0
    if ((b0 & 0xe0) === 0xc0) {
      need = 1
      code = b0 & 0x1f
    } else if ((b0 & 0xf0) === 0xe0) {
      need = 2
      code = b0 & 0x0f
    } else if ((b0 & 0xf8) === 0xf0) {
      need = 3
      code = b0 & 0x07
    } else {
      invalid++
      out += "\uFFFD"
      i++
      continue
    }
    if (i + need >= bytes.length) {
      invalid++
      out += "\uFFFD"
      i++
      continue
    }
    let valid = true
    for (let k = 1; k <= need; k++) {
      const b = bytes[i + k]
      if ((b & 0xc0) !== 0x80) {
        valid = false
        break
      }
      code = (code << 6) | (b & 0x3f)
    }
    if (!valid || code > 0x10ffff) {
      invalid++
      out += "\uFFFD"
      i++
      continue
    }
    i += need + 1
    if (code >= 0x10000) {
      const offset = code - 0x10000
      out += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff))
    } else {
      out += String.fromCharCode(code)
    }
  }
  if (invalid > 0) log("debug", "convert", `decodeUtf8：${invalid} 個無效位元組序列（已用 U+FFFD 取代）`)
  return out
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/** 容錯的 base64 解碼：接受 URL-safe（-_）與空白/換行，忽略填字。 */
function base64Decode(value: string): Bytes {
  const clean = String(value ?? "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/[^A-Za-z0-9+/]/g, "")
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let p = 0
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1] ?? "A") << 12) |
      ((clean[i + 2] ? B64.indexOf(clean[i + 2]) : 0) << 6) |
      (clean[i + 3] ? B64.indexOf(clean[i + 3]) : 0)
    if (p < out.length) out[p++] = (n >> 16) & 0xff
    if (p < out.length) out[p++] = (n >> 8) & 0xff
    if (p < out.length) out[p++] = n & 0xff
  }
  return out
}

function base64Encode(bytes: Bytes): string {
  let out = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "="
    out += i + 2 < bytes.length ? B64[n & 63] : "="
  }
  return out
}

function hexEncode(bytes: Bytes): string {
  let out = ""
  for (const b of bytes) out += HEX[b >> 4] + HEX[b & 15]
  return out
}

function fromHex(hex: string): Bytes {
  const clean = hex.replace(/[^0-9a-f]/gi, "")
  const out = new Uint8Array(clean.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16)
  return out
}

type HashName = "md5" | "sha1" | "sha256" | "sha512"

function hash(name: HashName, data: Data): Data {
  if (name === "md5") return Crypto.md5(data)
  if (name === "sha1") return Crypto.sha1(data)
  if (name === "sha256") return Crypto.sha256(data)
  return Crypto.sha512(data)
}

function hmac(name: HashName, data: Data, key: Data): Data {
  if (name === "md5") return Crypto.hmacMD5(data, key)
  if (name === "sha1") return Crypto.hmacSHA1(data, key)
  if (name === "sha256") return Crypto.hmacSHA256(data, key)
  return Crypto.hmacSHA512(data, key)
}

function hashOf(name: HashName, value: any): Bytes {
  return fromData(hash(name, toData(toBytes(value))))
}

function hmacOf(name: HashName, key: any, value: any): Bytes {
  return fromData(hmac(name, toData(toBytes(value)), toData(toBytes(key))))
}

type CipherMode = "ecb" | "cbc" | "cfb" | "ofb"

/**
 * AES **裸塊**運算：與 Venera 的 pointycastle 實作一致（`js_engine.dart:442-475` 就是
 * `CBCBlockCipher.processBlock` 逐塊跑），也就是加密不加 padding、解密不剝 padding。
 * 源會自己補／自己剝（ccc 就是這樣），所以 `setAutoPadding(false)` 是必須的。
 */
function aesRun(encrypt: boolean, mode: CipherMode, value: any, key: any, iv?: any): Bytes {
  if (mode !== "ecb" && iv == null) throw new Error(`Convert: AES-${mode.toUpperCase()} 需要 iv`)
  const keyBytes = toBytes(key)
  if (keyBytes.length !== 16 && keyBytes.length !== 24 && keyBytes.length !== 32) {
    throw new Error(`Convert: AES 金鑰長度必須是 16/24/32 bytes（收到 ${keyBytes.length}）`)
  }
  // ECB 的實作會讀 iv.length，而且只接受 0 長度（null 與 16 bytes 都會拋）。
  const ivBuf = mode === "ecb" ? Buffer.alloc(0) : toBuffer(toBytes(iv))
  const cipher = (encrypt ? createCipheriv : createDecipheriv)(
    `aes-${keyBytes.length * 8}-${mode}`,
    toBuffer(keyBytes),
    ivBuf
  )
  cipher.setAutoPadding(false)
  const out = Buffer.concat([cipher.update(toBuffer(toBytes(value))), cipher.final()])
  return Uint8Array.from(out)
}

function normalizeHash(name: string): HashName {
  const lower = String(name ?? "sha256").toLowerCase()
  if (lower === "md5" || lower === "sha1" || lower === "sha256" || lower === "sha512") return lower
  return "sha256"
}

export const Convert = {
  encodeUtf8: (str: string) => utf8Encode(str),
  decodeUtf8: (value: any) => utf8Decode(toBytes(value)),
  // 這兩個在 catalog 裡沒有任何源使用。與其靜默回傳壞字串，不如明確報錯。
  encodeGbk: (_str: string): Bytes => {
    throw new Error("Convert.encodeGbk: 本環境不支援（請回報是哪個源需要）")
  },
  decodeGbk: (_value: any): string => {
    throw new Error("Convert.decodeGbk: 本環境不支援（請回報是哪個源需要）")
  },
  encodeBase64: (value: any) => base64Encode(toBytes(value)),
  decodeBase64: (value: string) => base64Decode(value),
  md5: (value: any) => hashOf("md5", value),
  sha1: (value: any) => hashOf("sha1", value),
  sha256: (value: any) => hashOf("sha256", value),
  sha512: (value: any) => hashOf("sha512", value),
  hmac: (key: any, value: any, hashName: string) => hmacOf(normalizeHash(hashName), key, value),
  hmacString: (key: any, value: any, hashName: string) => hexEncode(hmacOf(normalizeHash(hashName), key, value)),
  encryptAesEcb: (value: any, key: any) => aesRun(true, "ecb", value, key),
  decryptAesEcb: (value: any, key: any) => aesRun(false, "ecb", value, key),
  encryptAesCbc: (value: any, key: any, iv: any) => aesRun(true, "cbc", value, key, iv),
  decryptAesCbc: (value: any, key: any, iv: any) => aesRun(false, "cbc", value, key, iv),
  encryptAesCfb: (value: any, key: any, iv: any) => aesRun(true, "cfb", value, key, iv),
  decryptAesCfb: (value: any, key: any, iv: any) => aesRun(false, "cfb", value, key, iv),
  // OFB 在上游沒有 iv 參數（`OFBBlockCipher(AESEngine(), blockSize)`），這裡也因此取不到 iv：
  // 保留原簽名，用了就明確報錯，不要靜默把 blockSize 當 iv。
  encryptAesOfb: (value: any, key: any, _blockSize?: number) => aesRun(true, "ofb", value, key),
  decryptAesOfb: (value: any, key: any, _blockSize?: number) => aesRun(false, "ofb", value, key),
  decryptRsa: (_value: any, _key: any): Bytes => {
    throw new Error("Convert.decryptRsa: 本環境不支援")
  },
  hexEncode: (bytes: any) => hexEncode(toBytes(bytes)),
}

export { toBytes, hexEncode, fromHex }
