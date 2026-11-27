import { sandboxView } from "./globals"

export interface ImageOp {
  src: UIImage
  sx: number
  sy: number
  sw: number
  sh: number
  dx: number
  dy: number
  quarterTurns: number
}

export interface Composition {
  width: number
  height: number
  ops: ImageOp[]
}

export type ImageCompositor = (composition: Composition) => Promise<Uint8Array>

function positiveInt(name: string, value: number) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} 必須是正整數（收到 ${value}）`)
}

function inRange(name: string, start: number, length: number, limit: number) {
  if (!Number.isInteger(start) || start < 0 || start + length > limit) {
    throw new Error(`${name}=${start} 加上長度 ${length} 超出了 0..${limit}`)
  }
}

export function opDestSize(op: ImageOp): { width: number; height: number } {
  return op.quarterTurns % 2 === 1 ? { width: op.sh, height: op.sw } : { width: op.sw, height: op.sh }
}

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

  copyRange(x: number, y: number, width: number, height: number) {
    positiveInt("width", width)
    positiveInt("height", height)
    inRange("x", x, width, this.width)
    inRange("y", y, height, this.height)
    const ops = clippedOps(this.ops, x, y, width, height)
    return new SandboxImage(width, height, ops)
  }

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
