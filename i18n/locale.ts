export type LocaleId = "zh-Hant" | "zh-Hans" | "en"

export const DEFAULT_LOCALE: LocaleId = "zh-Hant"

export const LOCALE_IDS: readonly LocaleId[] = ["zh-Hant", "zh-Hans", "en"]

const TAG_SHAPE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

export function detectLocale(systemLocales: readonly string[]): LocaleId {
  for (const raw of systemLocales) {
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
