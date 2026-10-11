// 下載的偏好設定。目前只有一個：允許背景續傳（只有 Scripting Pro 才真的生效）。
//
// 變更要通知訂閱者：下載進行中把開關打開時，背景時間要立刻開始持有。

import { createEmitter } from "../engine/emitter"
import { kv } from "../engine/storage"

/** 與探針共用的鍵。 */
const KEY = "venera:backgroundDownloads"

const bus = createEmitter()

/** 背景續傳：預設關（要 Scripting Pro 才有意義，而且耗電）。 */
export function getBackgroundDownloads(): boolean {
  return kv.get(KEY) === true
}

export function setBackgroundDownloads(value: boolean): void {
  if (getBackgroundDownloads() === value) return
  if (value) kv.set(KEY, true)
  else kv.remove(KEY)
  bus.emit()
}

export const subscribeBackgroundDownloads = bus.subscribe
