// Aidoku 的 webview 登入：從登入頁（`<WebView>` 用的 WebViewController）收
// cookie 與 localStorage，整理成源的設定要的形狀。
//
// 只收登入網域的東西；值不寫進 log。

import { hostOf } from "../engine/cookies"
import type { AidokuWebLoginData } from "./aidoku"
import { dumpLocalStorage } from "./webLogin"

export interface AidokuLoginTarget {
  /** `login.url`：決定收哪個網域的 cookie，也是判斷 localStorage origin 的依據。 */
  url: string
  /** `login.localStorageKeys`：空＝不讀 localStorage。 */
  localStorageKeys: string[]
}

/** 比對用的最小 cookie 形狀（WebViewController 的 `Cookie` 直接傳進來就好）。 */
interface LoginCookie {
  name?: string
  value?: string | null
  domain?: string | null
}

function bareHost(value: string): string {
  return (value || "").split(":")[0].replace(/^\./, "").toLowerCase()
}

/**
 * 同站比對：cookie 網域等於 host，或一方是另一方的子網域。
 *
 * 子網域**含**進來（cookie 種在 `auth.example.com`、登入頁是 `www.example.com` 也收）；
 * 父網域的 cookie（登入頁 `www.example.com`、cookie 種在 `.example.com`）也含。
 */
function sameSite(domain: string, host: string): boolean {
  const d = bareHost(domain)
  const h = bareHost(host)
  if (!d || !h) return false
  return d === h || d.endsWith("." + h) || h.endsWith("." + d)
}

/** 只留下登入網域（含子網域）的 cookie；同名 cookie 後來的值蓋掉前面的。 */
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

/**
 * 收下這次登入能用的東西。
 *
 * localStorage 是 per-origin：頁面不在登入網域上（例如導到別的驗證站）就不讀，
 * 免得把別站的資料寫進來。沒有指定 `localStorageKeys` 時連 localStorage 都不碰。
 */
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
