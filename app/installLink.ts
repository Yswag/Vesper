// 「點連結就加入源倉庫」：scripting://run/Vesper?install=<index.json 網址>
//
// URL 的 query 值一律是字串。`run` 在實例還活著時**不會重跑入口檔**，只會觸發 onResume，
// 所以兩條路徑都要接：入口讀 Script.queryParameters（冷啟動）、這裡聽 onResume（熱啟動）。

import { Script } from "scripting"

const INSTALL_PARAM = "install"

/** 只收 http(s)：連結可能來自任何人，不讓其他 scheme 進 fetch。 */
export function readInstallTarget(params: Record<string, any> | null | undefined): string | null {
  const raw = params?.[INSTALL_PARAM]
  if (typeof raw !== "string") return null
  const value = raw.trim()
  return /^https?:\/\/\S+$/i.test(value) ? value : null
}

type InstallListener = (url: string) => void

let listener: InstallListener | null = null

/** 由 App 註冊（只有它備有 toast 與可跳轉的畫面）。 */
export function setInstallListener(fn: InstallListener | null) {
  listener = fn
}

/** 入口註冊一次即可；回傳的退訂用不到，入口活著就跟著實例。 */
export function listenForInstallLinks() {
  Script.onResume(details => {
    const target = readInstallTarget(details.queryParameters)
    if (target) listener?.(target)
  })
}
