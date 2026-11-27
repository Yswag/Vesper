import type { HostContext } from "./globals"
import { createGlobals } from "./globals"
import { log } from "./log"

const CLASS_PATTERN = /^\s*class\s+([a-zA-Z_$][\w$]*)\s+extends\s+ComicSource\b/m

export interface SourceMeta {
  className: string
  name: string
  key: string
  version: string
  minAppVersion: string
  url: string
}

export interface LoadedSource {
  meta: SourceMeta
  instance: any
  capabilities: SourceCapabilities
}

export interface SettingOption {
  value: string
  text: string
}

export interface SettingSpec {
  id: string
  title: string
  type: string
  options: SettingOption[]
  default?: unknown
  buttonText?: string
  validator?: string
}

export function extractSettings(
  instance: any,
  translate: (text: string) => string = text => text
): { defaults: Record<string, unknown>; specs: SettingSpec[] } {
  const raw = instance?.settings
  const defaults: Record<string, unknown> = {}
  const specs: SettingSpec[] = []
  if (!raw || typeof raw !== "object") return { defaults, specs }

  for (const [id, value] of Object.entries(raw as Record<string, any>)) {
    if (!value || typeof value !== "object") continue
    const spec: SettingSpec = {
      id,
      title: translate(String(value.title ?? id)),
      type: String(value.type ?? "input"),
      options: normalizeOptions(value.options, translate),
      default: "default" in value ? value.default : undefined,
      buttonText: typeof value.buttonText === "string" ? translate(value.buttonText) : undefined,
      validator: typeof value.validator === "string" ? value.validator : undefined,
    }
    specs.push(spec)
    if (spec.type === "callback") continue
    if (spec.default !== undefined) defaults[id] = spec.default
  }
  return { defaults, specs }
}

function normalizeOptions(raw: unknown, translate: (text: string) => string): SettingOption[] {
  if (!Array.isArray(raw)) return []
  const out: SettingOption[] = []
  for (const entry of raw) {
    if (typeof entry === "string") {
      const dash = entry.indexOf("-")
      out.push(
        dash > 0
          ? { value: entry.slice(0, dash), text: translate(entry.slice(dash + 1)) }
          : { value: entry, text: translate(entry) }
      )
      continue
    }
    if (!entry || typeof entry !== "object") continue
    const obj = entry as Record<string, unknown>
    if (obj.value === undefined || obj.value === null) continue
    const value = String(obj.value)
    out.push({ value, text: translate(String(obj.text ?? obj.label ?? value)) })
  }
  return out
}

export function mergeSettings(
  defaults: Record<string, unknown>,
  saved: Record<string, unknown> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [id, value] of Object.entries(defaults)) {
    out[id] = saved && id in saved ? saved[id] : value
  }
  return out
}

export interface SourceCapabilities {  search: boolean
  explore: boolean
  category: boolean
  categoryComics: boolean
  comic: boolean
  account: boolean
  favorites: boolean
  settings: boolean
  comments: boolean
  sendComment: boolean
  archive: boolean
  starRating: boolean
  modifyImage: boolean
  loginWithPassword: boolean
  loginWithWebview: boolean
  loginWithCookies: boolean
  translation: boolean
}

export function sourceClassName(code: string): string | null {
  const m = CLASS_PATTERN.exec(code)
  return m ? m[1] : null
}

export function loadSource(code: string, ctx: HostContext): LoadedSource {
  const className = sourceClassName(code)
  if (!className) {
    throw new Error("不是有效的漫畫源：找不到 `class X extends ComicSource`")
  }

  const globals = createGlobals(ctx)
  const names = Object.keys(globals)
  const values = names.map(name => globals[name])

  const body = `
    "use strict";
    (() => {
      ${code}
      this["temp"] = new ${className}()
    }).call(this)
    return this["temp"]
  `

  const fn = new Function(...names, body)
  const box: Record<string, unknown> = {}
  const instance = fn.call(box, ...values)
  if (!instance) throw new Error(`載入源失敗：${className} 建構後沒有實例`)

  const meta: SourceMeta = {
    className,
    name: String(instance.name ?? ""),
    key: String(instance.key ?? ""),
    version: String(instance.version ?? ""),
    minAppVersion: String(instance.minAppVersion ?? ""),
    url: String(instance.url ?? ""),
  }
  if (!meta.key) throw new Error(`${className} 沒有宣告 key`)

  return { meta, instance, capabilities: detectCapabilities(code, instance) }
}

export function detectCapabilities(code: string, instance: any): SourceCapabilities {
  const c = instance?.comic ?? {}
  const account = instance?.account ?? {}
  return {
    search: typeof instance?.search?.load === "function",
    explore: Array.isArray(instance?.explore) && instance.explore.length > 0,
    category: !!instance?.category,
    categoryComics: typeof instance?.categoryComics?.load === "function",
    comic: typeof c.loadInfo === "function",
    account: !!instance?.account,
    favorites: !!(instance?.favorites || instance?.comic?.favorites),
    settings: !!instance?.settings,
    comments: typeof c.loadComments === "function",
    sendComment: typeof c.sendComment === "function",
    archive: typeof c.archive?.getArchives === "function",
    starRating: typeof c.starRating === "function",
    modifyImage: /modifyImage\s*[:=]/.test(code),
    loginWithPassword: typeof account.login === "function",
    loginWithWebview: !!account.loginWithWebview,
    loginWithCookies: !!account.loginWithCookies,
    translation: !!instance?.translation && Object.keys(instance.translation ?? {}).length > 0,
  }
}

export function logLoad(meta: SourceMeta) {
  log("info", "source", `已載入 ${meta.name} (${meta.key}) v${meta.version}`)
}
