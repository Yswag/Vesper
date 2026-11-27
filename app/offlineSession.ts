import { Script } from "scripting"
import { t } from "../i18n"
import { hasPro } from "../engine/pro"

import { isActive, listDownloads, subscribeDownloads } from "../sources/downloads"
import { getBackgroundDownloads, subscribeBackgroundDownloads } from "../sources/downloadSettings"
import { registerExitGate } from "./lifecycle"

export interface KeepAliveHandle {
  keepAlive(): Promise<boolean>
  stopKeepAlive(): Promise<void>
}

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
  confirmContinueDownloading(): Promise<boolean>
  keeper: KeepAliveHandle
  script: MinimizeScript
}

export type ExitOutcome = "proceed" | "handled"

export interface OfflineSession {
  reconcile(): Promise<void>
  requestExit(): Promise<ExitOutcome>
  userReturned(): void
  dispose(): Promise<void>
}

export function createOfflineSession(deps: OfflineSessionDeps): OfflineSession {
  let held = false
  let refusedRound = false
  let handoff = false
  let disposed = false
  let pendingAsk: Promise<boolean> | null = null

  const unwatchDownloads = deps.onDownloadsChanged(() => void reconcile())
  const unwatchSetting = deps.onBackgroundSettingChanged(() => void reconcile())

  function wants(): boolean {
    return deps.hasActiveDownloads() && deps.backgroundEnabled() && deps.hasFullAccess()
  }

  async function acquire(): Promise<void> {
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
    const minimized = deps.script.supportsMinimization() ? await deps.script.minimize() : false
    if (minimized) {
      handoff = true
      return "handled"
    }
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


export interface OfflineSessionRuntime {
  keeper: KeepAliveHandle
  script: MinimizeScript
  hasFullAccess(): boolean
  confirmContinueDownloading(): Promise<boolean>
}

let teardown: (() => void) | null = null

export function realOfflineRuntime(): OfflineSessionRuntime {
  return {
    keeper: BackgroundKeeper,
    script: {
      supportsMinimization: () => Script.supportsMinimization(),
      isMinimized: () => Script.isMinimized(),
      minimize: () => Script.minimize(),
      exit: () => Script.exit(),
    },
    hasFullAccess: hasPro,
    confirmContinueDownloading: realConfirmContinueDownloading,
  }
}

export async function realConfirmContinueDownloading(): Promise<boolean> {
  const ok = await Dialog.confirm({
    title: t("common.exitBlockedTitle"),
    message: t("common.exitBlockedMessage"),
    confirmLabel: t("common.exitContinue"),
    cancelLabel: t("common.exitAnyway"),
  })
  return ok
}

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
