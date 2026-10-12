// ONNX ACNet 超解析度服務：利用 Headless WebViewController 執行輕量 21KB anime4k_acnet.onnx。
//
// 特點：
// 1. 純神經網絡 2x 超分辨率重建（針對單通道 Y 亮度推論）。
// 2. 漸進式增強：原圖先見，算好後無縫換圖。
// 3. 具備防重入與 session 快取，關閉閱讀器自動 dispose。

import { Script } from "scripting"
import { exists, join, readBytes } from "./fs"
import { log } from "./log"

let serverInstance: HttpServer | null = null
let controllerInstance: WebViewController | null = null
let currentPort = 0
let initPromise: Promise<void> | null = null

// Session 記憶體快取
const sessionCache = new Map<string, UIImage>()

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
ort.env.wasm.numThreads = 2;

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
};

window.exportJpegBlob = async function(uploadUrl) {
  const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.90));
  await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: blob,
  });
};
</script>
</body>
</html>`;
}

let activeSourceData: Data | null = null
let uploadedBuffer: ArrayBuffer | null = null

async function ensureEngine(): Promise<void> {
  if (controllerInstance && serverInstance) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    try {
      const server = new HttpServer()

      const acnetPath = join(Script.directory, "assets/acnet/anime4k_acnet.onnx")
      const ortJsPath = join(Script.directory, "assets/acnet/ort.min.js")
      const wasmPath = join(Script.directory, "assets/acnet/ort-wasm.wasm")
      const wasmSimdPath = join(Script.directory, "assets/acnet/ort-wasm-simd.wasm")

      const acnetBytes = readBytes(acnetPath)
      const ortJsBytes = readBytes(ortJsPath)
      const wasmBytes = readBytes(wasmPath)
      const wasmSimdBytes = readBytes(wasmSimdPath) || wasmBytes

      if (!acnetBytes || !ortJsBytes || !wasmBytes) {
        throw new Error("ACNet 資源檔案丟失 (請確認 assets/acnet 目錄完整)")
      }

      server.registerHandler("/feed.jpg", () => {
        if (!activeSourceData) return HttpResponse.notFound()
        return HttpResponse.ok(HttpResponseBody.data(activeSourceData))
      })
      server.registerHandler("/anime4k_acnet.onnx", () => HttpResponse.ok(HttpResponseBody.data(Data.fromArrayBuffer(acnetBytes.buffer as ArrayBuffer)!)))
      server.registerHandler("/ort.min.js", () => HttpResponse.ok(HttpResponseBody.data(Data.fromArrayBuffer(ortJsBytes.buffer as ArrayBuffer)!)))
      server.registerHandler("/ort-wasm.wasm", () => HttpResponse.ok(HttpResponseBody.data(Data.fromArrayBuffer(wasmBytes.buffer as ArrayBuffer)!)))
      server.registerHandler("/ort-wasm-simd.wasm", () => HttpResponse.ok(HttpResponseBody.data(Data.fromArrayBuffer(wasmSimdBytes!.buffer as ArrayBuffer)!)))
      server.registerHandler("/upload", req => {
        if (req.body) uploadedBuffer = req.body.toArrayBuffer()
        return HttpResponse.ok(HttpResponseBody.text("ok"))
      })

      const err = server.start({ port: 0 })
      if (err) throw new Error(`HttpServer start failed: ${err}`)
      currentPort = server.port ?? 0
      serverInstance = server

      const controller = new WebViewController({ ephemeral: true })
      await controller.loadHTML(buildACNetHTML(currentPort), `http://127.0.0.1:${currentPort}/`)
      await controller.waitForLoad()
      
      // 初始化 ONNX 會話
      await controller.evaluateJavaScript(`return window.initSession();`)
      controllerInstance = controller
      log("info", "upscale", `ONNX ACNet 神經網絡引擎初始化完成，監聽於埠號 ${currentPort}`)
    } catch (e) {
      log("warning", "upscale", "ONNX ACNet 引擎初始化失敗", e)
      disposeUpscaleEngine()
      throw e
    } finally {
      initPromise = null
    }
  })()

  return initPromise
}

export function disposeUpscaleEngine(): void {
  if (controllerInstance) {
    controllerInstance.dispose()
    controllerInstance = null
  }
  if (serverInstance) {
    serverInstance.stop()
    serverInstance = null
  }
  activeSourceData = null
  uploadedBuffer = null
  sessionCache.clear()
}

/**
 * 對給定的原始圖像 Data 執行真實 ACNet ONNX 神經網路 2x 超解析度。
 */
// 任務串行互斥隊列（避免並發請求覆蓋圖片發生串音）
let queuePromise = Promise.resolve<any>(null)

export async function sharpenImage(key: string, sourceData: Data): Promise<UIImage | null> {
  const cached = sessionCache.get(key)
  if (cached) return cached

  // 透過 Promise 串聯保證嚴格順序執行，徹底消除競爭條件
  const runTask = async () => {
    // 二次檢查快取
    const doubleCheck = sessionCache.get(key)
    if (doubleCheck) return doubleCheck

    try {
      await ensureEngine()
      if (!controllerInstance || !currentPort) return null

      activeSourceData = sourceData
      uploadedBuffer = null

      const inferStart = Date.now()
      // 1. 執行推論
      await controllerInstance.evaluateJavaScript(`return window.runACNet("http://127.0.0.1:${currentPort}/feed.jpg");`)

      // 2. 導出成果
      await controllerInstance.evaluateJavaScript(`return window.exportJpegBlob("http://127.0.0.1:${currentPort}/upload");`)

      if (!uploadedBuffer) return null

      const outData = Data.fromArrayBuffer(uploadedBuffer)
      if (!outData) return null

      const sharpenedImage = UIImage.fromData(outData)
      if (sharpenedImage) {
        sessionCache.set(key, sharpenedImage)
        log("debug", "upscale", `頁面 ${key} 神經網路計算與傳輸耗時 ${Date.now() - inferStart}ms`)
        return sharpenedImage
      }
    } catch (error) {
      log("warning", "upscale", `頁面 ${key} ACNet 超分失敗，降級原圖`, error)
    } finally {
      activeSourceData = null
      uploadedBuffer = null
    }
    return null
  }

  // 將當前任務排入互斥隊列
  const nextPromise = queuePromise.then(runTask, runTask)
  queuePromise = nextPromise
  return nextPromise
}
