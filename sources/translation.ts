// 源自己的介面字串翻譯：源類別上的 `translation = { zh_TW: { "原文": "譯文" } }`。
// 源在沙箱裡自己用 `this.translate()`；宿主這一側要翻的是「源交給我們的字串」——
// 設定標題、篩選列、分類名、探索分頁名（上游同一個概念：`String.ts(sourceKey)`）。

import { getLocale, type LocaleId } from "../i18n"

/** 我們的 locale → 源字典的鍵（由前往後試）。 */
const SOURCE_LOCALES: Record<LocaleId, string[]> = {
  "zh-Hant": ["zh_TW"],
  "zh-Hans": ["zh_CN"],
  // 有源把英文寫成 `en_US`（ehentai）；上游在 en_US 裝置上也會命中它。
  en: ["en", "en_US"],
}

/** 源要用的語言鍵；也是沙箱裡 `APP.locale` 與 `this.translate()` 的語言。 */
export function sourceLocale(): string {
  return SOURCE_LOCALES[getLocale()][0]
}

/** 查不到、或譯文是空字串，就回原文（源的字典只放它自己寫過的字串）。 */
export function sourceText(instance: any, text: string): string {
  if (!text) return text
  for (const locale of SOURCE_LOCALES[getLocale()]) {
    const translated = instance?.translation?.[locale]?.[text]
    if (typeof translated === "string" && translated.length > 0) return translated
  }
  return text
}

/**
 * 篩選列的顯示文字套源字典（**值不動**：送給源的仍是原文）。
 * 搜尋的 `optionList` 與分類的 `optionList` 形狀一樣，兩邊共用這一個。
 */
export function translatedOptionRows<T extends { label?: string; options: Array<{ value: string; label: string }> }>(
  instance: any,
  rows: T[]
): T[] {
  return rows.map(row => ({
    ...row,
    label: row.label ? sourceText(instance, row.label) : undefined,
    options: row.options.map(option => ({ ...option, label: sourceText(instance, option.label) })),
  }))
}
