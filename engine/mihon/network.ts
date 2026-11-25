// Mihon 的網路預設值：宿主端唯一的來源，`open` 時傳進 worker。
//
// `MIHON_DEFAULT_USER_AGENT` 是 Mihon `NetworkPreferences.defaultUserAgent` 的預設值
// （mihonapp/mihon `core/common/.../network/NetworkPreferences.kt`，commit 0864ce0）。
// Mihon 把它做成使用者偏好；Vesper 這張票先固定，之後接設定項時只改這裡。
// 票 06 的 Cloudflare 過盾也要用同一個 UA（Mihon 的 `CloudflareInterceptor` 就是拿
// `defaultUserAgentProvider()`）。

export const MIHON_DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36"

let userAgent = MIHON_DEFAULT_USER_AGENT

/** 目前要給 dexvm 的預設 UA（空白的值退回內建值）。 */
export function mihonUserAgent(): string {
  return userAgent
}

/** 之後接 Mihon 的 `default_user_agent` 設定時呼叫；只補擴充沒宣告的 UA，不會覆蓋源自己的。 */
export function setMihonUserAgent(value: string): void {
  const trimmed = value.trim()
  userAgent = trimmed.length > 0 ? trimmed : MIHON_DEFAULT_USER_AGENT
}
