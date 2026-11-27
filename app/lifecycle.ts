import { Script } from "scripting"

type Dismiss = (result?: any) => void

let dismissFn: Dismiss | null = null
const beforeExit: Array<() => void | Promise<void>> = []

type ExitGate = () => "proceed" | "handled" | undefined | Promise<"proceed" | "handled" | undefined>

const exitGates: ExitGate[] = []

export function registerExitGate(gate: ExitGate): () => void {
  exitGates.push(gate)
  return () => {
    const index = exitGates.indexOf(gate)
    if (index >= 0) exitGates.splice(index, 1)
  }
}

export async function runExitGates(): Promise<boolean> {
  for (const gate of [...exitGates]) {
    try {
      if ((await gate()) === "handled") return true
    } catch {
    }
  }
  return false
}

export function registerDismiss(fn: Dismiss) {
  dismissFn = fn
}

export function onBeforeExit(task: () => void | Promise<void>) {
  beforeExit.push(task)
}

export async function exitApp() {
  for (const task of beforeExit) {
    try {
      await task()
    } catch {
    }
  }
  if (await runExitGates()) return
  if (dismissFn) {
    dismissFn()
    setTimeout(() => Script.exit(), 400)
    return
  }
  Script.exit()
}
