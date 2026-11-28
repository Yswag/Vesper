import { bareHost, hostOf } from "../engine/cookies"
import { log } from "../engine/log"
import { mihonUserAgent } from "../engine/mihon/network"

import { clearCookiesFor, headersOf, refOf, replaceSiteCookies, siteCookies } from "./mihon"
import { scopeOfDomain, type JarCookie } from "./mihonCookies"
import type { InstalledSource } from "./registry"

export interface WebCookie {
  name: string
  value: string
  domain: string
}

export interface MihonWebSession {
  sourceKey: string
  apkKey: string
  url: string
  host: string
  userAgent: string
  headers: Record<string, string>
  cookies: WebCookie[]
}

const UNSAFE_HEADERS = new Set([
  "content-length",
  "host",
  "trailer",
  "te",
  "upgrade",
  "cookie2",
  "keep-alive",
  "transfer-encoding",
  "set-cookie",
  "origin",
])

function isSafeHeader(name: string, value: string): boolean {
  const lower = name.toLowerCase()
  if (UNSAFE_HEADERS.has(lower) || lower.startsWith("proxy-")) return false
  return !(lower === "connection" && value.toLowerCase() === "upgrade")
}

export function webViewHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  const seen = new Set<string>()
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (lower === "user-agent" || seen.has(lower) || !isSafeHeader(name, value)) continue
    seen.add(lower)
    out[name] = value
  }
  return out
}

function userAgentOf(headers: Record<string, string>): string {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === "user-agent" && value.trim()) return value
  }
  return mihonUserAgent()
}

export function sameHost(url: string, host: string): boolean {
  return Boolean(host) && bareHost(hostOf(url)) === host
}

function toWebCookie(cookie: JarCookie): WebCookie {
  return { name: cookie.name, value: cookie.value, domain: cookie.scope }
}

function toJarCookie(cookie: WebCookie): JarCookie {
  return { scope: scopeOfDomain(cookie.domain), name: cookie.name, value: cookie.value }
}

export async function openWebSession(source: InstalledSource): Promise<MihonWebSession> {
  const ref = refOf(source)
  let headers: Record<string, string> = {}
  try {
    headers = await headersOf(source)
  } catch (failure) {
    log("warning", "mihon", `${ref.sourceKey} 的 headers 問不到，網頁不帶源的 headers`, failure)
  }
  const cookies = await siteCookies(ref.apkKey, ref.baseUrl)
  return {
    sourceKey: ref.sourceKey,
    apkKey: ref.apkKey,
    url: ref.baseUrl,
    host: bareHost(hostOf(ref.baseUrl)),
    userAgent: userAgentOf(headers),
    headers: webViewHeaders(headers),
    cookies: cookies.map(toWebCookie),
  }
}

export async function closeWebSession(session: MihonWebSession, cookies: readonly WebCookie[]): Promise<void> {
  const entries = cookies.map(toJarCookie).filter(cookie => cookie.scope && cookie.name)
  await replaceSiteCookies(session.apkKey, session.url, entries)
}

function isWebUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url)
}

export class MihonWebView {
  private session: MihonWebSession | null = null
  private readonly pending = new Set<string>()

  constructor(readonly controller: WebViewController) {
    controller.onNavigationAction = action => this.decide(action)
  }

  get homeUrl(): string {
    return this.session?.url ?? ""
  }

  currentUrl(): string {
    const url = this.controller.url
    return isWebUrl(url) ? url : this.homeUrl
  }

  async start(source: InstalledSource): Promise<void> {
    const session = await openWebSession(source)
    await this.controller.setSettings({ customUserAgent: session.userAgent })
    for (const cookie of session.cookies) {
      await this.controller.setCookie({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: "/",
        isSecure: false,
        isHTTPOnly: false,
        isSessionOnly: true,
      })
    }
    this.session = session
    await this.load(session.url)
  }

  private headersFor(url: string): Record<string, string> {
    const session = this.session
    return session && sameHost(url, session.host) ? session.headers : {}
  }

  private async load(url: string): Promise<boolean> {
    const headers = this.headersFor(url)
    if (Object.keys(headers).length > 0) this.pending.add(url)
    return await this.controller.loadRequest({ url, headers })
  }

  private decide(action: WebViewNavigationAction): WebViewNavigationPolicy {
    const url = action.url
    if (action.isMainFrame === false || action.method.toUpperCase() !== "GET" || !isWebUrl(url)) return "allow"
    if (this.pending.delete(url)) return "allow"
    if (Object.keys(this.headersFor(url)).length === 0) return "allow"
    if (action.navigationType !== "linkActivated" && action.navigationType !== "other") return "allow"
    if (url === this.controller.url) return "allow"
    void this.load(url)
    return "cancel"
  }

  async clearCookies(url: string = this.currentUrl()): Promise<number> {
    const session = this.session
    if (!session || !url) return 0
    for (const cookie of await this.controller.getCookies(url)) {
      await this.controller.deleteCookie({ name: cookie.name, domain: cookie.domain, path: cookie.path })
    }
    return await clearCookiesFor(session.apkKey, url)
  }

  async finish(): Promise<void> {
    const session = this.session
    this.session = null
    this.pending.clear()
    this.controller.onNavigationAction = undefined
    if (session) await closeWebSession(session, await this.controller.getAllCookies())
  }
}
