import { Convert } from "./convert"
import type { Cookie } from "./cookies"
import { deleteCookies, getCookies, setCookies } from "./cookies"
import * as dom from "./dom"
import { requestBytes, requestText } from "./http"
import { currentSourceSignal } from "./scope"
import { log as writeLog } from "./log"

export interface SourceSettings {
  [id: string]: unknown
}

export interface HostUI {
  showMessage(message: string): void
  showDialog(title: string, content: string, actions: unknown[]): Promise<void>
  showInputDialog(title: string, validator?: unknown, image?: unknown): Promise<string | null>
  showSelectDialog(title: string, options: string[], initialIndex?: number): Promise<number | null>
  launchUrl(url: string): void
  showLoading(onCancel?: unknown): number
  cancelLoading(id: number): void
}

export interface HostContext {
  sourceKey: string
  locale: string
  settings: SourceSettings
  loadData(key: string): unknown
  saveData(key: string, data: unknown): void
  deleteData(key: string): void
  isLogged(): boolean
  ui: HostUI
}

const APP_VERSION = "1.17.0"

declare function setInterval(handler: () => void, timeout: number): number
declare function clearInterval(id: number): void

export function sandboxView(): Record<string, unknown> {
  return {
    JSON,
    Math,
    Date,
    Map,
    Set,
    Promise,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    TypeError,
    Symbol,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
  }
}

export function createGlobals(ctx: HostContext): Record<string, unknown> {
  const sourceKey = ctx.sourceKey
  const dataKeyOf = (key: string) => `venera:data:${sourceKey}:${key}`

  class CookieClass {
    name: string
    value: string
    domain: string
    constructor({ name, value, domain }: Cookie) {
      this.name = name
      this.value = value
      this.domain = domain
    }
  }

  class ImageLoadingConfig {
    url?: string
    method?: string
    data?: unknown
    headers?: Record<string, string>
    onResponse?: (bytes: any) => any
    modifyImage?: string
    onLoadFailed?: () => unknown
    constructor(init: Partial<ImageLoadingConfig> = {}) {
      Object.assign(this, init)
    }
  }

  class Comic {
    constructor(init: Record<string, unknown> = {}) {
      Object.assign(this, init)
    }
  }

  class ComicDetails {
    subtitle?: string
    constructor(init: Record<string, any> = {}) {
      Object.assign(this, init)
      this.subtitle = init.subtitle ?? init.subTitle
    }
  }

  class Comment {
    constructor(init: Record<string, unknown> = {}) {
      Object.assign(this, init)
    }
  }

  class ComicSource {
    name = ""
    key = ""
    version = ""
    minAppVersion = ""
    url = ""
    translation: Record<string, Record<string, string>> = {}

    private get selfKey(): string {
      return this.key || sourceKey
    }

    loadData(key: string) {
      return ctx.loadData(key)
    }

    saveData(key: string, data: unknown) {
      return ctx.saveData(key, data)
    }

    deleteData(key: string) {
      return ctx.deleteData(key)
    }

    loadSetting(key: string) {
      return key in ctx.settings ? ctx.settings[key] : undefined
    }

    get isLogged(): boolean {
      return ctx.isLogged()
    }

    translate(key: string): string {
      return this.translation?.[ctx.locale]?.[key] ?? key
    }

    init() {}
  }

  const Network = {
    async sendRequest(method: string, url: string, headers?: unknown, data?: unknown, extra?: Record<string, unknown>) {
      return requestText(sourceKey, method, url, headers, data, extra, currentSourceSignal(sourceKey))
    },
    async fetchBytes(method: string, url: string, headers?: unknown, data?: unknown, extra?: Record<string, unknown>) {
      return requestBytes(sourceKey, method, url, headers, data, extra, currentSourceSignal(sourceKey))
    },
    get(url: string, headers?: unknown, extra?: Record<string, unknown>) {
      return this.sendRequest("GET", url, headers, null, extra)
    },
    post(url: string, headers?: unknown, data?: unknown, extra?: Record<string, unknown>) {
      return this.sendRequest("POST", url, headers, data, extra)
    },
    put(url: string, headers?: unknown, data?: unknown, extra?: Record<string, unknown>) {
      return this.sendRequest("PUT", url, headers, data, extra)
    },
    patch(url: string, headers?: unknown, data?: unknown, extra?: Record<string, unknown>) {
      return this.sendRequest("PATCH", url, headers, data, extra)
    },
    delete(url: string, headers?: unknown, extra?: Record<string, unknown>) {
      return this.sendRequest("DELETE", url, headers, null, extra)
    },
    setCookies(url: string, cookies: Cookie[]) {
      setCookies(sourceKey, url, cookies ?? [])
    },
    getCookies(url: string) {
      return getCookies(sourceKey, url)
    },
    deleteCookies(url: string) {
      deleteCookies(sourceKey, url)
    },
  }

  class HtmlDocument {
    key: number
    constructor(html: string) {
      this.key = dom.parseDocument(html)
    }
    querySelector(query: string) {
      const k = dom.querySelector(this.key, query)
      return k == null ? null : new HtmlElement(k, this.key)
    }
    querySelectorAll(query: string) {
      return dom.querySelectorAll(this.key, query).map(k => new HtmlElement(k, this.key))
    }
    getElementById(id: string) {
      const k = dom.getElementById(this.key, id)
      return k == null ? null : new HtmlElement(k, this.key)
    }
    dispose() {
      dom.disposeDocument(this.key)
    }
  }

  class HtmlElement {
    key: number
    doc: number
    constructor(key: number, doc: number) {
      this.key = key
      this.doc = doc
    }
    get text() {
      return dom.getText(this.doc, this.key)
    }
    get attributes(): Record<string, string> {
      return dom.getAttributes(this.doc, this.key)
    }
    get innerHTML() {
      return dom.getInnerHTML(this.doc, this.key)
    }
    get children() {
      return dom.getChildren(this.doc, this.key).map(k => new HtmlElement(k, this.doc))
    }
    get nodes() {
      return dom.getNodes(this.doc, this.key).map(k => new HtmlNode(k, this.doc))
    }
    get parent(): HtmlElement | null {
      const k = dom.getParent(this.doc, this.key)
      return k == null ? null : new HtmlElement(k, this.doc)
    }
    get classNames() {
      return dom.getClassNames(this.doc, this.key)
    }
    get id() {
      return dom.getId(this.doc, this.key)
    }
    get localName() {
      return dom.getLocalName(this.doc, this.key)
    }
    get previousElementSibling(): HtmlElement | null {
      const k = dom.getPreviousSibling(this.doc, this.key)
      return k == null ? null : new HtmlElement(k, this.doc)
    }
    get nextElementSibling(): HtmlElement | null {
      const k = dom.getNextSibling(this.doc, this.key)
      return k == null ? null : new HtmlElement(k, this.doc)
    }
    querySelector(query: string) {
      const k = dom.domQuerySelector(this.doc, this.key, query)
      return k == null ? null : new HtmlElement(k, this.doc)
    }
    querySelectorAll(query: string) {
      return dom.domQuerySelectorAll(this.doc, this.key, query).map(k => new HtmlElement(k, this.doc))
    }
  }

  class HtmlNode {
    key: number
    doc: number
    constructor(key: number, doc: number) {
      this.key = key
      this.doc = doc
    }
    get text() {
      return dom.nodeText(this.doc, this.key)
    }
    get type() {
      return dom.nodeType(this.doc, this.key)
    }
    toElement() {
      const k = dom.nodeToElement(this.doc, this.key)
      return k == null ? null : new HtmlElement(k, this.doc)
    }
  }

  async function fetchCompat(url: string, options?: { method?: string; headers?: Record<string, string>; body?: unknown }) {
    const result = await Network.fetchBytes(options?.method ?? "GET", url, options?.headers ?? {}, options?.body ?? null)
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      statusText: "",
      headers: result.headers,
      arrayBuffer: async () => result.body,
      text: async () => Convert.decodeUtf8(result.body),
      json: async () => JSON.parse(Convert.decodeUtf8(result.body)),
    }
  }

  class ImageStub {
    constructor(_key?: number) {}
    static empty(_width: number, _height: number): never {
      throw new Error("Image API 只能在 modifyImage 裡使用")
    }
    copyRange(): never {
      throw new Error("Image API 只能在 modifyImage 裡使用")
    }
    copyAndRotate90(): never {
      throw new Error("Image API 只能在 modifyImage 裡使用")
    }
    fillImageAt(): never {
      throw new Error("Image API 只能在 modifyImage 裡使用")
    }
    fillImageRangeAt(): never {
      throw new Error("Image API 只能在 modifyImage 裡使用")
    }
    get width(): never {
      throw new Error("Image API 只能在 modifyImage 裡使用")
    }
    get height(): never {
      throw new Error("Image API 只能在 modifyImage 裡使用")
    }
  }

  interface Timer {
    cancel(): void
  }

  const globals: Record<string, unknown> = {
    ComicSource,
    Comic,
    ComicDetails,
    Comment,
    ImageLoadingConfig,
    Cookie: CookieClass,
    Network,
    HtmlDocument,
    HtmlElement,
    HtmlNode,
    Convert,
    Image: ImageStub,

    APP: {
      get version() {
        return APP_VERSION
      },
      get locale() {
        return ctx.locale
      },
      get platform() {
        return "ios"
      },
    },

    UI: {
      showMessage: (message: string) => ctx.ui.showMessage(message),
      showDialog: (title: string, content: string, actions: unknown[]) => ctx.ui.showDialog(title, content, actions),
      showInputDialog: (title: string, validator?: unknown, image?: unknown) =>
        ctx.ui.showInputDialog(title, validator, image),
      showSelectDialog: (title: string, options: string[], initialIndex?: number) =>
        ctx.ui.showSelectDialog(title, options, initialIndex),
      launchUrl: (url: string) => ctx.ui.launchUrl(url),
      showLoading: (onCancel?: unknown) => ctx.ui.showLoading(onCancel),
      cancelLoading: (id: number) => ctx.ui.cancelLoading(id),
    },

    fetch: fetchCompat,

    setTimeout: (callback: () => void, delay?: number) => setTimeout(callback, delay ?? 0),
    clearTimeout: (id: number) => clearTimeout(id),
    setInterval: (callback: () => void, delay: number): Timer => {
      const id = setInterval(callback, delay)
      return { cancel: () => clearInterval(id) }
    },

    randomInt: (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min,
    randomDouble: (min: number, max: number) => Math.random() * (max - min) + min,
    createUuid: () => uuid(),

    log: (level: string, title: string, content: unknown) =>
      writeLog(normalizeLevel(level), "source", `${title}: ${stringify(content)}`),
    console: {
      log: (content: unknown) => writeLog("info", "source", stringify(content)),
      warn: (content: unknown) => writeLog("warning", "source", stringify(content)),
      error: (content: unknown) => writeLog("error", "source", stringify(content)),
    },

    compute: async (func: string, ...args: unknown[]) => {
      const evaluate = new Function("code", "return (0, eval)(code)") as (code: string) => unknown
      const value = evaluate(String(func))
      if (typeof value !== "function") throw new Error("compute：這段程式求值後不是函式")
      return (value as (...inner: unknown[]) => unknown)(...args)
    },

    setClipboard: async (_text: string) => {
      writeLog("warning", "source", "setClipboard 尚未支援")
    },
    getClipboard: async () => "",

    globalThis: sandboxView(),
  }

  return globals
}

function normalizeLevel(level: string): "debug" | "info" | "warning" | "error" {
  if (level === "error") return "error"
  if (level === "warning" || level === "warn") return "warning"
  if (level === "debug") return "debug"
  return "info"
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function uuid(): string {
  let out = ""
  for (let i = 0; i < 32; i++) {
    if (i === 8 || i === 12 || i === 16 || i === 20) out += "-"
    out += Math.floor(Math.random() * 16).toString(16)
  }
  return out
}
