import { Script } from "scripting"
import { join, readBytes } from "./fs"
import { log } from "./log"
import { requirePro } from "./pro"
import { coreMLAvailable, isBackgroundGpuError, upscaleWithCoreML } from "./upscaleCoreML"

const CORE_ML_UPSCALE = true

let serverInstance: HttpServer | null = null
let controllerInstance: WebViewController | null = null
let currentPort = 0

const MAX_UPSCALE_CACHE_SIZE = 6
export type UpscaleBackend = "coreml" | "onnx"
export interface UpscaleResult {
  data: Data
  fromCache: boolean
  backend: UpscaleBackend
}
const sessionCache = new Map<string, { data: Data; backend: UpscaleBackend }>()

function getCachedUpscaleData(key: string): { data: Data; backend: UpscaleBackend } | undefined {
  const item = sessionCache.get(key)
  if (item) {
    sessionCache.delete(key)
    sessionCache.set(key, item)
  }
  return item
}

function setCachedUpscaleData(key: string, data: Data, backend: UpscaleBackend): void {
  if (sessionCache.has(key)) {
    sessionCache.delete(key)
  } else if (sessionCache.size >= MAX_UPSCALE_CACHE_SIZE) {
    const oldestKey = sessionCache.keys().next().value
    if (oldestKey) {
      sessionCache.delete(oldestKey)
      log("debug", "upscale", `超分快取觸發 LRU 淘汰: ${oldestKey}`)
    }
  }
  sessionCache.set(key, { data, backend })
}

let queuePromise = Promise.resolve<any>(null)

export function clearUpscaleCache(): void {
  const size = sessionCache.size
  if (size > 0) {
    sessionCache.clear()
    log("debug", "upscale", `已清空超分圖片記憶體快取，釋放 ${size} 張高解析度圖像`)
  }
  queuePromise = queuePromise.then(
    () => {
      if (controllerInstance) {
        controllerInstance.dispose()
        controllerInstance = null
        log("debug", "upscale", "已安全重置 WebViewController 消除 WebKit 顯存累積")
      }
    },
    () => {
      if (controllerInstance) {
        controllerInstance.dispose()
        controllerInstance = null
      }
    }
  )
}

const TILE = 512
const PAD = 16
const SINGLE_PASS_PIXELS = 2_400_000

export function buildACNetHTML(port: number): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<script src="http://127.0.0.1:${port}/ort.min.js"></script>
<style>body { margin: 0; background: #000; overflow: hidden; }</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
const canvas = document.getElementById("c");
let session = null;

ort.env.wasm.wasmPaths = "http://127.0.0.1:${port}/";
// 透過 loopback 提供 COOP/COEP 以啟用 crossOriginIsolated 與 SharedArrayBuffer；
// 執行緒數以實體核心數為準（上限 8）。
ort.env.wasm.numThreads = Math.min(8, navigator.hardwareConcurrency || 2);

window.initSession = async function() {
  const resp = await fetch("http://127.0.0.1:${port}/anime4k_acnet.onnx");
  const modelBuf = await resp.arrayBuffer();
  session = await ort.InferenceSession.create(modelBuf, { executionProviders: ["wasm"] });
  return true;
};

// 原生端在推論途中翻走時設成 true；每塊之間檢查。
window.cancelRun = false;

// 讓出一個 macrotask（MessageChannel 不像 setTimeout 會被夸到 4ms）。
const yieldChannel = new MessageChannel();
const yieldQueue = [];
yieldChannel.port1.onmessage = () => { const resolve = yieldQueue.shift(); if (resolve) resolve(); };
function yieldToHost() {
  return new Promise(resolve => { yieldQueue.push(resolve); yieldChannel.port2.postMessage(0); });
}

// 一個來源座標（寬或高）落在哪一個／兩個輸出座標、各佔多少（來源像素單位）。只用在縮小（f ≥ 1）。
function areaSpans(srcLen, outLen) {
  const f = srcLen / outLen;
  const first = new Int32Array(srcLen), w0 = new Float32Array(srcLen), w1 = new Float32Array(srcLen);
  for (let s = 0; s < srcLen; s++) {
    const o = Math.min(outLen - 1, Math.floor(s / f));
    const end = (o + 1) * f;
    first[s] = o;
    if (s + 1 <= end || o === outLen - 1) { w0[s] = 1; w1[s] = 0; }
    else { w0[s] = end - s; w1[s] = s + 1 - end; }
  }
  return { first, w0, w1, f };
}

// 串流式面積平均縮小：2x 的列一列一列送進來，完成的輸出列由 emit(y, rgba) 交出。
// 跨列塊交界的輸出列會累加兩邊的貢獻，所以切塊與整張結果相同。
function createShrinker(srcW, srcH, outW, outH, emit) {
  const hx = areaSpans(srcW, outW), vy = areaSpans(srcH, outH);
  const norm = 1 / (hx.f * vy.f);
  let cur = 0;
  let acc0 = new Float32Array(outW * 3), acc1 = new Float32Array(outW * 3);
  let srcRow = 0;
  function flush() {
    const rgba = new Uint8ClampedArray(outW * 4);
    for (let x = 0; x < outW; x++) {
      rgba[x * 4] = acc0[x * 3] * norm; rgba[x * 4 + 1] = acc0[x * 3 + 1] * norm; rgba[x * 4 + 2] = acc0[x * 3 + 2] * norm; rgba[x * 4 + 3] = 255;
    }
    emit(cur, rgba);
    const t = acc0; acc0 = acc1; acc1 = t; acc1.fill(0);
    cur++;
  }
  return {
    // pixels：RGBA，寬 srcW 的一列（offset 起）
    push(pixels, offset) {
      const oy = vy.first[srcRow], a = vy.w0[srcRow], b = vy.w1[srcRow];
      while (cur < oy) flush();
      for (let s = 0; s < srcW; s++) {
        const p = offset + s * 4, o = hx.first[s] * 3, h0 = hx.w0[s], h1 = hx.w1[s];
        const r = pixels[p], g = pixels[p + 1], bl = pixels[p + 2];
        const k00 = a * h0;
        acc0[o] += r * k00; acc0[o + 1] += g * k00; acc0[o + 2] += bl * k00;
        if (h1) { const k01 = a * h1; acc0[o + 3] += r * k01; acc0[o + 4] += g * k01; acc0[o + 5] += bl * k01; }
        if (b) {
          const k10 = b * h0;
          acc1[o] += r * k10; acc1[o + 1] += g * k10; acc1[o + 2] += bl * k10;
          if (h1) { const k11 = b * h1; acc1[o + 3] += r * k11; acc1[o + 4] += g * k11; acc1[o + 5] += bl * k11; }
        }
      }
      srcRow++;
      if (srcRow === srcH) while (cur < outH) flush();
    },
  };
}

/**
 * 切塊超分。opts（皆可省）：
 *   sx/sy/sw/sh 來源矩形（預設整張）；outW/outH 輸出尺寸（預設來源的 2x）；tile/pad 切塊參數。
 * 上下文從整張原圖取，所以只算一部分時結果與整張算完再裁切相同。
 * 逐列（一列塊）組成 2x 帶狀圖、縮到輸出尺寸畫進 canvas；記憶體裡從不放整張 2x。
 * 回傳 "ok" 或 "cancelled"。
 */
window.runACNet = async function(imageUrl, opts) {
  window.cancelRun = false;
  const o = opts || {};
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = imageUrl;
  });

  const W = img.naturalWidth;
  const H = img.naturalHeight;
  if (!W || !H) throw new Error("Image has no size");
  const sx = o.sx || 0, sy = o.sy || 0;
  const sw = o.sw || W - sx, sh = o.sh || H - sy;
  const outW = o.outW || sw * 2, outH = o.outH || sh * 2;
  const tile = o.tile || (sw * sh <= ${SINGLE_PASS_PIXELS} ? Math.max(sw, sh) : ${TILE});
  const pad = o.pad === undefined ? ${PAD} : o.pad;

  const src = document.createElement("canvas");
  src.width = W;
  src.height = H;
  const sctx = src.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(img, 0, 0);
  img.src = "";

  canvas.width = outW;
  canvas.height = outH;
  const octx = canvas.getContext("2d");
  // 縮小（含原尺寸）自己做面積平均；只有比 2x 還大的少數情況交給瀏覽器放大。
  const identity = outW === sw * 2 && outH === sh * 2;
  const shrink = !identity && outW <= sw * 2 && outH <= sh * 2;
  let pending = null;
  const shrinker = shrink
    ? createShrinker(sw * 2, sh * 2, outW, outH, (y, rgba) => {
        if (!pending) pending = { y, rows: [] };
        pending.rows.push(rgba);
      })
    : null;
  function flushPending() {
    if (!pending) return;
    const img = octx.createImageData(outW, pending.rows.length);
    pending.rows.forEach((row, i) => img.data.set(row, i * outW * 4));
    octx.putImageData(img, 0, pending.y);
    pending = null;
  }
  const scaleY = outH / (sh * 2);
  const band = document.createElement("canvas");
  const bctx = band.getContext("2d");
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";

  try {
    for (let ty = sy; ty < sy + sh; ty += tile) {
      const ch = Math.min(tile, sy + sh - ty);
      if (!shrinker && !identity) {
        band.width = sw * 2;
        band.height = ch * 2;
      }
      const bandData = bctx.createImageData(sw * 2, ch * 2);
      const bandPixels = bandData.data;

      for (let tx = sx; tx < sx + sw; tx += tile) {
        // session.run 只用 microtask 接續，不讓出就收不到原生端送來的 cancelRun。
        await yieldToHost();
        if (window.cancelRun) return "cancelled";
        const cw = Math.min(tile, sx + sw - tx);
        const ix0 = Math.max(0, tx - pad), iy0 = Math.max(0, ty - pad);
        const ix1 = Math.min(W, tx + cw + pad), iy1 = Math.min(H, ty + ch + pad);
        const iw = ix1 - ix0, ih = iy1 - iy0;
        const data = sctx.getImageData(ix0, iy0, iw, ih).data;

        // 1. YCbCr（ITU-R BT.601）：Y 送進 ACNet，Cb/Cr 留供彩色重構
        const n = iw * ih;
        const yData = new Float32Array(n);
        const cbData = new Float32Array(n);
        const crData = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
          yData[i]  = ( 0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
          cbData[i] = (-0.168736 * r - 0.331264 * g + 0.5 * b) + 128.0;
          crData[i] = ( 0.5 * r - 0.418688 * g - 0.081312 * b) + 128.0;
        }

        // 2. ACNet 2x
        const feeds = {};
        feeds[session.inputNames[0]] = new ort.Tensor("float32", yData, [1, 1, ih, iw]);
        const results = await session.run(feeds);
        const outputTensor = results[session.outputNames[0]];
        const ow = outputTensor.dims[3];
        const outY = outputTensor.data;

        // 3. 只取塊的中間：超分 Y ＋ 雙線性放大的 Cb/Cr → RGB，寫進帶狀圖
        const ox0 = 2 * (tx - ix0), oy0 = 2 * (ty - iy0);
        const bx0 = 2 * (tx - sx);
        for (let oy = 0; oy < ch * 2; oy++) {
          const gy = oy0 + oy;
          const srcY = gy * 0.5;
          const y0 = Math.floor(srcY);
          const y1 = Math.min(y0 + 1, ih - 1);
          const wy = srcY - y0;
          const srcRow0 = y0 * iw, srcRow1 = y1 * iw;
          const bandRow = oy * sw * 2 + bx0;
          for (let ox = 0; ox < cw * 2; ox++) {
            const gx = ox0 + ox;
            const srcX = gx * 0.5;
            const x0 = Math.floor(srcX);
            const x1 = Math.min(x0 + 1, iw - 1);
            const wx = srcX - x0;
            const cb = (cbData[srcRow0 + x0] * (1 - wx) + cbData[srcRow0 + x1] * wx) * (1 - wy)
                     + (cbData[srcRow1 + x0] * (1 - wx) + cbData[srcRow1 + x1] * wx) * wy - 128.0;
            const cr = (crData[srcRow0 + x0] * (1 - wx) + crData[srcRow0 + x1] * wx) * (1 - wy)
                     + (crData[srcRow1 + x0] * (1 - wx) + crData[srcRow1 + x1] * wx) * wy - 128.0;
            const Y = outY[gy * ow + gx] * 255.0;
            const p = (bandRow + ox) * 4;
            bandPixels[p]     = Math.min(255, Math.max(0, Y + 1.402 * cr));
            bandPixels[p + 1] = Math.min(255, Math.max(0, Y - 0.344136 * cb - 0.714136 * cr));
            bandPixels[p + 2] = Math.min(255, Math.max(0, Y + 1.772 * cb));
            bandPixels[p + 3] = 255;
          }
        }
        if (typeof outputTensor.dispose === "function") outputTensor.dispose();
      }

      // 4. 一列做完：縮到輸出尺寸畫進成品
      if (identity) {
        octx.putImageData(bandData, 0, 2 * (ty - sy));
      } else if (shrinker) {
        for (let r = 0; r < ch * 2; r++) shrinker.push(bandPixels, r * sw * 2 * 4);
        flushPending();
      } else {
        bctx.putImageData(bandData, 0, 0);
        const dy0 = Math.round(2 * (ty - sy) * scaleY);
        const dy1 = Math.round(2 * (ty + ch - sy) * scaleY);
        octx.drawImage(band, 0, dy0, outW, dy1 - dy0);
      }
    }
  } finally {
    src.width = 0; src.height = 0;
    band.width = 0; band.height = 0;
  }
  return "ok";
};

window.resetCanvas = function() {
  canvas.width = 0;
  canvas.height = 0;
};

window.exportJpegBlob = async function(uploadUrl) {
  try {
    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.90));
    await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
    });
  } finally {
    // 關鍵修復：無論成功與否，立即清空 Canvas 寬高以釋放 WebKit GPU Process 的大型像素緩衝區
    window.resetCanvas();
  }
};
</script>
</body>
</html>`;
}

export interface UpscaleTarget {
  sourceRect?: { x: number; y: number; width: number; height: number }
  outWidth: number
  outHeight: number
}

function runOptions(target: UpscaleTarget | undefined): string {
  if (!target) return "{}"
  const rect = target.sourceRect
  return JSON.stringify({
    ...(rect ? { sx: rect.x, sy: rect.y, sw: rect.width, sh: rect.height } : {}),
    outW: Math.round(target.outWidth),
    outH: Math.round(target.outHeight),
  })
}

function cacheKey(key: string, target: UpscaleTarget | undefined): string {
  if (!target) return key
  const rect = target.sourceRect
  const area = rect ? `@${rect.x},${rect.y},${rect.width},${rect.height}` : ""
  return `${key}${area}:${Math.round(target.outWidth)}x${Math.round(target.outHeight)}`
}

let activeSourceData: Data | null = null
let uploadedBuffer: ArrayBuffer | null = null

function staticResponse(bytes: Uint8Array, contentType: string, extraHeaders: Record<string, string> = {}): HttpResponse {
  return HttpResponse.raw(200, "OK", {
    headers: {
      "Content-Type": contentType,
      "Cross-Origin-Resource-Policy": "same-origin",
      ...extraHeaders,
    },
    body: Data.fromArrayBuffer(bytes.buffer as ArrayBuffer)!,
  })
}

async function ensureServer(): Promise<number> {
  if (serverInstance && currentPort) return currentPort
  requirePro("upscale")

  const server = new HttpServer()

  const acnetPath = join(Script.directory, "assets/acnet/anime4k_acnet.onnx")
  const ortJsPath = join(Script.directory, "assets/acnet/ort.min.js")
  const wasmThreadedPath = join(Script.directory, "assets/acnet/ort-wasm-simd-threaded.wasm")
  const wasmFallbackPath = join(Script.directory, "assets/acnet/ort-wasm-simd.wasm")

  const acnetBytes = readBytes(acnetPath)
  const ortJsBytes = readBytes(ortJsPath)
  const wasmThreadedBytes = readBytes(wasmThreadedPath)
  const wasmFallbackBytes = readBytes(wasmFallbackPath)

  if (!acnetBytes || !ortJsBytes || !wasmThreadedBytes || !wasmFallbackBytes) {
    throw new Error("ACNet 資源檔案丟失 (請確認 assets/acnet 目錄完整)")
  }

  server.registerHandler("/", () =>
    staticResponse(new TextEncoder().encode(buildACNetHTML(currentPort)), "text/html; charset=utf-8", {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    })
  )
  server.registerHandler("/feed.jpg", () => {
    if (!activeSourceData) return HttpResponse.notFound()
    return HttpResponse.ok(HttpResponseBody.data(activeSourceData))
  })
  server.registerHandler("/anime4k_acnet.onnx", () => HttpResponse.ok(HttpResponseBody.data(Data.fromArrayBuffer(acnetBytes.buffer as ArrayBuffer)!)))
  server.registerHandler("/ort.min.js", () => staticResponse(ortJsBytes, "text/javascript"))
  server.registerHandler("/ort-wasm-simd-threaded.wasm", () => staticResponse(wasmThreadedBytes, "application/wasm"))
  server.registerHandler("/ort-wasm-simd.wasm", () => staticResponse(wasmFallbackBytes, "application/wasm"))
  server.registerHandler("/upload", req => {
    if (req.body) uploadedBuffer = req.body.toArrayBuffer()
    return HttpResponse.ok(HttpResponseBody.text("ok"))
  })

  const err = server.start({ port: 0 })
  if (err) throw new Error(`HttpServer start failed: ${err}`)
  currentPort = server.port ?? 0
  serverInstance = server
  log("info", "upscale", `[ONNX] 本地靜態伺服器啟動於埠號 ${currentPort}`)
  return currentPort
}

export function upscalePort(): number {
  return currentPort
}

async function ensureEngine(): Promise<void> {
  if (controllerInstance) return

  let createdController: WebViewController | null = null
  try {
    const port = await ensureServer()

    const controller = new WebViewController({ ephemeral: true })
    createdController = controller
    await controller.loadURL(`http://127.0.0.1:${port}/`)
    await controller.waitForLoad()

    await controller.evaluateJavaScript(`return window.initSession();`)
    controllerInstance = controller
    log("info", "upscale", `[ONNX] 引擎就緒（連接埠號 ${port}）`)
  } catch (e) {
    log("warning", "upscale", "[ONNX] 引擎初始化失敗", e)
    if (createdController) {
      try {
        createdController.dispose()
      } catch {}
    }
    controllerInstance = null
    throw e
  }
}

function resetEngineInstances(): void {
  if (controllerInstance) {
    try {
      controllerInstance.dispose()
    } catch {}
    controllerInstance = null
  }
  if (serverInstance) {
    try {
      serverInstance.stop()
    } catch {}
    serverInstance = null
    currentPort = 0
  }
}

export function disposeUpscaleEngine(): void {
  queuePromise = queuePromise.then(
    () => resetEngineInstances(),
    () => resetEngineInstances()
  )
  activeSourceData = null
  uploadedBuffer = null
  sessionCache.clear()
}

async function executeInference(
  key: string,
  sourceData: Data,
  isCancelled?: () => boolean,
  target?: UpscaleTarget
): Promise<Data | null> {
  await ensureEngine()
  const controller = controllerInstance
  if (!controller || !currentPort) return null

  activeSourceData = sourceData
  uploadedBuffer = null

  const inferStart = Date.now()
  let cancelPoll: number | null = null
  if (isCancelled) {
    cancelPoll = setInterval(() => {
      if (!isCancelled()) return
      if (cancelPoll !== null) clearInterval(cancelPoll)
      cancelPoll = null
      void controller.evaluateJavaScript(`window.cancelRun = true; return true;`).catch(() => {})
    }, 100)
  }
  let status: unknown
  try {
    status = await controller.evaluateJavaScript(
      `return window.runACNet("http://127.0.0.1:${currentPort}/feed.jpg", ${runOptions(target)});`
    )
  } finally {
    if (cancelPoll !== null) clearInterval(cancelPoll)
  }

  if (status === "cancelled" || (isCancelled && isCancelled())) {
    try {
      await controller.evaluateJavaScript(`window.resetCanvas && window.resetCanvas();`)
    } catch {}
    return null
  }

  await controller.evaluateJavaScript(`return window.exportJpegBlob("http://127.0.0.1:${currentPort}/upload");`)

  if (!uploadedBuffer) return null

  const outData = Data.fromArrayBuffer(uploadedBuffer)
  if (!outData) return null

  log("debug", "upscale", `[ONNX] 頁面 ${key} 神經網路計算與傳輸耗時 ${Date.now() - inferStart}ms`)
  return outData
}

export const MAX_OUTPUT_PIXELS = 21_000_000

export interface UpscaleSource {
  x?: number
  y?: number
  width: number
  height: number
}

export function planUpscale(
  source: UpscaleSource,
  box: { width: number; height: number }
): UpscaleTarget | null {
  if (source.width <= 0 || source.height <= 0 || box.width <= 0 || box.height <= 0) return null
  const scale = Math.min(box.width / source.width, box.height / source.height)
  if (scale <= 1) return null
  const factor = Math.min(scale, 2)
  const outWidth = Math.round(source.width * factor)
  const outHeight = Math.round(source.height * factor)
  if (outWidth * outHeight > MAX_OUTPUT_PIXELS) return null
  const whole = source.x === undefined && source.y === undefined
  return {
    ...(whole ? {} : { sourceRect: { x: source.x ?? 0, y: source.y ?? 0, width: source.width, height: source.height } }),
    outWidth,
    outHeight,
  }
}

const MEMORY_HEADROOM_BYTES = 160 * 1024 * 1024

function memoryTooLow(target: UpscaleTarget | undefined): boolean {
  const pixels = target ? target.outWidth * target.outHeight : MAX_OUTPUT_PIXELS
  return Device.availableMemory < pixels * 4 * 3 + MEMORY_HEADROOM_BYTES
}

export async function sharpenImage(
  pageKey: string,
  sourceData: Data,
  isCancelled?: () => boolean,
  target?: UpscaleTarget
): Promise<UpscaleResult | null> {
  const key = cacheKey(pageKey, target)
  const cached = getCachedUpscaleData(key)
  if (cached) return { data: cached.data, fromCache: true, backend: cached.backend }

  const runTask = async (): Promise<UpscaleResult | null> => {
    if (isCancelled && isCancelled()) return null

    const doubleCheck = getCachedUpscaleData(key)
    if (doubleCheck) return { data: doubleCheck.data, fromCache: true, backend: doubleCheck.backend }

    if (memoryTooLow(target)) {
      log("warning", "upscale", `記憶體不足（剩 ${Math.round(Device.availableMemory / 1048576)}MB），這頁不超分`)
      return null
    }

    try {
      let sharpened: Data | null = null

      if (CORE_ML_UPSCALE && coreMLAvailable()) {
        try {
          const native = await upscaleWithCoreML(sourceData, target, isCancelled)
          if (native) {
            setCachedUpscaleData(key, native.data, "coreml")
            return { data: native.data, fromCache: false, backend: "coreml" }
          }
          if (isCancelled && isCancelled()) return null
          log("debug", "upscale", "[Core ML] 不適用這張，退回 ONNX")
        } catch (error) {
          if (isBackgroundGpuError(error)) {
            log("debug", "upscale", "[Core ML] App 不在前景，這頁不超分")
            return null
          }
          log("warning", "upscale", "[Core ML] 出錯，退回 ONNX", error)
        }
      }

      try {
        sharpened = await executeInference(key, sourceData, isCancelled, target)
      } catch (firstError) {
        log("warning", "upscale", `[ONNX] 頁面 ${key} 推論異常（可能剛自背景喚醒），重置引擎後重試`, firstError)
        resetEngineInstances()

        if (!isCancelled || !isCancelled()) {
          sharpened = await executeInference(key, sourceData, isCancelled, target)
        }
      }

      if (sharpened) {
        setCachedUpscaleData(key, sharpened, "onnx")
        return { data: sharpened, fromCache: false, backend: "onnx" }
      }
    } catch (finalError) {
      log("warning", "upscale", `[ONNX] 頁面 ${key} 重試後仍失敗，降級原圖`, finalError)
      resetEngineInstances()
    } finally {
      activeSourceData = null
      uploadedBuffer = null
    }
    return null
  }

  const nextPromise = queuePromise.then(runTask, runTask)
  queuePromise = nextPromise
  return nextPromise
}
