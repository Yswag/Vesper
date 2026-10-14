// 圖像後處理（modifyImage）沙箱：執行來源自訂的 JavaScript 圖片重排演算法。
// 內部紀錄 ImageOp 貼圖操作序列，最終由 UI 注入的 ImageCompositor 進行合成輸出。

import { sandboxView } from "./globals"

/** 一張來源圖的某個矩形，貼到輸出的 (dx, dy)，可選擇順時針轉幾個 90°。 */
export interface ImageOp {
  src: UIImage
  sx: number
  sy: number
  sw: number
  sh: number
  dx: number
  dy: number
  /** 0..3，順時針 90° 的倍數（奇數時目的寬高會互換）。 */
  quarterTurns: number
}

export interface Composition {
  width: number
  height: number
  ops: ImageOp[]
}

/** 由 UI 層注入：把貼圖清單變成一張 PNG 的位元組。 */
export type ImageCompositor = (composition: Composition) => Promise<Uint8Array>

function positiveInt(name: string, value: number) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} 必須是正整數（收到 ${value}）`)
}

function inRange(name: string, start: number, length: number, limit: number) {
  if (!Number.isInteger(start) || start < 0 || start + length > limit) {
    throw new Error(`${name}=${start} 加上長度 ${length} 超出了 0..${limit}`)
  }
}

/** 貼圖在目的空間佔的尺寸（轉了奇數次 90° 就會互換）。 */
export function opDestSize(op: ImageOp): { width: number; height: number } {
  return op.quarterTurns % 2 === 1 ? { width: op.sh, height: op.sw } : { width: op.sw, height: op.sh }
}

/** 目的矩形（貼圖內部座標）反推來源矩形；k 是順時針 90° 的倍數。 */
function unmapSource(k: number, sw: number, sh: number, x0: number, x1: number, y0: number, y1: number) {
  switch (k & 3) {
    case 1:
      return { x: y0, y: sh - x1, width: y1 - y0, height: x1 - x0 }
    case 2:
      return { x: sw - x1, y: sh - y1, width: x1 - x0, height: y1 - y0 }
    case 3:
      return { x: sw - y1, y: x0, width: y1 - y0, height: x1 - x0 }
    default:
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  }
}

/**
 * 把一張貼圖裁到指定矩形內，座標以該矩形的左上角為原點；完全在外就回 null。
 * 一定要裁：來源的貼圖常常比請求的區塊大（例如整張圖被切出一條帶）。
 */
function clipOp(op: ImageOp, x: number, y: number, width: number, height: number): ImageOp | null {
  const size = opDestSize(op)
  const left = Math.max(op.dx, x)
  const top = Math.max(op.dy, y)
  const right = Math.min(op.dx + size.width, x + width)
  const bottom = Math.min(op.dy + size.height, y + height)
  if (right <= left || bottom <= top) return null
  const k = op.quarterTurns & 3
  const src = unmapSource(k, op.sw, op.sh, left - op.dx, right - op.dx, top - op.dy, bottom - op.dy)
  return {
    src: op.src,
    sx: op.sx + src.x,
    sy: op.sy + src.y,
    sw: src.width,
    sh: src.height,
    dx: left - x,
    dy: top - y,
    quarterTurns: k,
  }
}

function clippedOps(ops: ImageOp[], x: number, y: number, width: number, height: number): ImageOp[] {
  const out: ImageOp[] = []
  for (const op of ops) {
    const clipped = clipOp(op, x, y, width, height)
    if (clipped) out.push(clipped)
  }
  return out
}

class SandboxImage {
  width: number
  height: number
  ops: ImageOp[]

  constructor(width: number, height: number, ops: ImageOp[]) {
    this.width = width
    this.height = height
    this.ops = ops
  }

  static empty(width: number, height: number) {
    positiveInt("width", width)
    positiveInt("height", height)
    return new SandboxImage(width, height, [])
  }

  /** 只做來源裁切（Venera 的簽名就是 4 個參數，搬位置是 fillImageRangeAt 的事）。 */
  copyRange(x: number, y: number, width: number, height: number) {
    positiveInt("width", width)
    positiveInt("height", height)
    inRange("x", x, width, this.width)
    inRange("y", y, height, this.height)
    const ops = clippedOps(this.ops, x, y, width, height)
    return new SandboxImage(width, height, ops)
  }

  /** 順時針 90°，寬高互換。只是把貼圖標記成要轉，真正的旋轉由合成器做——
   *  UIImage.rotated() 會多出一像素並重新取樣，不是我們要的逐像素搬移。 */
  copyAndRotate90() {
    const ops = this.ops.map(op => ({
      ...op,
      dx: this.height - op.dy - op.sh,
      dy: op.dx,
      quarterTurns: (op.quarterTurns + 1) % 4,
    }))
    return new SandboxImage(this.height, this.width, ops)
  }

  fillImageAt(x: number, y: number, image: SandboxImage) {
    if (!(image instanceof SandboxImage)) throw new Error("fillImageAt：第三個參數必須是 Image")
    this.fillImageRangeAt(x, y, image, 0, 0, image.width, image.height)
  }

  fillImageRangeAt(
    x: number,
    y: number,
    image: SandboxImage,
    srcX: number,
    srcY: number,
    width: number,
    height: number
  ) {
    if (!(image instanceof SandboxImage)) throw new Error("fillImageRangeAt：第三個參數必須是 Image")
    positiveInt("width", width)
    positiveInt("height", height)
    inRange("x", x, width, this.width)
    inRange("y", y, height, this.height)
    inRange("srcX", srcX, width, image.width)
    inRange("srcY", srcY, height, image.height)
    for (const op of clippedOps(image.ops, srcX, srcY, width, height)) {
      this.ops.push({ ...op, dx: x + op.dx, dy: y + op.dy })
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 跑源的 `modifyImage` 腳本，回傳貼圖清單。
 * 腳本可以用 `let modifyImage = …` 或 `function modifyImage(…)` 定義入口（jm 用前者）。
 */
export function runModifyImage(script: string, source: UIImage): Composition {
  const sandbox = sandboxView()
  const names = [...Object.keys(sandbox), "Image"]
  const values = [...Object.values(sandbox), SandboxImage]

  let handler: unknown
  try {
    handler = new Function(
      ...names,
      `${script}\n;return typeof modifyImage === "function" ? modifyImage : undefined`
    )(...values)
  } catch (error) {
    throw new Error(`modifyImage 腳本無法執行：${message(error)}`)
  }
  if (typeof handler !== "function") throw new Error("modifyImage 腳本沒有定義 modifyImage 函式")

  const input = new SandboxImage(source.width, source.height, [
    { src: source, sx: 0, sy: 0, sw: source.width, sh: source.height, dx: 0, dy: 0, quarterTurns: 0 },
  ])

  let result: unknown
  try {
    result = (handler as (image: SandboxImage) => unknown)(input)
  } catch (error) {
    throw new Error(`modifyImage 執行失敗：${message(error)}`)
  }
  if (!(result instanceof SandboxImage)) throw new Error("modifyImage 必須回傳 Image")

  return { width: result.width, height: result.height, ops: result.ops }
}
