import { Convert } from "../engine/convert"
import { log } from "../engine/log"
import { presentCustomInput } from "./customDialog"

export interface PromptRequest {
  title: string
  image?: string | UIImage | null
  validate?: (value: string) => unknown
}

export function toPromptImage(image: unknown): string | UIImage | null {
  if (!image) return null
  if (typeof image === "string") return image
  try {
    const bytes =
      image instanceof ArrayBuffer
        ? image
        : ArrayBuffer.isView(image)
          ? (() => {
              const view = image as ArrayBufferView
              return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
            })()
          : null
    if (!bytes) return null
    return UIImage.fromBase64String(Convert.encodeBase64(bytes))
  } catch (error) {
    log("warning", "source", "源的輸入對話框圖片看不懂，忽略", error)
    return null
  }
}

export function presentPrompt(request: PromptRequest): Promise<string | null> {
  return presentCustomInput(request)
}
