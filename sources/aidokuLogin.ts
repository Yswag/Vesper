import { hostOf } from "../engine/cookies"
import type { AidokuWebLoginData } from "./aidoku"
import { dumpLocalStorage } from "./webLogin"

export interface AidokuLoginTarget {
  url: string
  localStorageKeys: string[]
}

interface LoginCookie {
  name?: string
  value?: string | null
  domain?: string | null
}

function bareHost(value: string): string {
  return (value || "").split(":")[0].replace(/^\./, "").toLowerCase()
}

function sameSite(domain: string, host: string): boolean {
  const d = bareHost(domain)
  const h = bareHost(host)
  if (!d || !h) return false
  return d === h || d.endsWith("." + h) || h.endsWith("." + d)
}

export function filterLoginCookies(cookies: LoginCookie[], host: string): AidokuWebLoginData["cookies"] {
  const out: AidokuWebLoginData["cookies"] = []
  const at = new Map<string, number>()
  for (const cookie of cookies ?? []) {
    const name = typeof cookie?.name === "string" ? cookie.name : ""
    if (!name || !sameSite(String(cookie.domain ?? ""), host)) continue
    const value = String(cookie.value ?? "")
    const existing = at.get(name)
    if (existing !== undefined) {
      out[existing].value = value
      continue
    }
    at.set(name, out.length)
    out.push({ name, value })
  }
  return out
}

async function currentHost(controller: WebViewController): Promise<string> {
  try {
    const href = await controller.evaluateJavaScript<string>("return location.href")
    return typeof href === "string" ? hostOf(href) : ""
  } catch {
    return ""
  }
}

export async function harvestAidokuLogin(
  controller: WebViewController,
  target: AidokuLoginTarget
): Promise<AidokuWebLoginData> {
  const host = hostOf(target.url)
  const cookies = filterLoginCookies((await controller.getAllCookies()) ?? [], host)
  const localStorage: Record<string, string> = {}

  if (target.localStorageKeys.length > 0) {
    const here = await currentHost(controller)
    if (sameSite(here, host)) {
      const values = await dumpLocalStorage(controller, target.localStorageKeys)
      for (const name of target.localStorageKeys) {
        const value = values[name]
        if (typeof value === "string" && value !== "") localStorage[name] = value
      }
    }
  }

  return { cookies, localStorage }
}
