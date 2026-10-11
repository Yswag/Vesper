// 源的登入憑證。**存 Keychain，不進 index.json** —— 密碼與 API key 不該以明文躺在
// 一個會被 iCloud 備份的 JSON 檔裡。index.json 只記「有沒有登入」與帳號顯示名稱。

declare const Keychain: {
  set(key: string, value: string): void
  get(key: string): string | null
  remove(key: string): void
  contains(key: string): boolean
}

export interface Credentials {
  /** 帳密型登入用。 */
  account?: string
  password?: string
  /** loginWithCookies 型登入的欄位值（順序對應 fields）。 */
  cookies?: string[]
}

const PREFIX = "venera.cred."

function keyOf(sourceKey: string): string {
  return PREFIX + sourceKey
}

export function saveCredentials(sourceKey: string, credentials: Credentials) {
  try {
    Keychain.set(keyOf(sourceKey), JSON.stringify(credentials))
  } catch {
    // Keychain 不可用時就不要硬存，登入狀態仍會記在 index.json
  }
}

export function loadCredentials(sourceKey: string): Credentials | null {
  try {
    const raw = Keychain.get(keyOf(sourceKey))
    if (!raw) return null
    return JSON.parse(raw) as Credentials
  } catch {
    return null
  }
}

export function clearCredentials(sourceKey: string) {
  try {
    Keychain.remove(keyOf(sourceKey))
  } catch {
    // 已經沒有就算了
  }
}
