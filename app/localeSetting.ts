import { kv } from "../engine/storage"
import { LOCALE_IDS, detectLocale, setInitialLocale, setLocale, type LocaleId } from "../i18n"

export type LocaleSetting = "system" | LocaleId

export const LOCALE_SETTING_KEY = "venera:locale"

export const DEFAULT_LOCALE_SETTING: LocaleSetting = "system"

export const LOCALE_SETTINGS: readonly LocaleSetting[] = ["system", ...LOCALE_IDS]

export const LOCALE_SELF_NAMES: Record<LocaleId, string> = {
  "zh-Hant": "繁體中文",
  "zh-Hans": "简体中文",
  en: "English",
}

export function isLocaleSetting(value: unknown): value is LocaleSetting {
  return typeof value === "string" && (LOCALE_SETTINGS as readonly string[]).includes(value)
}

export function getLocaleSetting(): LocaleSetting {
  const raw = kv.get(LOCALE_SETTING_KEY)
  return isLocaleSetting(raw) ? raw : DEFAULT_LOCALE_SETTING
}

export function resolveLocale(setting: LocaleSetting, systemLocales: readonly string[]): LocaleId {
  return setting === "system" ? detectLocale(systemLocales) : setting
}

export function installLocaleSetting(systemLocales: readonly string[]): void {
  setInitialLocale(resolveLocale(getLocaleSetting(), systemLocales))
}

export function applyLocaleSetting(setting: LocaleSetting, systemLocales: readonly string[]): void {
  kv.set(LOCALE_SETTING_KEY, setting)
  setLocale(resolveLocale(setting, systemLocales))
}
