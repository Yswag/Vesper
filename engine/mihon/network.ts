export const MIHON_DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36"

let userAgent = MIHON_DEFAULT_USER_AGENT

export function mihonUserAgent(): string {
  return userAgent
}

export function setMihonUserAgent(value: string): void {
  const trimmed = value.trim()
  userAgent = trimmed.length > 0 ? trimmed : MIHON_DEFAULT_USER_AGENT
}
