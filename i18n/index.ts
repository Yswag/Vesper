import { DEFAULT_LOCALE, type LocaleId } from "./locale"
import { dictionaries, type Message, type MessageKey } from "./strings"

export { DEFAULT_LOCALE, LOCALE_IDS, detectLocale } from "./locale"
export type { LocaleId } from "./locale"
export type { MessageKey } from "./strings"

export type MessageParams = Record<string, string | number>

let current: LocaleId = DEFAULT_LOCALE
const listeners = new Set<() => void>()
const changeListeners = new Set<(locale: LocaleId) => void>()

const pluralRules = new Map<LocaleId, Intl.PluralRules>()

const NO_PARAMS: MessageParams = {}

const HAS_PLACEHOLDER = /\{(\w+)\}/
const PLACEHOLDER = /\{(\w+)\}/g

type CachedMessage =
  | { kind: "text"; text: string; slots: boolean }
  | { kind: "plural"; one: string; other: string; oneSlots: boolean; otherSlots: boolean }
  | { kind: "missing" }

const MISSING: CachedMessage = { kind: "missing" }
const cache = new Map<string, CachedMessage>()

export function getLocale(): LocaleId {
  return current
}

export function setInitialLocale(locale: LocaleId): void {
  apply(locale, false)
}

export function setLocale(locale: LocaleId): void {
  apply(locale, true)
}

export function t(key: MessageKey, params: MessageParams = NO_PARAMS): string {
  let entry = cache.get(key)
  if (entry === undefined) {
    entry = resolve(key)
    cache.set(key, entry)
  }
  if (entry.kind === "missing") return key
  if (entry.kind === "text") return render(entry.text, entry.slots, params)
  const count = params.n
  if (typeof count !== "number") return render(entry.other, entry.otherSlots, params)
  const useOne = rulesFor(current).select(count) === "one"
  return useOne ? render(entry.one, entry.oneSlots, params) : render(entry.other, entry.otherSlots, params)
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function onLocaleChange(fn: (locale: LocaleId) => void): () => void {
  changeListeners.add(fn)
  return () => {
    changeListeners.delete(fn)
  }
}

function apply(next: LocaleId, notifyChange: boolean): void {
  current = next
  cache.clear()
  for (const listener of [...listeners]) listener()
  if (!notifyChange) return
  for (const listener of [...changeListeners]) listener(next)
}

function resolve(key: string): CachedMessage {
  const message = messageFor(current, key) ?? messageFor(DEFAULT_LOCALE, key)
  if (message === undefined) return MISSING
  if (typeof message === "string") {
    return { kind: "text", text: message, slots: HAS_PLACEHOLDER.test(message) }
  }
  return {
    kind: "plural",
    one: message.one,
    other: message.other,
    oneSlots: HAS_PLACEHOLDER.test(message.one),
    otherSlots: HAS_PLACEHOLDER.test(message.other),
  }
}

function messageFor(locale: LocaleId, key: string): Message | undefined {
  let node: unknown = dictionaries[locale]
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  if (typeof node === "string") return node
  if (isPlural(node)) return node
  return undefined
}

function isPlural(node: unknown): node is { one: string; other: string } {
  if (typeof node !== "object" || node === null) return false
  const forms = node as Record<string, unknown>
  return typeof forms.one === "string" && typeof forms.other === "string"
}

function rulesFor(locale: LocaleId): Intl.PluralRules {
  let rules = pluralRules.get(locale)
  if (rules === undefined) {
    rules = new Intl.PluralRules(locale)
    pluralRules.set(locale, rules)
  }
  return rules
}

function render(text: string, slots: boolean, params: MessageParams): string {
  return slots ? interpolate(text, params) : text
}

function interpolate(text: string, params: MessageParams): string {
  return text.replace(PLACEHOLDER, (placeholder: string, name: string) => {
    const value = params[name]
    return value === undefined ? placeholder : String(value)
  })
}
