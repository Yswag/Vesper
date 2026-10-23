// Cloudflare 挑戰的純判斷：只做 header／body 特徵比對，不碰 WebView、registry 或宿主。
// 獨立一支是為了讓 Aidoku 的代理層能 import，不會拉進 `cloudflare.ts` 的循環依賴。

/** 判斷回應是否為 Cloudflare 挑戰頁面。 */
export function isCloudflareChallenge(status: number, headers: Record<string, string>, body: string | ArrayBuffer): boolean {
  if (status !== 403 && status !== 503) return false

  // 1. 檢查特徵 Header
  const mitigated = headers["cf-mitigated"]
  if (mitigated && mitigated.toLowerCase() === "challenge") return true

  // 2. 檢查文字 Body 內容
  let text = ""
  if (typeof body === "string") {
    text = body
  } else if (body instanceof ArrayBuffer) {
    try {
      const decoder = new TextDecoder("utf-8")
      text = decoder.decode(body.slice(0, 4096))
    } catch {
      text = ""
    }
  }

  if (text.length > 0) {
    if (
      text.includes("/cdn-cgi/challenge-platform/") ||
      text.includes("Just a moment...") ||
      text.includes("Attention Required! | Cloudflare") ||
      text.includes("cf-browser-verification")
    ) {
      return true
    }
  }

  return false
}
