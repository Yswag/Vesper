import { getLocale, type LocaleId } from "../i18n"

const SOURCE_LOCALES: Record<LocaleId, string[]> = {
  "zh-Hant": ["zh_TW"],
  "zh-Hans": ["zh_CN"],
  en: ["en", "en_US"],
}

export function sourceLocale(): string {
  return SOURCE_LOCALES[getLocale()][0]
}

export function sourceText(instance: any, text: string): string {
  if (!text) return text
  for (const locale of SOURCE_LOCALES[getLocale()]) {
    const translated = instance?.translation?.[locale]?.[text]
    if (typeof translated === "string" && translated.length > 0) return translated
  }
  return text
}

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
