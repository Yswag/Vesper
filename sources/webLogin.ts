// 瀏覽器登入：真的開一個瀏覽器，登入完把東西交回該源。
//
// 五個真實源宣告 loginWithWebview，而它們要的不只是 cookie：mycomic 要 Cloudflare 的
// cf_clearance、ccc 要網頁 localStorage 裡的 JWT、nhentai 要從 cookie 撈 access_token、
// ehentai 要把論壇 cookie 改網域、manga_dex 只要 session cookie。
//
// 順序照 Venera：先寫 localStorage、再把 cookie 併進 jar、最後才呼叫 onLoginSuccess——
// ccc / nhentai / ehentai 的 callback 就是在讀前面那兩樣東西。
//
// 這一層屬於 UI（WebViewController 是 UI 的東西），engine 不碰它；憑證落地（loggedIn、
// 重建實例）留給呼叫端 registry，這裡只回傳結果。

import type { Cookie } from "../engine/convert-types"
import { domainMatchesHost, getCookies, hostOf, setCookies } from "../engine/cookies"
import { writeSourceData } from "../engine/host"
import { log } from "../engine/log"
import { t } from "../i18n"

/** 源宣告的 `account.loginWithWebview`。 */
export interface WebLoginSpec {
  url: string
  /** 同步判斷「這一頁算不算登入成功」。 */
  checkStatus?: (url: string, title: string) => unknown
  onLoginSuccess?: () => unknown
}

export interface WebLoginResult {
  /** success = 源的 checkStatus 成立；manual = 使用者自己關掉後確認要存；cancelled = 什麼都沒寫。 */
  outcome: "success" | "manual" | "cancelled"
  cookies: number
  /** checkStatus 被問了幾次（診斷用：輪詢有沒有活著）。 */
  checkCalls: number
}

/** 輪詢間隔。WebViewController 沒有導航事件，只能自己讀。 */
const POLL_MS = 800
const LOAD_TIMEOUT_MS = 20000
const CALLBACK_TIMEOUT_MS = 10000

/** 一次只准一個登入視窗：兩個 controller 會互相覆蓋同一份 jar。 */
let running = false

export function webLoginRunning(): boolean {
  return running
}

function withTimeout<T>(task: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(t("sources.login.timeout", { subject: what, seconds: ms / 1000 }))), ms)
    task.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ------------------------------------------------------------------ 可獨立呼叫的三件事

function toBrowserCookie(cookie: Cookie) {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: "/",
    isSecure: false,
    isHTTPOnly: false,
    isSessionOnly: true,
    expiresDate: null,
  }
}

/**
 * 把該源 jar 裡的 cookie 播種進瀏覽器，這樣「已經登入過、只是想重抓一次」的重按是安全的：
 * 每次都是帶著現況進去、帶著最新狀態出來。
 */
export async function seedCookies(controller: WebViewController, sourceKey: string, url: string): Promise<number> {
  let count = 0
  for (const cookie of getCookies(sourceKey, url)) {
    try {
      if (await controller.setCookie(toBrowserCookie(cookie))) count++
    } catch (error) {
      log("warning", "account", `${sourceKey} 播種 cookie 失敗：${cookie.name}`, error)
    }
  }
  return count
}

/**
 * 收割瀏覽器裡的 cookie。只留跟這些網址同網域的（瀏覽器可能看過別的站），
 * 形狀收成 jar 的形式（name / value / domain），同一個 (name, domain) 只留一筆。
 */
export async function harvestCookies(controller: WebViewController, urls: string[]): Promise<Cookie[]> {
  const hosts = urls.map(hostOf).filter(Boolean)
  const all = await controller.getAllCookies()
  const out: Cookie[] = []
  const seen = new Set<string>()
  for (const raw of all ?? []) {
    const name = raw?.name
    if (!name) continue
    const domain = raw.domain || ""
    if (hosts.length > 0 && !hosts.some(host => domainMatchesHost(domain, host))) continue
    const id = `${name}\u0000${domain}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ name, value: raw.value ?? "", domain })
  }
  return out
}

/**
 * 讀當前頁面的 localStorage 成 `{key: value}`。源的 `onLoginSuccess` 會用
 * `this.loadData("_localStorage")` 拿它（ccc 的 JWT 就是這樣來的）。
 * 讀不到（不同 origin、頁面已導航）就回空的，不拋錯。
 */
export async function dumpLocalStorage(controller: WebViewController): Promise<Record<string, string>> {
  try {
    const json = await controller.evaluateJavaScript<string>(
      "return (() => { try { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k != null) o[k] = String(localStorage.getItem(k)); } return JSON.stringify(o); } catch (e) { return ''; } })()"
    )
    if (!json) return {}
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) out[key] = String(value)
    return out
  } catch {
    return {}
  }
}

// ------------------------------------------------------------------ 流程

/**
 * 開一個瀏覽器讓使用者登入，成功就自己關掉。
 *
 * 不寫任何登入狀態——那是 registry 的事；這裡只負責「瀏覽器 ⇄ 源的資料」。
 */
export async function runWebLogin(params: {
  sourceKey: string
  sourceName: string
  spec: WebLoginSpec
}): Promise<WebLoginResult> {
  if (running) throw new Error(t("sources.login.windowBusy"))
  running = true

  const { sourceKey, sourceName, spec } = params
  const controller = new WebViewController({ ephemeral: true })

  let timer: number | null = null
  let polling = false
  let handlingSuccess = false
  let checkCalls = 0
  let lastUrl: string | null = null
  let lastTitle: string | null = null
  let warnedThrow = false
  let warnedNonBool = false
  let result: WebLoginResult | null = null
  /** 這次實際進到 jar 的 cookie 名字（log 用：出事時不用猜抓到什麼）。 */
  let captured: string[] = []
  /** 成功路徑的工作；在「關閉」之後我們要等它做完，不能跟它搶著處理同一筆結果。 */
  let successTask: Promise<void> | null = null

  function stopPolling() {
    polling = false
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function schedule() {
    if (!polling || handlingSuccess) return
    timer = setTimeout(() => {
      void tick()
    }, POLL_MS)
  }

  /** 只有 `=== true` 算成功；拋錯或回非布林都當未登入，而且每次嘗試只記一行。 */
  function isLoggedIn(url: string, title: string): boolean {
    const fn = spec.checkStatus
    if (typeof fn !== "function") return false
    try {
      const value = fn(url, title)
      if (value === true) return true
      if (!warnedNonBool && value !== false && value != null) {
        warnedNonBool = true
        const hint = typeof (value as { then?: unknown }).then === "function" ? "（checkStatus 應該是同步函式）" : ""
        log("warning", "account", `${sourceKey} 的 checkStatus 回傳非布林值，當作未登入${hint}`, value)
      }
      return false
    } catch (error) {
      if (!warnedThrow) {
        warnedThrow = true
        log("warning", "account", `${sourceKey} 的 checkStatus 拋錯，當作未登入`, error)
      }
      return false
    }
  }

  /** 成功路徑：順序是 localStorage → cookie 併入 jar → onLoginSuccess → 關閉。 */
  async function finishSuccess(url: string) {
    const storage = await dumpLocalStorage(controller)
    if (Object.keys(storage).length > 0) writeSourceData(sourceKey, "_localStorage", storage)
    const cookies = await harvestCookies(controller, [url, spec.url])
    captured = cookies.map(cookie => cookie.name)
    setCookies(sourceKey, url, cookies)
    if (typeof spec.onLoginSuccess === "function") {
      try {
        await withTimeout(Promise.resolve(spec.onLoginSuccess()), CALLBACK_TIMEOUT_MS, t("sources.login.callback"))
      } catch (error) {
        log("warning", "account", `${sourceKey} 的 onLoginSuccess() 失敗（登入仍算成功）`, error)
      }
    }
    result = { outcome: "success", cookies: cookies.length, checkCalls }
    stopPolling()
    controller.dismiss()
  }

  async function tick() {
    if (!polling || handlingSuccess) return
    let url = lastUrl
    let title = lastTitle
    try {
      const value = await controller.evaluateJavaScript<string>("return location.href")
      if (typeof value === "string" && value) url = value
    } catch {
      // 導航中讀不到是正常的，下一輪再試
    }
    try {
      const value = await controller.evaluateJavaScript<string>("return document.title")
      if (typeof value === "string") title = value
    } catch {
      // 同上
    }
    if (!polling || handlingSuccess) return
    // 只在「有變化」時問源，這是 Venera 在 onNavigation / onTitleChange 上驗的等價翻譯。
    if (url && (url !== lastUrl || title !== lastTitle)) {
      lastUrl = url
      lastTitle = title
      checkCalls++
      if (isLoggedIn(url, title ?? "")) {
        handlingSuccess = true
        stopPolling()
        successTask = finishSuccess(url)
        await successTask
        return
      }
    }
    schedule()
  }

  let closedResolve: () => void = () => {}
  const closed = new Promise<void>(resolve => {
    closedResolve = resolve
  })

  try {
    const seeded = await seedCookies(controller, sourceKey, spec.url)

    // 先開 sheet 再載入：使用者看到的是網頁在載，而不是空白。
    // present() 的 promise 在「關閉」時才 resolve，而且沒有原因——所以我們自己用旗標分辨。
    void controller
      .present({ navigationTitle: t("sources.login.windowTitle", { name: sourceName }) })
      .catch(error => log("warning", "account", "瀏覽器登入視窗異常", error))
      .then(() => closedResolve())

    try {
      await withTimeout(
        (async () => {
          await controller.loadURL(spec.url)
          await controller.waitForLoad()
        })(),
        LOAD_TIMEOUT_MS,
        t("sources.login.pageLoading")
      )
    } catch (error) {
      stopPolling()
      controller.dismiss()
      await closed
      throw new Error(t("sources.login.pageLoadFailed", { message: messageOf(error) }))
    }

    polling = true
    schedule()
    await closed
    stopPolling()

    // 使用者自己關掉，而且 checkStatus 從沒成立過：不假裝成功。
    // （若成功路徑正在跑——例如使用者在 onLoginSuccess 期間把視窗滑掉——等它做完，由它決定結果。）
    if (successTask) {
      await successTask
    } else {
      const cookies = await harvestCookies(controller, [lastUrl ?? spec.url, spec.url])
      if (cookies.length === 0) {
        result = { outcome: "cancelled", cookies: 0, checkCalls }
      } else {
        const confirmed = await Dialog.confirm({
          title: t("sources.login.incompleteTitle"),
          message: t("sources.login.incompleteMessage", { count: cookies.length }),
          confirmLabel: t("sources.login.saveCookies"),
        })
        if (confirmed) {
          setCookies(sourceKey, lastUrl ?? spec.url, cookies)
          captured = cookies.map(cookie => cookie.name)
          result = { outcome: "manual", cookies: cookies.length, checkCalls }
        } else {
          result = { outcome: "cancelled", cookies: 0, checkCalls }
        }
      }
    }

    if (!result) result = { outcome: "cancelled", cookies: 0, checkCalls }

    log(
      "info",
      "account",
      `${sourceKey} 瀏覽器登入：${result.outcome}（cookie ${result.cookies} 個，checkStatus 問了 ${result.checkCalls} 次，播種 ${seeded} 個）`,
      { cookies: captured, ua: controller.getCustomUserAgent() || "（預設）" }
    )
    return result
  } finally {
    stopPolling()
    running = false
    try {
      controller.dispose()
    } catch {
      // 已經壞掉的 controller 就算了
    }
  }
}
