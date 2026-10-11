// 語言設定：「跟隨系統」或指定語言，存在 Storage KV。
//
// 這裡是 i18n 與「使用者的選擇」之間唯一的接縫。i18n 自己是零依賴 leaf（不讀 Storage、
// 只知道語言），所以落點、驗值、結算與注入都在這一支：
//
//   installLocaleSetting()  啟動：讀 KV → 結算 → 注入（**不寫回**）
//   applyLocaleSetting()    使用者切換：寫回 KV → 注入並通知畫面重繪
//
// 「跟隨系統」只在啟動時（與使用者當下選它的時候）結算一次，不做即時跟隨（不掛 scenePhase）。

import { kv } from "../engine/storage"
import { LOCALE_IDS, detectLocale, setInitialLocale, setLocale, type LocaleId } from "../i18n"

/** 設定值：跟隨系統，或挑一個指定語言。 */
export type LocaleSetting = "system" | LocaleId

/** 儲存鍵。**改這個名字等於把使用者的選擇丟掉**，探針有一條釘著它。 */
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
 * 啟動注入（`index.tsx` 與首頁分頁入口）：讀 KV → 結算 → 注入 i18n。
 *
 * **不寫回 KV**：`setInitialLocale` 刻意不觸發變更回呼，否則「跟隨系統」會在啟動時
 * 被結算後的那個語言蓋掉。
 */
export function installLocaleSetting(systemLocales: readonly string[]): void {
  setInitialLocale(resolveLocale(getLocaleSetting(), systemLocales))
}

/**
 * 使用者切換（設定頁）：寫回**選擇本身**（含 `"system"`），再注入結算後的語言
 * ——`setLocale` 會通知 i18n 的訂閱者，畫面用 `app/useSubscription` 收到就重繪。
 *
 * 寫回放在這裡而不是掛 i18n 的 `onLocaleChange`：那個回呼只帶結算後的 `LocaleId`，
 * 選「跟隨系統」時會把 `"system"` 蓋成當下結算出來的那個語言。
 */
export function applyLocaleSetting(setting: LocaleSetting, systemLocales: readonly string[]): void {
  kv.set(LOCALE_SETTING_KEY, setting)
  setLocale(resolveLocale(setting, systemLocales))
}
