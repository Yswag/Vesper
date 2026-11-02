// 從圖檔開頭讀出寬高（不解碼）：JPEG／PNG／GIF／WebP／AVIF・HEIC。
// 預取拿到位元組時就知道比例，畫廊能在翻到之前把寬圖拆好。

export interface ImageSize {
  width: number
  height: number
}

/** 讀不出來（格式不認得或檔頭殘缺）回 null。JPEG 會照 EXIF 方向轉正，與 `UIImage` 的尺寸一致。 */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 24) return null
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return readJpeg(bytes)
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return valid(be32(bytes, 16), be32(bytes, 20))
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return valid(le16(bytes, 6), le16(bytes, 8))
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return readWebp(bytes)
  if (ascii(bytes, 4, 4) === "ftyp") return readHeif(bytes)
  return null
}

/** ISO-BMFF：meta → iprp → ipco 裡的 ispe（取面積最大的，縮圖較小）＋irot 旋轉。 */
function readHeif(bytes: Uint8Array): ImageSize | null {
  const meta = findBox(bytes, 0, bytes.length, "meta")
  if (!meta) return null
  // meta 是 full box：內容前有 4 bytes 版本／旗標
  const iprp = findBox(bytes, meta.start + 4, meta.end, "iprp")
  const ipco = iprp ? findBox(bytes, iprp.start, iprp.end, "ipco") : null
  if (!ipco) return null
  let best: ImageSize | null = null
  let rotated = false
  for (let at = ipco.start; at + 8 <= ipco.end; ) {
    const size = be32(bytes, at)
    if (size < 8) return null
    const type = ascii(bytes, at + 4, 4)
    if (type === "ispe" && at + 20 <= bytes.length) {
      const found = valid(be32(bytes, at + 12), be32(bytes, at + 16))
      if (found && (!best || found.width * found.height > best.width * best.height)) best = found
    }
    if (type === "irot" && at + 8 < bytes.length) rotated = (bytes[at + 8] & 0x03) % 2 === 1
    at += size
  }
  return best && rotated ? { width: best.height, height: best.width } : best
}

function findBox(bytes: Uint8Array, start: number, end: number, type: string): { start: number; end: number } | null {
  for (let at = start; at + 8 <= Math.min(end, bytes.length); ) {
    const size = be32(bytes, at)
    if (size < 8) return null
    if (ascii(bytes, at + 4, 4) === type) return { start: at + 8, end: Math.min(at + size, end) }
    at += size
  }
  return null
}

function readJpeg(bytes: Uint8Array): ImageSize | null {
  let swap = false
  let at = 2
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1]
    // 填充位元組與無長度的標記
    if (marker === 0xff) {
      at++
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2
      continue
    }
    const length = be16(bytes, at + 2)
    if (marker === 0xe1 && ascii(bytes, at + 4, 4) === "Exif") {
      const orientation = exifOrientation(bytes, at + 10, at + 2 + length)
      swap = orientation !== null && orientation >= 5 && orientation <= 8
    }
    // SOF0–SOF15，扣掉 DHT(C4)、JPG(C8)、DAC(CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = be16(bytes, at + 5)
      const width = be16(bytes, at + 7)
      return swap ? valid(height, width) : valid(width, height)
    }
    at += 2 + length
  }
  return null
}

/** TIFF 標頭從 `start` 起；回傳 0x0112 的值。 */
function exifOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  if (start + 8 > end) return null
  const little = bytes[start] === 0x49
  const u16 = (offset: number) => (little ? le16(bytes, offset) : be16(bytes, offset))
  const u32 = (offset: number) => (little ? le32(bytes, offset) : be32(bytes, offset))
  const ifd = start + u32(start + 4)
  if (ifd + 2 > end) return null
  const count = u16(ifd)
  for (let index = 0; index < count; index++) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > end) return null
    if (u16(entry) === 0x0112) return u16(entry + 8)
  }
  return null
}

function readWebp(bytes: Uint8Array): ImageSize | null {
  const chunk = ascii(bytes, 12, 4)
  if (chunk === "VP8 " && bytes.length >= 30) {
    return valid(le16(bytes, 26) & 0x3fff, le16(bytes, 28) & 0x3fff)
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const width = 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8))
    const height = 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10))
    return valid(width, height)
  }
  if (chunk === "VP8X" && bytes.length >= 30) {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16))
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
    return valid(width, height)
  }
  return null
}

function valid(width: number, height: number): ImageSize | null {
  return width > 0 && height > 0 ? { width, height } : null
}

function be16(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) | bytes[at + 1]
}

function le16(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8)
}

function be32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
}

function le32(bytes: Uint8Array, at: number): number {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let text = ""
  for (let index = 0; index < length && at + index < bytes.length; index++) {
    text += String.fromCharCode(bytes[at + index])
  }
  return text
}
