// 通知／訂閱的共用寫法。
//
// 全 App 的通知模組都在做同一件事：一份 listener 清單、一個 subscribe 回退訂、一個「跑一輪
// listener」的迴圈。這裡收掉搬運的部分，留下兩個真正要決定的：
//   - 什麼時候通知、要不要合併（`emit()` / `emitDebounced()`）
//   - listener 拋錯怎麼辦（預設吞掉；要看得到就自己傳 `onListenerError`）
//
// **「要不要去抖、幾毫秒、要不要立即版」留在呼叫端**——每個模組的理由不一樣
// （下載是每張圖都會通知，書架是滑動時領先頁一直變），所以不是這裡的預設值。

export interface Emitter {
  /** 立刻通知所有訂閱者（同步）。 */
  emit(): void
  /** 去抖後通知：期間多次呼叫只送最後一次。沒設定 `debounceMs` 就等於 `emit()`。 */
  emitDebounced(): void
  /** 取消還沒送出的去抖通知（要立刻送就 `cancelPending()` 再接 `emit()`）。 */
  cancelPending(): void
  subscribe(fn: () => void): () => void
}

export interface EmitterOptions {
  /** 有設定才會有去抖；毫秒數由呼叫端決定。 */
  debounceMs?: number
  /**
   * listener 拋錯時的回報點。預設吞掉——一個壞掉的訂閱者不該擋住其他人，
   * 而且通知常常發生在別人的寫入流程中間，把錯誤往外丟只會讓不相干的操作失敗。
   *
   * ⚠️ 不要在 `engine/log.ts` 自己的 emitter 上傳 `log`：它的訂閱者拋錯會回頭再呼叫
   * `log()`，又跑一輪同一批訂閱者，同一顆炸彈再爆一次。
   */
  onListenerError?: (error: unknown) => void
}

export function createEmitter(options: EmitterOptions = {}): Emitter {
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | null = null

  function fire() {
    // 先快照：通知期間有人退訂才不會漏掉後面的人。
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        options.onListenerError?.(error)
      }
    }
  }

  return {
    emit: fire,
    emitDebounced() {
      if (options.debounceMs === undefined || options.debounceMs <= 0) {
        fire()
        return
      }
      // ⚠️ 一定要比 `null`，不能只寫 `if (timer)`：Scripting 的 setTimeout 回傳 number，
      // 而**第一個**排程拿到的是 `0`——falsy，於是那一個永遠取消不掉（實測見 dev/probe-emitter.ts）。
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        fire()
      }, options.debounceMs)
    },
    cancelPending() {
      if (timer === null) return
      clearTimeout(timer)
      timer = null
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}
