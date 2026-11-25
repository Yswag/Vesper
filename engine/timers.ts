// Scripting 的計時器只能在主 JS 執行佇列建。WebView 回呼與原生非同步的續行（例如
// `await ensureHost()` 之後）不一定在主佇列，那裡建 timer 會丟
// 「Timer requires its active script on the main JS execution queue」——而且會把整個呼叫炸掉，
// 連帶讓那個源在別人（聚合搜尋、追更）眼裡變成壞掉。
//
// 這裡把「建不了」變成回 null：呼叫端自己決定要放棄計時器，還是當場做掉。

export type TimerHandle = ReturnType<typeof setTimeout>

export function timerAfter(callback: () => void, ms: number): TimerHandle | null {
  try {
    return setTimeout(callback, ms)
  } catch {
    return null
  }
}

export function timerEvery(callback: () => void, ms: number): TimerHandle | null {
  try {
    return setInterval(callback, ms)
  } catch {
    return null
  }
}
