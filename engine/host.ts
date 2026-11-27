import { kv } from "./storage"
import type { HostContext, HostUI, SourceSettings } from "./globals"

const DATA_PREFIX = "venera:data:"

export function sourceDataKey(sourceKey: string, key: string): string {
  return `${DATA_PREFIX}${sourceKey}:${key}`
}

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
