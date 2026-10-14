// 來源載入指示（UI.showLoading / UI.cancelLoading）狀態管理。
// 採全域通知搭配 Floating HUD 呈現。每個指示具備預設 90 秒 TTL 兜底機制，防止來源漏呼叫 cancelLoading 導致指示常駐。

import { createEmitter } from "../engine/emitter"

/** 指示的存活上限（毫秒）。理由見檔頭；`showLoading` 的第三個參數可以覆寫它（探針用）。 */
export const LOADING_TTL_MS = 90_000

export interface LoadingEntry {
  id: number
  message?: string
  /** 使用者按取消時要跑的回呼；沒有就代表不可取消。 */
  onCancel?: () => void
}

let active: LoadingEntry[] = []
let nextId = 1

// 每個指示的過期計時器。放在這個表而不是 `LoadingEntry` 裡：計時器是模組的實作細節
// （`LoadingEntry` 是給 HUD 看的），而且 `active` 會換陣列、不會換這個表。
const expiries = new Map<number, ReturnType<typeof setTimeout>>()

const bus = createEmitter()

/** 目前的載入指示（後進的在後面＝疊在最上面）。 */
export function activeLoadings(): LoadingEntry[] {
  return active
}

export const subscribeLoading = bus.subscribe

/** 顯示載入指示，支援自訂訊息文案，回傳可以拿去 `hideLoading` 的 id。 */
export function showLoading(
  onCancelOrMessage?: unknown,
  customMessage?: string,
  ttlMs: number = LOADING_TTL_MS
): number {
  const id = nextId++
  const onCancel = typeof onCancelOrMessage === "function" ? (onCancelOrMessage as () => void) : undefined
  const message = typeof onCancelOrMessage === "string" ? onCancelOrMessage : customMessage

  active = active.concat({
    id,
    message,
    onCancel,
  })
  scheduleExpiry(id, ttlMs)
  bus.emit()
  return id
}

/** 源自己收起來（不會跑 `onCancel`）。 */
export function hideLoading(id: number) {
  clearExpiry(id)
  const next = active.filter(entry => entry.id !== id)
  if (next.length === active.length) return
  active = next
  bus.emit()
}

/** 排一個「時間到就當作源自己收掉」的計時器。 */
function scheduleExpiry(id: number, ttlMs: number) {
  const handle = setTimeout(() => {
    // 先把自己從表裡拿掉：回呼跑的時候這個計時器已經用掉了，留著會是一個永遠清不掉的 handle。
    expiries.delete(id)
    hideLoading(id)
  }, ttlMs)
  expiries.set(id, handle)
}

// ⚠️ setTimeout 回傳值可為 0（falsy），比對需檢查是否為 undefined
function clearExpiry(id: number) {
  const handle = expiries.get(id)
  if (handle === undefined) return
  expiries.delete(id)
  clearTimeout(handle)
}

/** 使用者點擊取消：執行來源的 onCancel 回調後關閉指示。 */
export function cancelLoadingFromUser(id: number) {
  const entry = active.find(item => item.id === id)
  if (!entry) return
  if (entry.onCancel) {
    try {
      entry.onCancel()
    } catch {
      // 源的清理失敗不該讓指示卡住
    }
  }
  hideLoading(id)
}
