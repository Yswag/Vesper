import { fetch } from "scripting"

function base64url(bytes: Uint8Array): string {
  const data = Data.fromArrayBuffer(bytes.buffer as ArrayBuffer)
  if (!data) throw new Error("base64 encode failed")
  return data
    .toBase64String()
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

export function randomVerifier(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}

export function codeChallenge(verifier: string): string {
  const data = Data.fromArrayBuffer(new TextEncoder().encode(verifier).buffer as ArrayBuffer)
  if (!data) throw new Error("challenge failed")
  const digest = Crypto.sha256(data)
  return base64url(new Uint8Array(digest.toArrayBuffer()))
}

export interface OAuthParams {
  redirectUri?: string
  clientId?: string
}

export function paramsOf(authUrl: string): OAuthParams {
  const url = new URL(authUrl)
  return {
    redirectUri: url.searchParams.get("redirect_uri") ?? undefined,
    clientId: url.searchParams.get("client_id") ?? undefined,
  }
}

export function withPkce(authUrl: string, verifier: string): string {
  const url = new URL(authUrl)
  url.searchParams.set("code_challenge", codeChallenge(verifier))
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("response_type", "code")
  return url.toString()
}

export function codeOf(callbackUrl: string): string {
  const url = new URL(callbackUrl)
  const fromQuery = url.searchParams.get("code")
  if (fromQuery) return fromQuery
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash
  return new URLSearchParams(hash).get("code") ?? ""
}

export interface TokenRequest {
  tokenUrl: string
  code: string
  verifier: string
  redirectUri?: string
  clientId?: string
}

export async function exchangeToken(request: TokenRequest): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: request.code,
    code_verifier: request.verifier,
  })
  if (request.redirectUri) body.set("redirect_uri", request.redirectUri)
  if (request.clientId) body.set("client_id", request.clientId)

  const response = await fetch(request.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
  return text
}
