declare const Keychain: {
  set(key: string, value: string): void
  get(key: string): string | null
  remove(key: string): void
  contains(key: string): boolean
}

export interface Credentials {
  account?: string
  password?: string
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
  }
}
