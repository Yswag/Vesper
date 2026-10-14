// ONNX ACNet 超解析度服務：透過 Headless WebViewController 執行 anime4k_acnet.onnx 2x 亮度重建。
// 採串行隊列防重入、LRU session 記憶體快取，並於閱讀器退出時釋放資源。

import { Script } from "scripting"
import { join, readBytes } from "./fs"
import { log } from "./log"

let serverInstance: HttpServer | null = null
let controllerInstance: WebViewController | null = null
let currentPort = 0

// Session 記憶體快取（LRU 上限 6 張，儲存 JPEG 原始位元組避免點陣常駐消耗）。
const MAX_UPSCALE_CACHE_SIZE = 6
const sessionCache = new Map<string, Data>()

function getCachedUpscaleData(key: string): Data | undefined {
  const item = sessionCache.get(key)
  if (item) {
    // LRU: 重新放入尾端標記為最近使用
    sessionCache.delete(key)
    sessionCache.set(key, item)
  }
  return item
}

function setCachedUpscaleData(key: string, data: Data): void {
  if (sessionCache.has(key)) {
    sessionCache.delete(key)
  } else if (sessionCache.size >= MAX_UPSCALE_CACHE_SIZE) {
    // 淘汰最久未存取項目
    const oldestKey = sessionCache.keys().next().value
    if (oldestKey) {
      sessionCache.delete(oldestKey)
      log("debug", "upscale", `超分快取觸發 LRU 淘汰: ${oldestKey}`)
    }
  }
  sessionCache.set(key, data)
}

/**
 * 任務串行互斥隊列：防範推論並發與執行中提前 dispose 引發 WebKit EXC_BAD_ACCESS。
 */
let queuePromise = Promise.resolve<any>(null)

/** 清理當前話／會話的所有超分圖片記憶體快取（換話時呼叫） */
export function clearUpscaleCache(): void {
  const size = sessionCache.size
  if (size > 0) {
    sessionCache.clear()
    log("debug", "upscale", `已清空超分圖片記憶體快取，釋放 ${size} 張高解析度圖像`)
  }
  // 安全重置：將 dispose 排入串行隊列尾端，確保當前飛航推論結束後才安全釋放，絕不在執行途中銷毀
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

function buildACNetHTML(port: number): string {
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

window.runACNet = async function(imageUrl) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = imageUrl;
  });

  const inW = img.naturalWidth;
  const inH = img.naturalHeight;
  if (!inW || !inH || inW * inH > 2500000) {
    throw new Error("Image dimension out of safe upscale bounds");
  }
  
  canvas.width = inW;
  canvas.height = inH;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, inW, inH);
  const data = imgData.data;

  // 1. 提取 YCbCr 色彩空間 (Y 送進 ACNet 超分，Cb/Cr 留存供彩色重構)
  const planeSize = inH * inW;
  const yData = new Float32Array(planeSize);
  const cbData = new Float32Array(planeSize);
  const crData = new Float32Array(planeSize);

  for (let i = 0; i < planeSize; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    
    // ITU-R BT.601 標準色彩轉換
    yData[i]  = ( 0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
    cbData[i] = (-0.168736 * r - 0.331264 * g + 0.5 * b) + 128.0;
    crData[i] = ( 0.5 * r - 0.418688 * g - 0.081312 * b) + 128.0;
  }

  // 2. 執行 ACNet ONNX 亮度神經網絡 2x 超分
  const inputTensor = new ort.Tensor("float32", yData, [1, 1, inH, inW]);
  const feeds = {};
  feeds[session.inputNames[0]] = inputTensor;
  
  const results = await session.run(feeds);
  const outputTensor = results[session.outputNames[0]];

  const outH = outputTensor.dims[2];
  const outW = outputTensor.dims[3];
  const outYData = outputTensor.data;

  canvas.width = outW;
  canvas.height = outH;
  const outImgData = ctx.createImageData(outW, outH);
  const outPixels = outImgData.data;

  // 3. 重構 RGB 像素 (超分後的 Y + 雙線性放大後的 Cb/Cr)
  for (let y = 0; y < outH; y++) {
    const srcY = y * 0.5;
    const y0 = Math.floor(srcY);
    const y1 = Math.min(y0 + 1, inH - 1);
    const wy = srcY - y0;

    const rowOffset = y * outW;
    const srcRow0 = y0 * inW;
    const srcRow1 = y1 * inW;

    for (let x = 0; x < outW; x++) {
      const srcX = x * 0.5;
      const x0 = Math.floor(srcX);
      const x1 = Math.min(x0 + 1, inW - 1);
      const wx = srcX - x0;

      // 雙線性插值採樣色彩色度 (Cb / Cr)
      const cb00 = cbData[srcRow0 + x0]; const cb10 = cbData[srcRow0 + x1];
      const cb01 = cbData[srcRow1 + x0]; const cb11 = cbData[srcRow1 + x1];
      const cbInterp = (cb00 * (1.0 - wx) + cb10 * wx) * (1.0 - wy) + (cb01 * (1.0 - wx) + cb11 * wx) * wy;

      const cr00 = crData[srcRow0 + x0]; const cr10 = crData[srcRow0 + x1];
      const cr01 = crData[srcRow1 + x0]; const cr11 = crData[srcRow1 + x1];
      const crInterp = (cr00 * (1.0 - wx) + cr10 * wx) * (1.0 - wy) + (cr01 * (1.0 - wx) + cr11 * wx) * wy;

      // 取得超分後的高清亮度 Y (0~255)
      const outIdx = rowOffset + x;
      const Y = outYData[outIdx] * 255.0;
      const Cb = cbInterp - 128.0;
      const Cr = crInterp - 128.0;

      // 逆轉換為 RGB
      const R = Y + 1.402 * Cr;
      const G = Y - 0.344136 * Cb - 0.714136 * Cr;
      const B = Y + 1.772 * Cb;

      const pixOffset = outIdx * 4;
      outPixels[pixOffset]     = Math.min(255, Math.max(0, R));
      outPixels[pixOffset + 1] = Math.min(255, Math.max(0, G));
      outPixels[pixOffset + 2] = Math.min(255, Math.max(0, B));
      outPixels[pixOffset + 3] = 255;
    }
  }

  ctx.putImageData(outImgData, 0, 0);

  // 主動釋放大型 Float32Array 與輸入資源，減輕 JS 堆積
  img.src = "";
  if (outputTensor && typeof outputTensor.dispose === "function") {
    outputTensor.dispose();
  }
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

let activeSourceData: Data | null = null
let uploadedBuffer: ArrayBuffer | null = null

/** 帶有 CORP 與 MIME 標頭的本地 HTTP 回應。 */
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

  const server = new HttpServer()

  const acnetPath = join(Script.directory, "assets/acnet/anime4k_acnet.onnx")
  // 採 .txt 副檔名避免大體積 minified JS 觸發型別服務解析異常，執行時以 text/javascript 提供
  const ortJsPath = join(Script.directory, "assets/acnet/ort.min.js.txt")
  const wasmThreadedPath = join(Script.directory, "assets/acnet/ort-wasm-simd-threaded.wasm")
  const wasmFallbackPath = join(Script.directory, "assets/acnet/ort-wasm-simd.wasm")

  const acnetBytes = readBytes(acnetPath)
  const ortJsBytes = readBytes(ortJsPath)
  // 多執行緒時 ORT 要 threaded 版；隔離失效或 numThreads = 1 時它會回頭要非 threaded 那顆。
  const wasmThreadedBytes = readBytes(wasmThreadedPath)
  const wasmFallbackBytes = readBytes(wasmFallbackPath)

  // 兩顆都當成必要資源：不同 build 的 wasm 不能互換，拿 threaded 去頂 fallback 的 URL
  // 只會把「找不到檔」變成更難懂的初始化失敗。
  if (!acnetBytes || !ortJsBytes || !wasmThreadedBytes || !wasmFallbackBytes) {
    throw new Error("ACNet 資源檔案丟失 (請確認 assets/acnet 目錄完整)")
  }

  // 頁面需透過 loopback 提供 COOP/COEP 標頭以啟用多執行緒 WASM 推論
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
  log("info", "upscale", `ACNet 本地靜態伺服器啟動於埠號 ${currentPort}`)
  return currentPort
}

/**
 * 確保 WebViewController 超分執行個體就緒（僅於 queuePromise 隊列內調用）。
 */
async function ensureEngine(): Promise<void> {
  if (controllerInstance) return

  let createdController: WebViewController | null = null
  try {
    const port = await ensureServer()

    const controller = new WebViewController({ ephemeral: true })
    createdController = controller
    await controller.loadURL(`http://127.0.0.1:${port}/`)
    await controller.waitForLoad()

    // 初始化 ONNX 會話
    await controller.evaluateJavaScript(`return window.initSession();`)
    controllerInstance = controller
    log("info", "upscale", `ONNX ACNet 神經網絡引擎就緒 (連接埠號 ${port})`)
  } catch (e) {
    log("warning", "upscale", "ONNX ACNet 引擎初始化失敗", e)
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
  // 排入隊列尾端安全釋放，避免在執行中 dispose 引起 EXC_BAD_ACCESS
  queuePromise = queuePromise.then(
    () => resetEngineInstances(),
    () => resetEngineInstances()
  )
  activeSourceData = null
  uploadedBuffer = null
  sessionCache.clear()
}

/**
 * 單次推論執行的原子操作。
 * 若 iOS 進入後台墓碑模式導致 socket 關閉或 WebKit 行程被終止，此處將拋出異常以供外層捕捉並重試自癒。
 */
async function executeInference(
  key: string,
  sourceData: Data,
  isCancelled?: () => boolean
): Promise<Data | null> {
  await ensureEngine()
  if (!controllerInstance || !currentPort) return null

  activeSourceData = sourceData
  uploadedBuffer = null

  const inferStart = Date.now()
  // 1. 執行推論
  await controllerInstance.evaluateJavaScript(`return window.runACNet("http://127.0.0.1:${currentPort}/feed.jpg");`)

  // 推論完畢再次檢查是否已被翻走；若已離開畫面，立即重置 Canvas 釋放 WebKit 顯存後提早結束
  if (isCancelled && isCancelled()) {
    try {
      await controllerInstance.evaluateJavaScript(`window.resetCanvas && window.resetCanvas();`)
    } catch {}
    return null
  }

  // 2. 導出成果
  await controllerInstance.evaluateJavaScript(`return window.exportJpegBlob("http://127.0.0.1:${currentPort}/upload");`)

  if (!uploadedBuffer) return null

  const outData = Data.fromArrayBuffer(uploadedBuffer)
  if (!outData) return null

  log("debug", "upscale", `頁面 ${key} 神經網路計算與傳輸耗時 ${Date.now() - inferStart}ms`)
  return outData
}

/** 檢查圖像尺寸是否在 ACNet 安全推論像素範圍內（防止 GPU/WASM 顯存溢出）。 */
export function isSafeForUpscale(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false
  if (width >= 1920 || height >= 2560) return false
  return width * height < 2_400_000
}

/**
 * 對原始圖像 Data 執行 ACNet ONNX 2x 神經網路超解析度，返回 JPEG 格式位元組。
 */
export async function sharpenImage(
  key: string,
  sourceData: Data,
  isCancelled?: () => boolean
): Promise<{ data: Data; fromCache: boolean } | null> {
  const cached = getCachedUpscaleData(key)
  if (cached) return { data: cached, fromCache: true }

  // 透過 Promise 串聯保證嚴格順序執行，徹底消除競爭條件
  const runTask = async (): Promise<{ data: Data; fromCache: boolean } | null> => {
    // 檢查呼叫端元件是否已翻走或 unmount；若是，直接跳過神經網路計算，避免翻頁時隊列堆積拖垮 GPU
    if (isCancelled && isCancelled()) return null

    // 二次檢查快取
    const doubleCheck = getCachedUpscaleData(key)
    if (doubleCheck) return { data: doubleCheck, fromCache: true }

    try {
      let sharpened: Data | null = null

      try {
        // 第一次嘗試：樂觀執行（平時 0 額外心跳/檢查開銷）
        sharpened = await executeInference(key, sourceData, isCancelled)
      } catch (firstError) {
        log("warning", "upscale", `推論遇到異常（可能剛自墓碑/背景喚醒），重置引擎並冷啟動重試...`, firstError)
        resetEngineInstances()

        // 第二次嘗試：全新冷啟動重試
        if (!isCancelled || !isCancelled()) {
          sharpened = await executeInference(key, sourceData, isCancelled)
        }
      }

      if (sharpened) {
        setCachedUpscaleData(key, sharpened)
        return { data: sharpened, fromCache: false }
      }
    } catch (finalError) {
      log("warning", "upscale", `頁面 ${key} ACNet 超分重試後仍失敗，降級原圖`, finalError)
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
