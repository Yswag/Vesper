// 離線下載背景工作與退出攔截管理。
// 下載中透過 BackgroundKeeper 申請背景執行時間；使用者退出時優先最小化，
// 無法最小化時提示確認，確保背景下載任務完整性。

import { Script } from "scripting"
import { t } from "../i18n"

import { isActive, listDownloads, subscribeDownloads } from "../sources/downloads"
import { getBackgroundDownloads, subscribeBackgroundDownloads } from "../sources/downloadSettings"
import { registerExitGate } from "./lifecycle"

/** `BackgroundKeeper` 的最小介面。 */
export interface KeepAliveHandle {
  keepAlive(): Promise<boolean>
  stopKeepAlive(): Promise<void>
}

/** `Script` 的 minimize 家族最小介面。 */
export interface MinimizeScript {
  supportsMinimization(): boolean
  isMinimized(): boolean
  minimize(): Promise<boolean>
  exit(): void
}

export interface OfflineSessionDeps {
  hasActiveDownloads(): boolean
  onDownloadsChanged(fn: () => void): () => void
  backgroundEnabled(): boolean
  onBackgroundSettingChanged(fn: () => void): () => void
  hasFullAccess(): boolean
  /** 縮不下去（多視窗模式／環境不支援）時問使用者：回 true＝讓下載繼續、不退出。 */
  confirmContinueDownloading(): Promise<boolean>
  keeper: KeepAliveHandle
  script: MinimizeScript
}

export type ExitOutcome = "proceed" | "handled"

export interface OfflineSession {
  /** 重新評估「該不該持有背景時間、該不該自動結束」。什麼都沒變時不會重複要求。 */
  reconcile(): Promise<void>
  /** 退出攔截：接手處理（縮小或確認繼續下載）回傳 "handled"，放行退出回傳 "proceed"。 */
  requestExit(): Promise<ExitOutcome>
  /** 使用者自己回到 App：取消待辦的自動結束。 */
  userReturned(): void
  dispose(): Promise<void>
}

export function createOfflineSession(deps: OfflineSessionDeps): OfflineSession {
  let held = false
  let refusedRound = false
  let handoff = false
  let disposed = false
  // 同一次退出只問一次：答案還沒回來前又有人問，就共用同一個提問（不疊第二個對話框）。
  let pendingAsk: Promise<boolean> | null = null

  const unwatchDownloads = deps.onDownloadsChanged(() => void reconcile())
  const unwatchSetting = deps.onBackgroundSettingChanged(() => void reconcile())

  function wants(): boolean {
    return deps.hasActiveDownloads() && deps.backgroundEnabled() && deps.hasFullAccess()
  }

  async function acquire(): Promise<void> {
    // 同一輪裡被系統拒絕過就別再問（會變成一直敲系統）。
    if (held || refusedRound || !wants()) return
    const granted = await deps.keeper.keepAlive()
    if (granted) held = true
    else refusedRound = true
  }

  async function release(): Promise<void> {
    if (!held) return
    held = false
    await deps.keeper.stopKeepAlive()
  }

  async function reconcile(): Promise<void> {
    if (disposed) return
    if (deps.hasActiveDownloads()) {
      await acquire()
      return
    }
    refusedRound = false
    await release()
    // 縮小中而且沒事了才自己結束；使用者回來過就不算（handoff 會被 userReturned 清掉）。
    if (handoff && deps.script.isMinimized()) {
      handoff = false
      deps.script.exit()
    }
  }

  function askContinueDownloading(): Promise<boolean> {
    if (!pendingAsk) {
      const ask = deps.confirmContinueDownloading()
      pendingAsk = ask
      const clear = () => {
        if (pendingAsk === ask) pendingAsk = null
      }
      void ask.then(clear, clear)
    }
    return pendingAsk
  }

  async function requestExit(): Promise<ExitOutcome> {
    if (!deps.hasActiveDownloads()) return "proceed"
    // 環境不支援最小化就不必真的呼叫（文件說會被忽略），直接當成縮不下去。
    const minimized = deps.script.supportsMinimization() ? await deps.script.minimize() : false
    if (minimized) {
      handoff = true
      return "handled"
    }
    // 無法最小化時彈窗確認：使用者若選擇繼續下載則接手攔截，否則放行退出
    const keepDownloading = await askContinueDownloading()
    return keepDownloading ? "handled" : "proceed"
  }

  function userReturned(): void {
    handoff = false
  }

  async function dispose(): Promise<void> {
    disposed = true
    unwatchDownloads()
    unwatchSetting()
    await release()
  }

  return { reconcile, requestExit, userReturned, dispose }
}

// ------------------------------------------------------------------ 接到真的 App

export interface OfflineSessionRuntime {
  keeper: KeepAliveHandle
  script: MinimizeScript
  hasFullAccess(): boolean
  confirmContinueDownloading(): Promise<boolean>
}

let teardown: (() => void) | null = null

/** 真的 App 用的注入：`BackgroundKeeper` 只在大 app 裡有，所以這裡才碰它。 */
export function realOfflineRuntime(): OfflineSessionRuntime {
  return {
    keeper: BackgroundKeeper,
    script: {
      supportsMinimization: () => Script.supportsMinimization(),
      isMinimized: () => Script.isMinimized(),
      minimize: () => Script.minimize(),
      exit: () => Script.exit(),
    },
    hasFullAccess: () => Script.hasFullAccess(),
    confirmContinueDownloading: realConfirmContinueDownloading,
  }
}

/** 彈出原生對話框確認是否在退出時保持下載。 */
export async function realConfirmContinueDownloading(): Promise<boolean> {
  const ok = await Dialog.confirm({
    title: t("common.exitBlockedTitle"),
    message: t("common.exitBlockedMessage"),
    confirmLabel: t("common.exitContinue"),
    cancelLabel: t("common.exitAnyway"),
  })
  return ok
}

/**
 * 把離線 session 接到真的下載管理員、設定與退出流程（入口呼叫一次）。
 * 重複呼叫會先把上一個拆掉。
 */
export function installOfflineSession(runtime: OfflineSessionRuntime = realOfflineRuntime()): void {
  uninstallOfflineSession()

  const session = createOfflineSession({
    hasActiveDownloads: () =>
      listDownloads().some(record => isActive(record.state)),
    onDownloadsChanged: subscribeDownloads,
    backgroundEnabled: getBackgroundDownloads,
    onBackgroundSettingChanged: subscribeBackgroundDownloads,
    hasFullAccess: runtime.hasFullAccess,
    confirmContinueDownloading: runtime.confirmContinueDownloading,
    keeper: runtime.keeper,
    script: runtime.script,
  })

  const offGate = registerExitGate(() => session.requestExit())
  const offResume = Script.onResume(() => session.userReturned())

  teardown = () => {
    offGate()
    offResume()
    void session.dispose()
  }
}

export function uninstallOfflineSession(): void {
  if (!teardown) return
  const stop = teardown
  teardown = null
  stop()
}
