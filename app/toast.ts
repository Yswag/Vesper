// 全域 toast。源的 UI.showMessage 會走這裡 —— 沒有這層的話，源傳的訊息會直接消失
// （宿主 UI 若是空實作，使用者只會看到「按了沒反應」）。
//
// 用「註冊 listener」而不是 Observable：觀測物件的建立要透過 hook，
// 而這裡是模組層級的呼叫端（源在任意時刻都可能呼叫）。

let listener: ((message: string) => void) | null = null

export function showToast(message: string) {
  if (!message) return
  if (listener) listener(message)
}

export function setToastListener(fn: ((message: string) => void) | null) {
  listener = fn
}
