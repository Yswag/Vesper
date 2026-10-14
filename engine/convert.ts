// Convert 模組：提供來源沙箱所需之雜湊（MD5/SHA/HMAC）、對稱加密（AES-CBC/ECB）與編碼轉換。
// 基於 crypto-js 實作，hash 函式回傳 Uint8Array 位元組，符合沙箱 API 規範。

declare const require: (id: string) => any

import { log } from "./log"

let _CryptoJS: any = null
function getCryptoJS(): any {
  if (!_CryptoJS) {
    try {
      _CryptoJS = require("crypto-js")
    } catch {
      throw new Error("crypto-js 尚未安裝，請等待依賴準備完成。")
    }
  }
  return _CryptoJS
}

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

function hexEncode(bytes: Bytes): string {  let out = ""
  for (const b of bytes) out += HEX[b >> 4] + HEX[b & 15]
  return out
}

function fromHex(hex: string): Bytes {
  const clean = hex.replace(/[^0-9a-f]/gi, "")
  const out = new Uint8Array(clean.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16)
  return out
}

/** Uint8Array → CryptoJS WordArray（直接建立，不走 hex，省一次膨脹）。 */
function toWordArray(bytes: Bytes): any {
  return getCryptoJS().lib.WordArray.create(bytes)
}

function fromWordArray(wordArray: any): Bytes {
  const words: number[] = wordArray.words
  const sigBytes: number = wordArray.sigBytes
  const out = new Uint8Array(sigBytes)
  for (let i = 0; i < sigBytes; i++) {
    out[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
  }
  return out
}

type HashName = "md5" | "sha1" | "sha256" | "sha512"

function hashOf(name: HashName): (message: any) => any {
  const C = getCryptoJS()
  if (name === "md5") return C.MD5
  if (name === "sha1") return C.SHA1
  if (name === "sha256") return C.SHA256
  return C.SHA512
}

function hmacOf(name: HashName): (message: any, key: any) => any {
  const C = getCryptoJS()
  if (name === "md5") return C.HmacMD5
  if (name === "sha1") return C.HmacSHA1
  if (name === "sha256") return C.HmacSHA256
  return C.HmacSHA512
}

function hash(name: HashName, value: any): Bytes {
  return fromWordArray(hashOf(name)(toWordArray(toBytes(value))))
}

function hmac(name: HashName, key: any, value: any): Bytes {
  return fromWordArray(hmacOf(name)(toWordArray(toBytes(value)), toWordArray(toBytes(key))))
}

type CipherMode = "ecb" | "cbc" | "cfb" | "ofb"

function modeOf(mode: CipherMode): any {
  const C = getCryptoJS()
  if (mode === "ecb") return C.mode.ECB
  if (mode === "cbc") return C.mode.CBC
  if (mode === "cfb") return C.mode.CFB
  return C.mode.OFB
}

/**
 * AES **裸塊**運算：與 Venera 的 pointycastle 實作一致（`js_engine.dart:442-475` 就是
 * `CBCBlockCipher.processBlock` 逐塊跑），也就是：
 *   - 加密**不加** padding（來源要自己補到 16 的倍數）；
 *   - 解密**不剝** padding（回傳長度＝輸入長度）。
 *
 * 不能改用 CryptoJS 的 Pkcs7：它會在解密時自動幫你剝掉 padding，而源也會自己剝一次
 * （ccc 就是這樣：`decrypted.slice(0, len - padLen)`）→ 資料尾巴被切掉，取不到 `key:iv`。
 * （jm 自己掃 `{`…`}` 找 JSON，兩種都吃，所以只有 ccc 會被影響。）
 */
function aesRun(encrypt: boolean, mode: CipherMode, value: any, key: any, iv?: any): Bytes {
  const C = getCryptoJS()
  const options: any = {
    mode: modeOf(mode),
    padding: C.pad.NoPadding,
  }
  if (mode !== "ecb" && iv == null) {
    throw new Error(`Convert: AES-${mode.toUpperCase()} 需要 iv`)
  }
  if (iv != null) options.iv = toWordArray(toBytes(iv))

  const keyWordArray = toWordArray(toBytes(key))
  const dataWordArray = toWordArray(toBytes(value))

  if (encrypt) {
    return fromWordArray(C.AES.encrypt(dataWordArray, keyWordArray, options).ciphertext)
  }
  const params = C.lib.CipherParams.create({ ciphertext: dataWordArray })
  return fromWordArray(C.AES.decrypt(params, keyWordArray, options))
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
  encodeBase64: (value: any) => getCryptoJS().enc.Base64.stringify(toWordArray(toBytes(value))),
  // 用自己寫的解碼：容許 URL-safe（-_）與空白/換行，而不是讓 crypto-js 對非正規輸入算出垃圾。
  decodeBase64: (value: string) => base64Decode(value),
  md5: (value: any) => hash("md5", value),
  sha1: (value: any) => hash("sha1", value),
  sha256: (value: any) => hash("sha256", value),
  sha512: (value: any) => hash("sha512", value),
  hmac: (key: any, value: any, hashName: string) => hmac(normalizeHash(hashName), key, value),
  hmacString: (key: any, value: any, hashName: string) => hexEncode(hmac(normalizeHash(hashName), key, value)),
  encryptAesEcb: (value: any, key: any) => aesRun(true, "ecb", value, key),
  decryptAesEcb: (value: any, key: any) => aesRun(false, "ecb", value, key),
  encryptAesCbc: (value: any, key: any, iv: any) => aesRun(true, "cbc", value, key, iv),
  decryptAesCbc: (value: any, key: any, iv: any) => aesRun(false, "cbc", value, key, iv),
  encryptAesCfb: (value: any, key: any, iv: any) => aesRun(true, "cfb", value, key, iv),
  decryptAesCfb: (value: any, key: any, iv: any) => aesRun(false, "cfb", value, key, iv),
  encryptAesOfb: (value: any, key: any, _blockSize?: number) => aesRun(true, "ofb", value, key),
  decryptAesOfb: (value: any, key: any, _blockSize?: number) => aesRun(false, "ofb", value, key),
  decryptRsa: (_value: any, _key: any): Bytes => {
    throw new Error("Convert.decryptRsa: 本環境不支援")
  },
  hexEncode: (bytes: any) => hexEncode(toBytes(bytes)),
}

export { toBytes, hexEncode, fromHex }
