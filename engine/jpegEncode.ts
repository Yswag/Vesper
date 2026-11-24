import { appDataRoot, join, remove, writeBytes } from "./fs"

const INSTANCE = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export function jpegEncoderAvailable(): boolean {
  return typeof Shell !== "undefined" && typeof Shell.run === "function"
}

export async function encodeRGBAToJPEG(width: number, height: number, rgba: Uint8Array): Promise<Data | null> {
  if (!jpegEncoderAvailable()) return null
  const dir = join(appDataRoot(), "cache", "upscale-encode")
  const raw = join(dir, `${INSTANCE}.rgba`)
  const jpeg = join(dir, `${INSTANCE}.jpg`)
  try {
    if (!writeBytes(raw, rgba.subarray(0, width * height * 4))) return null
    const result = await Shell.run(
      `ffmpeg -y -loglevel error -f rawvideo -pix_fmt rgba -s ${width}x${height} -i "${raw}" -frames:v 1 -pix_fmt yuvj420p -q:v 2 "${jpeg}"`,
      { timeout: 30 }
    )
    if (result.exitCode !== 0) throw new Error(`ffmpeg ${result.exitCode}：${result.output.slice(0, 200)}`)
    return Data.fromFile(jpeg)
  } finally {
    remove(raw)
    remove(jpeg)
  }
}
