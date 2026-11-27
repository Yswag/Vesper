export function isCloudflareChallenge(status: number, headers: Record<string, string>, body: string | ArrayBuffer): boolean {
  if (status !== 403 && status !== 503) return false

  const mitigated = headers["cf-mitigated"]
  if (mitigated && mitigated.toLowerCase() === "challenge") return true

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
