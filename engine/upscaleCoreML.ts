// ACNet 超分的 Core ML + Metal 版（實驗路徑）。
// 由 `upscale.ts` 的 USE_CORE_ML 開關決定用這條還是原本的 wasm 路徑；
// 兩條路的輸入輸出契約相同：吃原始圖片位元組，回 JPEG 位元組。
//
// 資料流（每帶）：
//   裁一條（多帶 PAD 列）→ 上傳 GPU → extract 算整帶 Y → 讀回 Y
//   → 逐塊組 544² 輸入 → Core ML（fp16 輸出寫進預配的 PixelBuffer）→ gather 從貼圖視圖收進槽
//   → 一次 compose 掃完整帶（2x）→ 需要縮小就再一次 downscale → 分段讀回 → ffmpeg 編 JPEG
//
// 不用 copyToTypedArray／copyToData／UIImage.fromRGBA：這個執行期裡它們每次都留下整份資料不回收。
//
// 三個硬限制：
//   1. Metal 只能在 app 前景工作，背景會以 BackgroundExecutionNotPermitted 拒絕。
//   2. 單一 Metal buffer 64MiB。
//   3. 單次 typed array 搬運約 19MB 上限（39MB 會拋 copy budget），讀寫一律分段。
//
// 輸出超過 64MB RGBA 的頁直接回 null，交給 wasm 路徑（那種多半是長條 webtoon）。

import { Script } from "scripting"

import { join } from "../engine/fs"
import { encodeRGBAToJPEG, jpegEncoderAvailable } from "./jpegEncode"
import { log } from "./log"

import type { UpscaleTarget } from "./upscale"

const TILE = 512
const PAD = 16
const SIDE = TILE + PAD * 2 // 544：模型唯一接受的輸入邊長
const OUT = SIDE * 2 // 1088
const MODEL = "ACNet-ane.mlpackage"
const CHUNK = 4 * 1024 * 1024
/** 整張輸出的 RGBA 上限；超過就回 null 讓 wasm 接手。 */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

const SOURCE = `
#include <metal_stdlib>
using namespace metal;

kernel void extract_band(device const uchar4 *src [[buffer(0)]],
                         device float *dst [[buffer(1)]],
                         constant uint &w [[buffer(2)]],
                         uint2 p [[thread_position_in_grid]]) {
  if (p.x >= w) return;
  uchar4 c = src[p.y * w + p.x];
  dst[p.y * w + p.x] = (0.299f * c.x + 0.587f * c.y + 0.114f * c.z) * (1.0f / 255.0f);
}

kernel void gather_tile(texture2d<half, access::read> tile [[texture(0)]],
                        device half *slots [[buffer(0)]],
                        constant uint &slot [[buffer(1)]],
                        uint2 p [[thread_position_in_grid]]) {
  if (p.x >= ${OUT}u || p.y >= ${OUT}u) return;
  slots[slot * ${OUT * OUT}u + p.y * ${OUT}u + p.x] = tile.read(p).r;
}

// 2x 重構：亮度來自模型（fp16 槽），Cb/Cr 從原始像素雙線性取樣。
kernel void compose_band(device const half *slots [[buffer(0)]],
                         device const uchar4 *src [[buffer(1)]],
                         device uchar4 *dst [[buffer(2)]],
                         constant uint &w [[buffer(3)]],
                         constant uint &h [[buffer(4)]],
                         constant uint &srcY0 [[buffer(5)]],
                         constant uint &bandY0 [[buffer(6)]],
                         constant uint &bandRows [[buffer(7)]],
                         constant uint &tilesPerRow [[buffer(8)]],
                         uint2 p [[thread_position_in_grid]]) {
  const uint outW = w * 2u;
  if (p.x >= outW || p.y >= bandRows * 2u) return;

  const uint R = bandY0 + p.y / 2u;
  if (R >= h) return;
  const uint tx = (p.x / ${TILE * 2}u) * ${TILE}u;
  const uint ty = (R / ${TILE}u) * ${TILE}u;
  const uint slot = ((ty - bandY0) / ${TILE}u) * tilesPerRow + tx / ${TILE}u;

  const uint ox0 = tx > ${PAD}u ? ${PAD * 2}u : 0u;
  const uint oy0 = ty > ${PAD}u ? ${PAD * 2}u : 0u;
  const uint gx = ox0 + (p.x - 2u * tx);
  const uint gy = oy0 + 2u * (R - ty) + (p.y & 1u);

  const float sx = (float)p.x * 0.5f;
  const float sy = (float)(2u * R + (p.y & 1u)) * 0.5f;
  const int x0 = (int)floor(sx);
  const int y0 = (int)floor(sy);
  const uint xa = (uint)min(x0, (int)w - 1);
  const uint x1 = (uint)min(x0 + 1, (int)w - 1);
  const uint ya = (uint)min(y0, (int)h - 1);
  const uint yc = (uint)min(y0 + 1, (int)h - 1);
  const float wx = sx - (float)x0;
  const float wy = sy - (float)y0;

  const uint rowA = (ya - srcY0) * w;
  const uint rowB = (yc - srcY0) * w;
  const uchar4 c00 = src[rowA + xa];
  const uchar4 c01 = src[rowA + x1];
  const uchar4 c10 = src[rowB + xa];
  const uchar4 c11 = src[rowB + x1];

  const float a = (1.0f - wx) * (1.0f - wy);
  const float b = wx * (1.0f - wy);
  const float c = (1.0f - wx) * wy;
  const float d = wx * wy;
  const float Rf = (float)c00.x * a + (float)c01.x * b + (float)c10.x * c + (float)c11.x * d;
  const float Gf = (float)c00.y * a + (float)c01.y * b + (float)c10.y * c + (float)c11.y * d;
  const float Bf = (float)c00.z * a + (float)c01.z * b + (float)c10.z * c + (float)c11.z * d;
  const float cb = -0.168736f * Rf - 0.331264f * Gf + 0.5f * Bf;
  const float cr = 0.5f * Rf - 0.418688f * Gf - 0.081312f * Bf;

  const float Y = (float)slots[slot * ${OUT * OUT}u + gy * ${OUT}u + gx] * 255.0f;

  uchar4 rgb;
  rgb.x = (uchar)clamp(Y + 1.402f * cr, 0.0f, 255.0f);
  rgb.y = (uchar)clamp(Y - 0.344136f * cb - 0.714136f * cr, 0.0f, 255.0f);
  rgb.z = (uchar)clamp(Y + 1.772f * cb, 0.0f, 255.0f);
  rgb.w = 255;
  dst[p.y * outW + p.x] = rgb;
}

// 2x → 目標尺寸（面積平均）。只在輸出比 2x 小的時候跑。
kernel void downscale_band(device const uchar4 *src [[buffer(0)]],
                           device uchar4 *dst [[buffer(1)]],
                           constant uint &twoW [[buffer(2)]],
                           constant uint &outW [[buffer(3)]],
                           constant uint &outH [[buffer(4)]],
                           constant uint &twoH [[buffer(5)]],
                           constant uint &bandTwoY0 [[buffer(6)]],
                           constant uint &bandTwoRows [[buffer(7)]],
                           constant uint &outRowStart [[buffer(8)]],
                           constant uint &outRowCount [[buffer(9)]],
                           uint2 p [[thread_position_in_grid]]) {
  if (p.x >= outW || p.y >= outRowCount) return;
  const uint R = outRowStart + p.y;
  if (R >= outH) return;

  const uint x0 = (p.x * twoW) / outW;
  uint x1 = ((p.x + 1u) * twoW + outW - 1u) / outW;
  if (x1 <= x0) x1 = x0 + 1u;
  if (x1 > twoW) x1 = twoW;

  const uint gy0 = (R * twoH) / outH;
  uint gy1 = ((R + 1u) * twoH + outH - 1u) / outH;
  if (gy1 <= gy0) gy1 = gy0 + 1u;

  uint accR = 0, accG = 0, accB = 0, count = 0;
  for (uint gy = gy0; gy < gy1; gy++) {
    if (gy < bandTwoY0 || gy >= bandTwoY0 + bandTwoRows) continue;
    const uint row = (gy - bandTwoY0) * twoW;
    for (uint gx = x0; gx < x1; gx++) {
      const uchar4 c = src[row + gx];
      accR += c.x; accG += c.y; accB += c.z; count++;
    }
  }

  uchar4 rgb;
  if (count == 0u) {
    const uint cy = min(gy0, bandTwoY0 + bandTwoRows - 1u);
    rgb = src[(cy - bandTwoY0) * twoW + min(x0, twoW - 1u)];
  } else {
    rgb.x = (uchar)(accR / count);
    rgb.y = (uchar)(accG / count);
    rgb.z = (uchar)(accB / count);
  }
  rgb.w = 255;
  dst[p.y * outW + p.x] = rgb;
}
`

interface TileOutput {
  pixels: PixelBuffer
  array: CoreML.MultiArray
  texture: Metal.Texture
}

interface Engine {
  model: CoreML.Model
  input: CoreML.MultiArray
  tiles: TileOutput[]
  extract: Metal.ComputePipeline
  gather: Metal.ComputePipeline
  compose: Metal.ComputePipeline
  downscale: Metal.ComputePipeline
  library: Metal.Library
  device: Metal.Device
  source: Metal.Buffer
  y: Metal.Buffer
  slots: Metal.Buffer
  wide: Metal.Buffer
  narrow: Metal.Buffer
  srcBytes: number
  slotBytes: number
  wideBytes: number
  narrowBytes: number
}

interface Scratch {
  out: Uint8Array
  yPlane: Float32Array
  input: Float32Array
}

let engine: Engine | null = null
let engineInitFailed = false
let scratch: Scratch | null = null

function ensureScratch(outBytes: number, yLength: number): Scratch {
  const current: Scratch = scratch ?? {
    out: new Uint8Array(0),
    yPlane: new Float32Array(0),
    input: new Float32Array(SIDE * SIDE),
  }
  if (current.out.length < outBytes) current.out = new Uint8Array(outBytes)
  if (current.yPlane.length < yLength) current.yPlane = new Float32Array(yLength)
  scratch = current
  return current
}

function ensureTileOutputs(built: Engine, count: number): void {
  while (built.tiles.length < count) {
    const pixels = PixelBuffer.create({ width: OUT, height: OUT, format: "gray16Float", metalCompatible: true })
    built.tiles.push({
      pixels,
      array: CoreML.MultiArray.fromPixelBuffer(pixels, [1, 1, OUT, OUT]),
      texture: built.device.makeTextureView({ pixelBuffer: pixels }),
    })
  }
}

function u32(values: number[]): Uint32Array {
  return new Uint32Array(values)
}

/** Core ML 與 Metal 都在（beta 版才有 CoreML；背景執行時 Metal 會晚一步失敗）。 */
export function coreMLAvailable(): boolean {
  try {
    return typeof CoreML !== "undefined" && typeof CoreML.Model?.load === "function" && jpegEncoderAvailable()
  } catch {
    return false
  }
}

function release(): void {
  scratch = null
  if (!engine) return
  try {
    engine.library.dispose()
    for (const tile of engine.tiles) {
      tile.texture.dispose()
      tile.array.dispose()
      tile.pixels.dispose()
    }
    engine.input.dispose()
    engine.extract.dispose()
    engine.gather.dispose()
    engine.compose.dispose()
    engine.downscale.dispose()
    engine.source.dispose()
    engine.y.dispose()
    engine.slots.dispose()
    engine.wide.dispose()
    engine.narrow.dispose()
    engine.model.dispose()
  } catch (error) {
    log("debug", "upscale", "[Core ML] 引擎釋放時出錯", error)
  }
  engine = null
}

async function ensureEngine(wideBytes: number, narrowBytes: number, slotBytes: number, srcBytes: number): Promise<Engine> {
  if (engine) {
    const fits = engine.wideBytes >= wideBytes
      && engine.narrowBytes >= narrowBytes
      && engine.slotBytes >= slotBytes
      && engine.srcBytes >= srcBytes
    if (fits) return engine
    release()
  }
  if (engineInitFailed) throw new Error("Core ML 引擎先前初始化失敗")

  try {
    const device = Metal.Device.getDefault()
    if (!device) throw new Error("沒有 Metal device")

    const model = await CoreML.Model.load(
      join(Script.directory, "assets/acnet", MODEL),
      { computeUnits: "cpuAndNeuralEngine" }
    )
    const library = await device.compileLibrary(SOURCE)
    const built: Engine = {
      model,
      input: CoreML.MultiArray.create({ dtype: "float32", shape: [1, 1, SIDE, SIDE] }),
      tiles: [],
      library,
      device,
      extract: await library.makeComputePipeline("extract_band"),
      gather: await library.makeComputePipeline("gather_tile"),
      compose: await library.makeComputePipeline("compose_band"),
      downscale: await library.makeComputePipeline("downscale_band"),
      source: await device.makeBuffer({ length: srcBytes, storageMode: "shared" }),
      y: await device.makeBuffer({ length: srcBytes, storageMode: "shared" }),
      slots: await device.makeBuffer({ length: slotBytes, storageMode: "shared" }),
      wide: await device.makeBuffer({ length: wideBytes, storageMode: "shared" }),
      narrow: await device.makeBuffer({ length: narrowBytes, storageMode: "shared" }),
      srcBytes,
      slotBytes,
      wideBytes,
      narrowBytes,
    }
    engine = built
    log("info", "upscale", `[Core ML] 引擎就緒（${MODEL}）`)
    return built
  } catch (error) {
    engineInitFailed = true
    log("warning", "upscale", "[Core ML] 引擎初始化失敗", error)
    throw error
  }
}

function bytesOf(view: Uint8Array): Data {
  const buffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
  return Data.fromArrayBuffer(buffer)!
}

function gcdRound(value: number): number {
  return Math.max(TILE, Math.floor(value / TILE) * TILE)
}

/**
 * 跑完一張的 Core ML 超分。回 null 表示「這條路不適用」（太大、被取消），
 * 例外表示真的壞了（呼叫端會退回 wasm 路徑）。
 */
export async function upscaleWithCoreML(
  sourceData: Data,
  target: UpscaleTarget | undefined,
  isCancelled?: () => boolean
): Promise<{ data: Data; ms: number } | null> {
  const page = UIImage.fromData(sourceData)
  if (!page) return null

  const rect = target?.sourceRect ?? { x: 0, y: 0, width: page.width, height: page.height }
  if (rect.width < SIDE || rect.height < SIDE) return null

  const twoW = rect.width * 2
  const twoH = rect.height * 2
  const outW = Math.round(target?.outWidth ?? twoW)
  const outH = Math.round(target?.outHeight ?? twoH)
  const outBytes = outW * outH * 4
  if (outBytes > MAX_OUTPUT_BYTES) return null

  const scaling = outW !== twoW || outH !== twoH
  const tilesPerRow = Math.ceil(rect.width / TILE)

  // 帶高：三個 buffer 的預算取最小
  const rowByte = rect.width * 4
  const carsBySrc = Math.floor((12 * 1048576) / (rowByte * 1))
  const byWide = Math.floor((48 * 1048576) / (twoW * 2 * 4))
  const bySlots = Math.floor((40 * 1048576) / (tilesPerRow * OUT * OUT * 2)) * TILE
  const bandRows = Math.max(TILE, Math.min(2048, gcdRound(carsBySrc), byWide, bySlots))
  const bandMaxRows = bandRows

  const slotRows = Math.ceil(bandMaxRows / TILE)
  const tilesPerBand = tilesPerRow * slotRows
  const srcBytes = rect.width * (bandMaxRows + PAD * 2) * 4
  const slotBytes = tilesPerBand * OUT * OUT * 2
  const wideBytes = twoW * bandMaxRows * 2 * 4
  const narrowBandRows = Math.ceil((bandMaxRows * 2 * outH) / twoH) + 1
  const narrowBytes = Math.max(1024, outW * narrowBandRows * 4)

  const started = Date.now()
  const built = await ensureEngine(wideBytes, narrowBytes, slotBytes, srcBytes)

  ensureTileOutputs(built, tilesPerBand)
  const buffers = ensureScratch(outBytes, rect.width * (bandMaxRows + PAD * 2))
  const out = buffers.out.subarray(0, outBytes)
  const input = buffers.input
  let tiles = 0
  let bands = 0

  try {
    for (let ry0 = 0; ry0 < rect.height; ry0 += bandMaxRows) {
      if (isCancelled && isCancelled()) return null
      const bandRows = Math.min(bandMaxRows, rect.height - ry0)
      const srcY0 = Math.max(0, ry0 - PAD)
      const srcRows = Math.min(rect.height, ry0 + bandRows + PAD) - srcY0

      // 1. 裁這一帶（座標都是相對 sourceRect）
      const bandImage = page.croppedTo({ x: rect.x, y: rect.y + srcY0, width: rect.width, height: srcRows })
      const bandPixels = bandImage?.getPixelData()
      if (!bandPixels) throw new Error(`第 ${bands} 帶裁切失敗`)
      const bandPx = new Uint8Array(bandPixels.data.toArrayBuffer())
      for (let off = 0; off < bandPx.byteLength; off += CHUNK) {
        await built.source.write(bandPx.subarray(off, Math.min(off + CHUNK, bandPx.byteLength)), { offset: off })
      }

      // 2. 整帶的 Y
      await built.extract.dispatch({
        threadgroups: { width: Math.ceil(rect.width / 16), height: Math.ceil(srcRows / 16) },
        threadsPerThreadgroup: { width: 16, height: 16 },
        buffers: [{ index: 0, buffer: built.source }, { index: 1, buffer: built.y }],
        bytes: [{ index: 2, data: u32([rect.width]) }],
      })

      const yPlane = buffers.yPlane.subarray(0, rect.width * srcRows)
      for (let off = 0; off < yPlane.byteLength; off += CHUNK) {
        const length = Math.min(CHUNK, yPlane.byteLength - off)
        const piece = await built.y.read({ offset: off, length })
        new Uint8Array(yPlane.buffer, yPlane.byteOffset + off, length).set(piece.subarray(0, length))
      }

      // 3. 逐塊推論
      let slot = 0
      for (let ty = ry0; ty < ry0 + bandRows; ty += TILE) {
        if (isCancelled && isCancelled()) return null
        const ch = Math.min(TILE, rect.height - ty)
        for (let tx = 0; tx < rect.width; tx += TILE) {
          const cw = Math.min(TILE, rect.width - tx)
          const ix0 = Math.max(0, tx - PAD)
          const iy0 = Math.max(0, ty - PAD)
          const iw = Math.min(rect.width, tx + cw + PAD) - ix0
          const ih = Math.min(rect.height, ty + ch + PAD) - iy0

          if (iw < SIDE || ih < SIDE) input.fill(0)
          for (let r = 0; r < ih; r++) {
            const from = (iy0 - srcY0 + r) * rect.width + ix0
            input.set(yPlane.subarray(from, from + iw), r * SIDE)
          }

          built.input.write(input)
          const backing = built.tiles[slot].array
          const result = await built.model.predict(
            { data: { type: "multiArray", value: built.input } },
            { outputBackings: { output: backing } }
          )
          const feature = result.output
          if (!feature || feature.type !== "multiArray" || feature.value !== backing) {
            throw new Error("模型沒有寫進預配的輸出")
          }
          slot++
          tiles++
        }
      }

      // 4. 模型輸出直接從 PixelBuffer 收進槽（不經 JS 拷貝）
      for (let s = 0; s < slot; s++) {
        await built.gather.dispatch({
          threadgroups: { width: OUT / 16, height: OUT / 16 },
          threadsPerThreadgroup: { width: 16, height: 16 },
          textures: [{ index: 0, texture: built.tiles[s].texture }],
          buffers: [{ index: 0, buffer: built.slots }],
          bytes: [{ index: 1, data: u32([s]) }],
        })
      }

      // 5. 2x 重構
      await built.compose.dispatch({
        threadgroups: { width: Math.ceil(twoW / 16), height: Math.ceil((bandRows * 2) / 16) },
        threadsPerThreadgroup: { width: 16, height: 16 },
        buffers: [
          { index: 0, buffer: built.slots },
          { index: 1, buffer: built.source },
          { index: 2, buffer: built.wide },
        ],
        bytes: [
          { index: 3, data: u32([rect.width]) },
          { index: 4, data: u32([rect.height]) },
          { index: 5, data: u32([srcY0]) },
          { index: 6, data: u32([ry0]) },
          { index: 7, data: u32([bandRows]) },
          { index: 8, data: u32([tilesPerRow]) },
        ],
      })

      // 6. 搬到輸出（必要時先縮）
      if (!scaling) {
        const rowBytes = twoW * 4
        const bandTwoRows = bandRows * 2
        const base = ry0 * 2 * rowBytes
        for (let off = 0; off < bandTwoRows * rowBytes; off += CHUNK) {
          const length = Math.min(CHUNK, bandTwoRows * rowBytes - off)
          const piece = await built.wide.read({ offset: off, length })
          out.set(piece.subarray(0, length), base + off)
        }
      } else {
        const outRowStart = Math.round((ry0 * 2 * outH) / twoH)
        const outRowEnd = Math.round(((ry0 + bandRows) * 2 * outH) / twoH)
        const outRowCount = Math.max(1, outRowEnd - outRowStart)
        await built.downscale.dispatch({
          threadgroups: { width: Math.ceil(outW / 16), height: Math.ceil(outRowCount / 16) },
          threadsPerThreadgroup: { width: 16, height: 16 },
          buffers: [
            { index: 0, buffer: built.wide },
            { index: 1, buffer: built.narrow },
          ],
          bytes: [
            { index: 2, data: u32([twoW]) },
            { index: 3, data: u32([outW]) },
            { index: 4, data: u32([outH]) },
            { index: 5, data: u32([twoH]) },
            { index: 6, data: u32([ry0 * 2]) },
            { index: 7, data: u32([bandRows * 2]) },
            { index: 8, data: u32([outRowStart]) },
            { index: 9, data: u32([outRowCount]) },
          ],
        })
        const rowBytes = outW * 4
        const base = outRowStart * rowBytes
        for (let off = 0; off < outRowCount * rowBytes; off += CHUNK) {
          const length = Math.min(CHUNK, outRowCount * rowBytes - off)
          const piece = await built.narrow.read({ offset: off, length })
          out.set(piece.subarray(0, length), base + off)
        }
      }

      bands++
    }

    // 7. 編碼
    const jpeg = await encodeRGBAToJPEG(outW, outH, out)
    if (!jpeg) return null
    const ms = Date.now() - started
    const freeMB = Math.round(Device.availableMemory / 1048576)
    log("debug", "upscale", `[Core ML] ${outW}×${outH}（${bands} 帶 · ${tiles} 塊 · ${ms}ms · 剩 ${freeMB}MB）`)
    return { data: jpeg, ms }
  } catch (error) {
    log("warning", "upscale", "[Core ML] 超分途中失敗", error)
    release()
    throw error
  }
}

/** 釋放引擎（換話或離開閱讀器時呼叫）。 */
export function disposeCoreML(): void {
  release()
}
