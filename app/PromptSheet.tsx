// 源用的自訂輸入彈窗。所有內容都掛在 App 的共用 overlay，不使用系統 modal。

import { Convert } from "../engine/convert"
import { log } from "../engine/log"
import { presentCustomInput } from "./customDialog"

export interface PromptRequest {
  title: string
  /** 圖片網址，或已經轉好的 UIImage。 */
  image?: string | UIImage | null
  /** 回傳字串就當錯誤訊息顯示；回 null / undefined 就通過。 */
  validate?: (value: string) => unknown
}

/** 把源給的 image 轉成自訂彈窗可顯示的圖片。 */
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
