// 一次源呼叫的取消範圍。signal 只能用「環境態 + 同步快照」進沙箱：源的 globals 是每個源
// 載入時建一次（engine/loader.ts → createGlobals），`Network` 只閉包住 sourceKey；源檔不能改
// （相容性原則），而 engine 又不能 import sources（DESIGN.md 唯一的硬規則）。
//
// 所以：呼叫端用 withSourceScope 開一段範圍，沙箱的 `Network.*` 在**被呼叫的當下**同步讀走它。

import type { AbortSignal } from "scripting"

/**
 * 每個源一份疊層，不是單槽：同一個源會並行多個呼叫（排行＋詳情、閱讀器＋下載），
 * 疊層讓「當下最內層那個呼叫」拿到自己的 signal，而且外層呼叫在內層結束後仍拿得到自己的。
 */
const stacks = new Map<string, AbortSignal[]>()

/**
 * 現在這條鏈路上該源的 signal。**只給沙箱的 `Network.*` 在呼叫當下同步讀**——
 * 這個 runtime 沒有 async context，晚一步讀就會被別的並行呼叫蓋掉。
 */
export function currentSourceSignal(sourceKey: string): AbortSignal | undefined {
  const stack = stacks.get(sourceKey)
  return stack && stack.length > 0 ? stack[stack.length - 1] : undefined
}

/**
 * 在 `sourceKey` 的取消範圍裡跑 `fn`。沒給 signal 就完全等於現在的行為（不進疊層）。
 *
 * 已知限制（誠實寫在這裡，不要假裝萬能）：
 * - 源如果在第一次 `Network` 呼叫之前先 `await` 別的東西，等到它真的呼叫時，疊層頂端可能
 *   已經是**同一源另一個並行呼叫**的 signal → 它會拿到別人的 signal。2026-10-08 探針實測：
 *   取消 A 對 A 自己的請求無效，取消 B 反而把 A 的請求一起取消（`dev/probe-cancel.ts`）。
 * - 只能「不再等」，不能真的殺掉已經在跑的源程式碼（例如每源共用的 `init()`）。
 */
export async function withSourceScope<T>(
  sourceKey: string,
  signal: AbortSignal | undefined,
  fn: () => T | Promise<T>
): Promise<T> {
  if (!signal) return await fn()
  const stack = stacks.get(sourceKey) ?? []
  if (stack.length === 0) stacks.set(sourceKey, stack)
  stack.push(signal)
  try {
    return await fn()
  } finally {
    stack.pop()
    if (stack.length === 0) stacks.delete(sourceKey)
  }
}
