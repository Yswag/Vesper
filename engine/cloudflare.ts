import { type Cookie, setCookies } from "./cookies"
import { isCloudflareChallenge } from "./cloudflareDetect"
import { log } from "./log"
import { t } from "../i18n"

export { isCloudflareChallenge }

let sourceNameLookup: ((key: string) => string | undefined) | null = null

export function setCloudflareSourceNameLookup(lookup: ((key: string) => string | undefined) | null): void {
  sourceNameLookup = lookup
}

const CF_TIMEOUT_MS = 45000
const INITIAL_OFFSCREEN_WAIT_MS = 2500
const POLL_INTERVAL_MS = 1000

export interface CloudflareSolveOptions {
  hostJarNames?: readonly string[]
  timeoutMs?: number
}

const activeSolvers = new Map<string, Promise<Cookie[]>>()

function originOf(url: string): string {
  const m = /^https?:\/\/[^/]+/i.exec(url)
  return m ? m[0] : url
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function solveCloudflare(
  sourceKey: string,
  url: string,
  userAgent: string,
  options: CloudflareSolveOptions = {}
): Promise<Cookie[]> {
  const origin = originOf(url)
  const existing = activeSolvers.get(origin)
  if (existing) {
    log("info", "cf", `同網域 (${origin}) 已有過盾任務進行中，排隊等待結果`)
    return existing
  }

  const timeoutMs = options.timeoutMs ?? CF_TIMEOUT_MS

  const task = (async (): Promise<Cookie[]> => {
    log("info", "cf", `開始處理 Cloudflare 驗證: ${origin}`, { sourceKey, url })
    const controller = new WebViewController()
    controller.setCustomUserAgent(userAgent)

    let isPresented = false
    const startedAt = Date.now()

    try {
      try {
        const oldCookies = await controller.getCookies(`${origin}/`).catch(() => [] as Cookie[])
        const toDelete = oldCookies.filter(c => c.name === "cf_clearance" || c.name.startsWith("cf_chl"))
        if (toDelete.length > 0) {
          log("info", "cf", `清理 ${toDelete.length} 個殘留的 Cloudflare Cookie: ${origin}`)
          for (const c of toDelete) {
            await controller.deleteCookie(c).catch(() => false)
          }
        }
      } catch (err) {
        log("warning", "cf", `預清理 CF Cookie 失敗（繼續嘗試導航）: ${origin}`, { error: String(err) })
      }

      await controller.loadURL(url)

      const checkScript = `return (function() {
        try {
          var title = document.title || '';
          if (/Just a moment|Attention Required|请稍候/i.test(title)) return false;
          var body = document.body;
          if (!body || body.innerHTML.length < 512) return false;
          return true;
        } catch (e) {
          return false;
        }
      })()`

      while (Date.now() - startedAt < timeoutMs) {
        await sleep(POLL_INTERVAL_MS)

        if (!isPresented && Date.now() - startedAt >= INITIAL_OFFSCREEN_WAIT_MS) {
          log("info", "cf", `離屏等待未放行，彈出驗證視窗供用戶操作: ${origin}`)
          isPresented = true
          const sourceName = sourceNameLookup?.(sourceKey) || sourceKey
          const title = t("sources.verificationTitle", { name: sourceName })
          void controller.present({
            fullscreen: true,
            navigationTitle: title,
          })
        }

        const domReady = await controller.evaluateJavaScript<boolean>(checkScript).catch(() => false)
        if (!domReady) continue

        const cookies = await controller.getCookies(url).catch(() => [] as Cookie[])
        const hasClearance = cookies.some(c => c.name === "cf_clearance")

        if (hasClearance) {
          log("info", "cf", `Cloudflare 驗證通過 (${Date.now() - startedAt}ms)`, {
            sourceKey,
            cookiesCount: cookies.length,
          })

          setCookies(sourceKey, url, options.hostJarNames ? cookies.filter(c => options.hostJarNames!.includes(c.name)) : cookies)

          if (isPresented) {
            controller.dismiss()
          }
          return cookies
        }
      }

      if (isPresented) {
        controller.dismiss()
      }
      throw new Error(t("sources.verificationTimeout", { seconds: Math.round(timeoutMs / 1000) }))
    } catch (e) {
      if (isPresented) {
        controller.dismiss()
      }
      log("error", "cf", `Cloudflare 驗證失敗: ${origin}`, {
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    } finally {
      controller.dispose()
      activeSolvers.delete(origin)
    }
  })()

  activeSolvers.set(origin, task)
  return task
}
