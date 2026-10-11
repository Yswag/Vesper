// 源用的 UI 宿主實作。
//
// 這一層之前是空的（silentUI），結果源的提示訊息全部被丟掉 —— 例如 mxs 設定的
// 「檢測當前域名」按下去看起來完全沒反應，其實源有跑、只是 showMessage 沒有出口。

import type { HostUI } from "../engine/globals"

import { presentCustomMessage, presentCustomSelect } from "./customDialog"
import { hideLoading, showLoading } from "./loadingState"
import { presentPrompt, toPromptImage } from "./PromptSheet"
import { showToast } from "./toast"

interface DialogAction {
  text?: unknown
  callback?: unknown
  style?: unknown
}

export const hostUI: HostUI = {
  showMessage: (message: string) => showToast(message),

  showDialog: async (title: string, content: string, actions: unknown[]) => {
    const items = (Array.isArray(actions) ? actions : [])
      .map(action => action as DialogAction)
      .filter(action => action && typeof action.text === "string")
    await presentCustomMessage({
      title,
      content,
      actions: items.map(action => ({
        text: String(action.text),
        destructive: action.style === "danger",
        callback: typeof action.callback === "function" ? (action.callback as () => unknown) : undefined,
      })),
    })
  },

  // validator 是源給的函式（回字串＝錯誤訊息）、image 是網址或位元組（ccc 的驗證碼）。
  // 兩者都是選填，缺了也照樣能問。
  showInputDialog: async (title: string, validator?: unknown, image?: unknown) => {
    const picture = toPromptImage(image)
    const check = typeof validator === "function" ? (validator as (value: string) => unknown) : undefined
    return await presentPrompt({ title, image: picture, validate: check })
  },

  showSelectDialog: async (title: string, options: string[], initialIndex?: number) => {
    return await presentCustomSelect({ title, options, initialIndex })
  },

  launchUrl: (url: string) => {
    void Safari.openURL(url)
  },

  // 源的載入指示（目前只有 mxs 用）：showLoading 回一個 id，源做完自己 cancelLoading。
  // 顯示在 App 的浮動卡片上（見 App.tsx 的 overlay），不是 modal。
  showLoading: (onCancel?: unknown) => showLoading(onCancel),

  cancelLoading: (id: number) => hideLoading(id),
}
