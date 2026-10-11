// 支援的語言，與「跟隨系統」的結算。
//
// 這支刻意**什麼都不 import**（連 `scripting` 都不）：系統語言清單由呼叫端用參數注入，
// 探針才餵得進假資料，i18n 也才維持零依賴。

export type LocaleId = "zh-Hant" | "zh-Hans" | "en"

/** 預設語言。`t()` 在任何時刻都要安全，所以還沒注入之前就是這一份。 */
export const DEFAULT_LOCALE: LocaleId = "zh-Hant"

/** 支援的語言（設定頁的順序也照這個）。 */
export const LOCALE_IDS: readonly LocaleId[] = ["zh-Hant", "zh-Hans", "en"]

/**
 * BCP-47 的形狀檢查：語言主段 2–3 個字母，後面每段 2–8 個英數字。
 *
 * 呼叫前會把底線正規化成連字號（兩種寫法都有平台在用）。
 *
 * 為什麼要驗形狀：實測 `Device.systemLocales` 是
 * `["zh-Hant-TW","zh-Hans-TW","en-TW","ko-TW","com-TW"]`——`com-TW` 是地區清單漏出來的，
 * 不是語言。形狀先擋一層，比對時再只認支援的那三個。
 */
const TAG_SHAPE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

/**
 * 「跟隨系統」的結算：清單**逐項**比對，第一個認得的語言勝出。
 *
 * 繁簡只看 script 段（`zh-Hant-*` / `zh-Hans-*`）：重點是中間那一段，不是地區
 * （`zh-Hans-CN` 與 `zh-Hant-TW` 的差別就在 script），所以沒帶 script 段的 `zh` 不算數。
 * 認不得的語言（日文、`com-TW`…）往下看下一項，全部認不得才 fallback `en`。
 */
export function detectLocale(systemLocales: readonly string[]): LocaleId {
  for (const raw of systemLocales) {
    // 底線也是合法的 BCP-47 分隔符（`zh_Hant_TW`）：先正規化再驗形狀與比對。
    const tag = raw.trim().toLowerCase().replace(/_/g, "-")
    if (!TAG_SHAPE.test(tag)) continue
    const [language, second] = tag.split("-")
    if (language === "en") return "en"
    if (language !== "zh") continue
    if (second === "hant") return "zh-Hant"
    if (second === "hans") return "zh-Hans"
  }
  return "en"
}
