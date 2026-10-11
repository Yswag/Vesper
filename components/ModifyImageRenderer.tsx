// modifyImage 的合成器：把 engine 產生的貼圖清單離屏畫成一張 PNG。
//
// 兩條路：沒有旋轉時走 <ZStack>（實測 800×8000 只要 ~26 ms，比 Canvas 便宜約 4 倍），
// 有旋轉時走 <Canvas>（Canvas 的 rotate 對 90° 是精確的；UIImage.rotated() 會多一像素並重新取樣）。
// 陷阱：alignment 要下在 frame 上，否則 stack 的自然尺寸會被置中、offset 過的內容會被裁掉。

import { Canvas, Image, ImageRenderer, ZStack } from "scripting"

import { opDestSize, type Composition, type ImageCompositor, type ImageOp } from "../engine/imageprocess"

function leafOf(op: ImageOp): UIImage {
  const leaf = op.src.croppedTo({ x: op.sx, y: op.sy, width: op.sw, height: op.sh })
  if (!leaf) throw new Error("modifyImage：來源裁切失敗")
  return leaf
}

function stacked({ width, height, ops }: Composition) {
  return (
    <ZStack alignment="topLeading" frame={{ width, height, alignment: "topLeading" }}>
      {ops.map(op => {
        const size = opDestSize(op)
        return (
          <Image
            image={leafOf(op)}
            resizable={true}
            interpolation="none"
            antialiased={false}
            frame={{ width: size.width, height: size.height }}
            offset={{ x: op.dx, y: op.dy }}
          />
        )
      })}
    </ZStack>
  )
}

/** 旋轉後要平移多少，才能讓旋轉過的方框對回貼圖的左上角。 */
function turnOffset(op: ImageOp, turns: number): { x: number; y: number } {
  if (turns === 1) return { x: op.sh, y: 0 }
  if (turns === 2) return { x: op.sw, y: op.sh }
  if (turns === 3) return { x: 0, y: op.sw }
  return { x: 0, y: 0 }
}

function drawn({ width, height, ops }: Composition) {
  return (
    <Canvas
      frame={{ width, height }}
      opaque={false}
      draw={ctx => {
        ctx.imageSmoothingEnabled = false
        for (const op of ops) {
          const turns = op.quarterTurns % 4
          if (turns === 0) {
            ctx.drawImage({ image: leafOf(op) }, op.dx, op.dy, op.sw, op.sh)
            continue
          }
          const shift = turnOffset(op, turns)
          ctx.save()
          ctx.translate(op.dx + shift.x, op.dy + shift.y)
          ctx.rotate((turns * Math.PI) / 2)
          ctx.drawImage({ image: leafOf(op) }, 0, 0, op.sw, op.sh)
          ctx.restore()
        }
      }}
    />
  )
}

export const composeImage: ImageCompositor = async composition => {
  const rotated = composition.ops.some(op => op.quarterTurns % 4 !== 0)
  const output = await ImageRenderer.toUIImage(rotated ? drawn(composition) : stacked(composition), {
    scale: 1,
    opaque: false,
  })
  const data = Data.fromPNG(output)
  if (!data) throw new Error("modifyImage：PNG 編碼失敗")
  const bytes = data.toUint8Array()
  if (!bytes) throw new Error("modifyImage：PNG 位元組為空")
  return bytes
}
