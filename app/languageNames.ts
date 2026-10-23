// 語言代碼 → 目前介面語言的顯示名（給 Aidoku 源的語言清單用）。
// Intl 不認得的代碼（自訂值）就原樣顯示，不要把畫面弄壞。

import { getLocale } from "../i18n"

export function languageName(code: string): string {
  if (!code) return ""
  try {
    return new Intl.DisplayNames([getLocale()], { type: "language" }).of(code) || code
  } catch {
    return code
  }
}
