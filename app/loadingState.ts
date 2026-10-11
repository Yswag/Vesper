// 源的載入指示（`UI.showLoading` / `UI.cancelLoading`）的狀態。
//
// 為什麼不是 modal：載入指示只是「告訴使用者正在做事」，用 `Navigation.present` 會蓋掉整個畫面
// ——一行字塞滿一頁，能看但很醜。這裡跟 toast 一樣：模組層級狀態 + App 樹裡的浮動視圖
// （`app/LoadingHUD.tsx`，掛在 App 的 TabView overlay 上）。
//
// 慣例照上游文件：
//   - `onCancel` 是**使用者按取消**時的回呼；源傳 null 代表這個指示不可取消。
//   - 源自己呼叫 `cancelLoading(id)` 只是收起來，**不會**跑 `onCancel`。
//
// 存活上限（`LOADING_TTL_MS`）：一個指示最多活 90 秒就自己收掉。
// 為什麼要：源呼叫 `showLoading()` 之後漏呼叫 `cancelLoading()` 是會真的發生的（真實源有），
// 那時指示會永遠留在 `active` 裡——使用者一直看到轉圈，陣列也無界成長。
// 為什麼是 90 秒：這些源最慢的一次請求（含瀏覽器登入流程）也在幾十秒內，超過 90 秒還活著
// 幾乎一定是漏收了；比這短則會誤殺還在跑的正常載入。

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

// ⚠️ Scripting 的 setTimeout 回傳 number，而且**第一個一定是 0**（falsy）——所以這裡只能比
// `undefined`／`Map.get` 的缺值，寫成 `if (handle) clearTimeout(handle)` 會漏掉那一個
// （實測見 dev/probe-emitter.ts）。
function clearExpiry(id: number) {
  const handle = expiries.get(id)
  if (handle === undefined) return
  expiries.delete(id)
  clearTimeout(handle)
}

/**
 * 使用者按了取消：跑那個指示的 `onCancel`（源自己的清理）再收起來。
 * 一次只處理最上面那一個——實務上（mxs）同時只會有一個。
 */
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
