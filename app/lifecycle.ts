// 退出路徑的唯一出口。
//
// 全螢幕 present 沒有下滑關閉，所以必須給使用者一個明確的出口。作法是把
// 被 present 的那層的 dismiss 註冊進來，退出時先 dismiss（讓 index.tsx 的
// await Navigation.present 兌現、再 Script.exit），而不是直接 Script.exit：
// 直接 exit 會跳過關閉動畫，而且在 TabView 的事件回呼裡呼叫還會被吞掉。

import { Script } from "scripting"

type Dismiss = (result?: any) => void

let dismissFn: Dismiss | null = null
const beforeExit: Array<() => void | Promise<void>> = []

/** 退出關卡：回 "handled" 表示有人接手了（例如下載中改成縮小），不要真的退出。 */
type ExitGate = () => "proceed" | "handled" | undefined | Promise<"proceed" | "handled" | undefined>

const exitGates: ExitGate[] = []

/** 註冊退出關卡，回傳取消註冊的函式。 */
export function registerExitGate(gate: ExitGate): () => void {
  exitGates.push(gate)
  return () => {
    const index = exitGates.indexOf(gate)
    if (index >= 0) exitGates.splice(index, 1)
  }
}

/** 問過所有關卡；有人接手就回 `true`（＝不要真的退出）。關卡壞掉不該擋住退出。 */
export async function runExitGates(): Promise<boolean> {
  for (const gate of [...exitGates]) {
    try {
      if ((await gate()) === "handled") return true
    } catch {
      // 略過壞掉的關卡
    }
  }
  return false
}

export function registerDismiss(fn: Dismiss) {
  dismissFn = fn
}

/** 註冊退出前要跑的工作（例如把待寫入的書架/進度落盤）。 */
export function onBeforeExit(task: () => void | Promise<void>) {
  beforeExit.push(task)
}

export async function exitApp() {
  for (const task of beforeExit) {
    try {
      await task()
    } catch {
      // 落盤失敗不該擋住退出
    }
  }
  // 關卡先問（例如下載中：改成縮小而不是結束）。
  if (await runExitGates()) return
  if (dismissFn) {
    dismissFn()
    // 保險：正常情況下 index.tsx 的 await Navigation.present 會兌現並 Script.exit()；
    // 萬一沒有（例如 dismiss 在某個事件回呼裡失效），這裡兜底把腳本結束掉。
    setTimeout(() => Script.exit(), 400)
    return
  }
  Script.exit()
}
