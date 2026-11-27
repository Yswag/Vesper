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

let feedbackCount = 0

export function hostFeedbackCount(): number {
  return feedbackCount
}

export const hostUI: HostUI = {
  showMessage: (message: string) => {
    feedbackCount++
    showToast(message)
  },

  showDialog: async (title: string, content: string, actions: unknown[]) => {
    feedbackCount++
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

  showLoading: (onCancel?: unknown) => showLoading(onCancel),

  cancelLoading: (id: number) => hideLoading(id),
}
