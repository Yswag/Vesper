// Cloudflare 自動過盾模組。
// 當 HTTP 請求遭遇 403 且帶有 Cloudflare 挑戰特徵時，透過 WebViewController 執行挑戰並抽取 Cookie。

import { type Cookie, setCookies } from "./cookies"
import { isCloudflareChallenge } from "./cloudflareDetect"
import { log } from "./log"
import { t } from "../i18n"

export { isCloudflareChallenge }

/** 源的顯示名稱：由 registry 在載入時接上（不直接 import，避免 cloudflare ↔ registry 的循環依賴）。 */
let sourceNameLookup: ((key: string) => string | undefined) | null = null

export function setCloudflareSourceNameLookup(lookup: ((key: string) => string | undefined) | null): void {
  sourceNameLookup = lookup
}

const CF_TIMEOUT_MS = 45000
const INITIAL_OFFSCREEN_WAIT_MS = 2500
const POLL_INTERVAL_MS = 1000

// 每個 origin 的單例過盾 Promise，避免並發請求同時建立多個視窗 (Request Coalescing / Mutex)
const activeSolvers = new Map<string, Promise<boolean>>()

function originOf(url: string): string {
  const m = /^https?:\/\/[^/]+/i.exec(url)
  return m ? m[0] : url
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 執行 Cloudflare 過盾流程。
 * 1. 同 origin 互斥排隊（Coalescing）
 * 2. 啟動 WebViewController（帶目標 UA）
 * 3. 前 2.5s 離屏等待，若未通過則 present() 升級為可見彈窗
 * 4. 輪詢直到 DOM 到達真實頁且出現 cf_clearance
 * 5. 抽 Cookie 寫回 cookies.ts，並釋放 controller
 */
export async function solveCloudflare(sourceKey: string, url: string, userAgent: string): Promise<boolean> {
  const origin = originOf(url)
  const existing = activeSolvers.get(origin)
  if (existing) {
    log("info", "cf", `同網域 (${origin}) 已有過盾任務進行中，排隊等待結果`)
    return existing
  }

  const task = (async (): Promise<boolean> => {
    log("info", "cf", `開始處理 Cloudflare 驗證: ${origin}`, { sourceKey, url })
    const controller = new WebViewController()
    controller.setCustomUserAgent(userAgent)

    let isPresented = false
    const startedAt = Date.now()

    try {
      // 在載入 URL 之前，先清除該 origin 底下殘留的過期 CF Cookie（避免 stale clearance 毒化新挑戰）
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

      // 導航到目標網址
      await controller.loadURL(url)

      // 檢查 DOM 與 Cookie 的輔助腳本
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

      while (Date.now() - startedAt < CF_TIMEOUT_MS) {
        // 先等一拍
        await sleep(POLL_INTERVAL_MS)

        // 檢查是否超過離屏等待時間（2.5 秒），若尚未放行且未彈窗，主動 present 升級可見
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

        // 1. 檢查 DOM 是否已到達真實頁
        const domReady = await controller.evaluateJavaScript<boolean>(checkScript).catch(() => false)
        if (!domReady) continue

        // 2. 檢查 Cookie 是否已有 cf_clearance
        const cookies = await controller.getCookies(url).catch(() => [] as Cookie[])
        const hasClearance = cookies.some(c => c.name === "cf_clearance")

        if (hasClearance) {
          log("info", "cf", `Cloudflare 驗證通過 (${Date.now() - startedAt}ms)`, {
            sourceKey,
            cookiesCount: cookies.length,
          })

          // 將所有抽取到的 Cookie 寫入 Vesper 的 Cookie Jar
          setCookies(sourceKey, url, cookies)

          if (isPresented) {
            controller.dismiss()
          }
          return true
        }
      }

      if (isPresented) {
        controller.dismiss()
      }
      throw new Error(`Cloudflare 驗證超時 (${CF_TIMEOUT_MS / 1000}s)`)
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
