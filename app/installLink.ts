import { Script } from "scripting"

const INSTALL_PARAM = "install"

export function readInstallTarget(params: Record<string, any> | null | undefined): string | null {
  const raw = params?.[INSTALL_PARAM]
  if (typeof raw !== "string") return null
  const value = raw.trim()
  return /^https?:\/\/\S+$/i.test(value) ? value : null
}

type InstallListener = (url: string) => void

let listener: InstallListener | null = null

export function setInstallListener(fn: InstallListener | null) {
  listener = fn
}

export function listenForInstallLinks() {
  Script.onResume(details => {
    const target = readInstallTarget(details.queryParameters)
    if (target) listener?.(target)
  })
}
