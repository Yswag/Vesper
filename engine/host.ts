// 源的宿主實作：資料持久化（loadData/saveData/deleteData）、設定、登入狀態。
// 這一層刻意不碰 UI 框架，讓引擎可以離 UI 被測試。

import { kv } from "./storage"
import type { HostContext, HostUI, SourceSettings } from "./globals"

const DATA_PREFIX = "venera:data:"

/** 源資料的儲存鍵。`createHostContext` 與 `writeSourceData` 共用同一個字串。 */
export function sourceDataKey(sourceKey: string, key: string): string {
  return `${DATA_PREFIX}${sourceKey}:${key}`
}

/**
 * 從宿主這一側寫入源的資料（源自己寫是 `saveData`）。
 *
 * 目前唯一的呼叫點是瀏覽器登入：`loginWithWebview` 的 `onLoginSuccess` 會讀
 * `this.loadData("_localStorage")`（ccc 就是這樣拿 JWT 的），而那份資料只有宿主拿得到。
 */
export function writeSourceData(sourceKey: string, key: string, value: unknown) {
  kv.set(sourceDataKey(sourceKey, key), value)
}

export const silentUI: HostUI = {
  showMessage: () => {},
  showDialog: async () => {},
  showInputDialog: async () => null,
  showSelectDialog: async () => null,
  launchUrl: () => {},
  showLoading: () => 0,
  cancelLoading: () => {},
}

export interface HostOptions {
  settings?: SourceSettings
  locale?: string
  loggedIn?: boolean
  ui?: HostUI
}

export function createHostContext(sourceKey: string, options: HostOptions = {}): HostContext {
  const settings = options.settings ?? {}
  return {
    sourceKey,
    locale: options.locale ?? "zh_TW",
    settings,
    loadData: (key: string) => kv.get(sourceDataKey(sourceKey, key)),
    saveData: (key: string, data: unknown) => kv.set(sourceDataKey(sourceKey, key), data),
    deleteData: (key: string) => kv.remove(sourceDataKey(sourceKey, key)),
    isLogged: () => options.loggedIn === true,
    ui: options.ui ?? silentUI,
  }
}
