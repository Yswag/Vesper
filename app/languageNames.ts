import { getLocale } from "../i18n"

export function languageName(code: string): string {
  if (!code) return ""
  try {
    return new Intl.DisplayNames([getLocale()], { type: "language" }).of(code) || code
  } catch {
    return code
  }
}
