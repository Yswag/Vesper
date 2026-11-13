// i18n：零依賴 leaf。
//
// 為什麼自己一個 top-level 目錄：`i18n` 要被六層 import，而它不能產生任何新的跨層邊
// （放 `design/` 不行——`design/layout.tsx` 自己就 import 了 `app/theme`）。
// 所以這裡**不 import 專案裡任何模組**：不讀 Storage（會與 `engine/storage` 成環）、
// 不 import `engine/emitter`（自帶小訂閱，畫面用既有的 `app/useSubscription` 訂）。
// 語言從外面注入（`setInitialLocale`），「跟隨系統」的結算也留給呼叫端（`detectLocale`）。

import { DEFAULT_LOCALE, type LocaleId } from "./locale"
import { dictionaries, type Message, type MessageKey } from "./strings"

export { DEFAULT_LOCALE, LOCALE_IDS, detectLocale } from "./locale"
export type { LocaleId } from "./locale"
export type { MessageKey } from "./strings"

/** 佔位符的值：`t("a.b", { n: 3 })` 對上訊息裡的 `{n}`。 */
export type MessageParams = Record<string, string | number>

let current: LocaleId = DEFAULT_LOCALE
const listeners = new Set<() => void>()
const changeListeners = new Set<(locale: LocaleId) => void>()

// `Intl.PluralRules` 建一次不便宜，而 `t()` 在 render 裡會被叫很多次（列表一列一次）：
// 每種語言留一份。
const pluralRules = new Map<LocaleId, Intl.PluralRules>()

/** 沒帶參數時的共用空物件（預設參數不要每次呼叫都配一個新的）。 */
const NO_PARAMS: MessageParams = {}

/** 訊息裡有沒有佔位符：放進快取時算一次就好，有 `g` 的那一份給取代用。 */
const HAS_PLACEHOLDER = /\{(\w+)\}/
const PLACEHOLDER = /\{(\w+)\}/g

/**
 * 查表快取：key 直接當 Map 的鍵——語言只會有一個「目前」值，換語言時整張清掉，
 * 所以不必為了組快取鍵去串接字串。
 *
 * 值是**插值前**的訊息（字串或複數物件）＋「含不含佔位符」先算好的旗標：
 * 同一個 key 的第二次呼叫只剩一次 `Map.get`，不必再拆鍵、逐層取值、跑正規表示式。
 * 字典是模組常數，快取不會過期；唯一的失效點是換語言（`apply`）。
 */
type CachedMessage =
  | { kind: "text"; text: string; slots: boolean }
  | { kind: "plural"; one: string; other: string; oneSlots: boolean; otherSlots: boolean }
  | { kind: "missing" }

/** 目前的語言與預設語言都沒有這個 key：回 key 本身（連這個結果也快取）。 */
const MISSING: CachedMessage = { kind: "missing" }
const cache = new Map<string, CachedMessage>()

/** 現在的語言。還沒注入之前就是 `DEFAULT_LOCALE`。 */
export function getLocale(): LocaleId {
  return current
}

/**
 * 啟動時注入初始語言（`index.tsx` 讀完設定、`present()` 之前呼叫）。
 *
 * 只換語言並重繪訂閱者，**不**觸發變更回呼——那是「使用者切了語言要寫回 KV」的路徑，
 * 啟動時回寫會把「跟隨系統」蓋成結算後的那一個。
 */
export function setInitialLocale(locale: LocaleId): void {
  apply(locale, false)
}

/** 使用者切換語言（設定頁）。會觸發變更回呼。 */
export function setLocale(locale: LocaleId): void {
  apply(locale, true)
}

/**
 * 取一段訊息。`{name}` 佔位符由 `params` 取代，複數形由 `Intl.PluralRules` 挑。
 *
 * 任何時刻呼叫都安全：找不到 key 就回 key 本身（型別已經擋掉打錯，這是最後一道）。
 */
export function t(key: MessageKey, params: MessageParams = NO_PARAMS): string {
  let entry = cache.get(key)
  if (entry === undefined) {
    entry = resolve(key)
    cache.set(key, entry)
  }
  if (entry.kind === "missing") return key
  if (entry.kind === "text") return render(entry.text, entry.slots, params)
  const count = params.n
  // 沒給 `n` 一律用 `other`（跟改動前一樣，也省掉一次 `PluralRules.select`）。
  if (typeof count !== "number") return render(entry.other, entry.otherSlots, params)
  const useOne = rulesFor(current).select(count) === "one"
  return useOne ? render(entry.one, entry.oneSlots, params) : render(entry.other, entry.otherSlots, params)
}

/** 畫面訂閱：語言一換就重繪（搭 `app/useSubscription`）。回傳退訂。 */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 變更時回呼：**使用者**切了語言才通知（啟動注入不算）；給「寫回 KV」接。回傳退訂。 */
export function onLocaleChange(fn: (locale: LocaleId) => void): () => void {
  changeListeners.add(fn)
  return () => {
    changeListeners.delete(fn)
  }
}

function apply(next: LocaleId, notifyChange: boolean): void {
  current = next
  // 快取裡是「哪個語言的字」，換語言就整張作廢：漏清就會拿到上一個語言的字。
  cache.clear()
  // 先快照：通知期間有人退訂才不會漏掉後面的人。
  for (const listener of [...listeners]) listener()
  if (!notifyChange) return
  for (const listener of [...changeListeners]) listener(next)
}

/** 查一次：拆鍵、逐層取值、回退預設語言、順便把「含不含佔位符」算好。 */
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

/** 走 key 路徑拿訊息；形狀對不上（不是字串也不是 `one`/`other`）就當作沒有。 */
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

/** 每種語言一份 `PluralRules`（建立成本高，`t()` 會被叫上千次）。 */
function rulesFor(locale: LocaleId): Intl.PluralRules {
  let rules = pluralRules.get(locale)
  if (rules === undefined) {
    rules = new Intl.PluralRules(locale)
    pluralRules.set(locale, rules)
  }
  return rules
}

/** 沒有佔位符就不跑取代（`slots` 是放進快取時算的）。 */
function render(text: string, slots: boolean, params: MessageParams): string {
  return slots ? interpolate(text, params) : text
}

/** 佔位符：沒給的參數原樣留著——看得到 `{total}` 才知道少了什麼。 */
function interpolate(text: string, params: MessageParams): string {
  return text.replace(PLACEHOLDER, (placeholder: string, name: string) => {
    const value = params[name]
    return value === undefined ? placeholder : String(value)
  })
}
