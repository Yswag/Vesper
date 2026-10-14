// 語言偏好設定：管理「跟隨系統」或指定語言，持久化儲存於 Storage KV。
// 連接使用者選擇與 i18n 引擎，於啟動與切換時解析為具體 LocaleId。

import { kv } from "../engine/storage"
import { LOCALE_IDS, detectLocale, setInitialLocale, setLocale, type LocaleId } from "../i18n"

/** 設定值：跟隨系統，或挑一個指定語言。 */
export type LocaleSetting = "system" | LocaleId

/** 語言設定持久化鍵名。 */
export const LOCALE_SETTING_KEY = "venera:locale"

/** 沒設定過、或設定的值認不得時用這個。 */
export const DEFAULT_LOCALE_SETTING: LocaleSetting = "system"

/** 四個選項，順序就是設定頁的順序。 */
export const LOCALE_SETTINGS: readonly LocaleSetting[] = ["system", ...LOCALE_IDS]

/** 語言的自稱：自己的語言寫自己的名字（不隨介面語言變，設定頁靠這個）。 */
export const LOCALE_SELF_NAMES: Record<LocaleId, string> = {
  "zh-Hant": "繁體中文",
  "zh-Hans": "简体中文",
  en: "English",
}

/** 讀到的值是不是四個合法設定之一（Storage 裡什麼都可能會有）。 */
export function isLocaleSetting(value: unknown): value is LocaleSetting {
  return typeof value === "string" && (LOCALE_SETTINGS as readonly string[]).includes(value)
}

/** 目前的設定。讀不到、讀到怪東西都當「跟隨系統」。 */
export function getLocaleSetting(): LocaleSetting {
  const raw = kv.get(LOCALE_SETTING_KEY)
  return isLocaleSetting(raw) ? raw : DEFAULT_LOCALE_SETTING
}

/** 把設定結算成真正要用的語言：「跟隨系統」交給 `detectLocale`（純函式，清單由呼叫端給）。 */
export function resolveLocale(setting: LocaleSetting, systemLocales: readonly string[]): LocaleId {
  return setting === "system" ? detectLocale(systemLocales) : setting
}

/**
 * 啟動初始化注入：讀取 KV 設定，解析後注入 i18n（不回寫 KV，避免覆蓋 "system" 選項）。
 */
export function installLocaleSetting(systemLocales: readonly string[]): void {
  setInitialLocale(resolveLocale(getLocaleSetting(), systemLocales))
}

/**
 * 切換並套用語言設定：保存偏好設定至 KV 並通知 i18n 重新渲染。
 */
export function applyLocaleSetting(setting: LocaleSetting, systemLocales: readonly string[]): void {
  kv.set(LOCALE_SETTING_KEY, setting)
  setLocale(resolveLocale(setting, systemLocales))
}
