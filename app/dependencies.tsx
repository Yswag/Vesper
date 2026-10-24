import { Button, ProgressView, Text, VStack } from "scripting"
import { t } from "../i18n"

declare const require: {
  (id: string): any
  resolve?: (id: string) => string
}
declare const Shell: { run(cmd: string, options?: any): Promise<any> }

/** 源的解析與加密都得靠它們。 */
export const CORE_DEPENDENCIES = ["cheerio", "crypto-js"]

export interface DependencyStatus {
  name: string
  installed: boolean
}

let verified = false

/**
 * 檢查套件是否已在設備 store 中就緒。
 *
 * ⚠️ 效能優化（require.resolve 定位檢測）：
 * 不使用 `require("cheerio")` 去執行或解析模組代碼，而是使用 `require.resolve()`！
 * `require.resolve` 只做檔案路徑尋找（Stat / Path Resolution），零代碼執行、耗時不到 1ms；
 * 若檔案不存在會拋錯進入 catch。
 * 這樣既完全消除了 200~500ms 的冷啟動 JS 編譯卡頓，又能在使用者手動刪除套件時準確捕捉並自動安裝！
 */
export function areDependenciesInstalled(): boolean {
  if (verified) return true
  if (CORE_DEPENDENCIES.every(canResolve)) {
    verified = true
    return true
  }
  return false
}

/**
 * 單一套件的狀態。載入是同步的，所以逐項跑（讓畫面在兩者之間有機會重繪）。
 */
export function checkDependency(name: string, deep = false): DependencyStatus {
  return { name, installed: deep ? canLoad(name) : canResolve(name) }
}

/**
 * 逐套件的狀態。`deep` ＝真的 `require` 一次；只找路徑（`require.resolve`）看不出半殘的
 * node_modules（檔案在、子依賴缺）。
 */
export function checkDependencies(deep = false): DependencyStatus[] {
  return CORE_DEPENDENCIES.map(name => checkDependency(name, deep))
}

function canResolve(id: string): boolean {
  try {
    if (typeof require.resolve === "function") require.resolve(id)
    else require(id)
    return true
  } catch {
    return false
  }
}

function canLoad(id: string): boolean {
  try {
    require(id)
    return true
  } catch {
    return false
  }
}

/** 準備中畫面的 UI 組件。 */
export function PreparingView() {
  return (
    <VStack alignment="center" spacing={16} padding={32} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <ProgressView />
      <Text font="headline" fontWeight="bold">
        {t("common.preparingEnv")}
      </Text>
      <Text font="subheadline" foregroundStyle="secondaryLabel" multilineTextAlignment="center">
        {t("common.installingCoreDeps")}
      </Text>
    </VStack>
  )
}

/**
 * 安裝失敗的畫面。不進主畫面：沒有依賴的話每個源都會爆，而重試請求救不了。
 */
export function InstallFailedView({ onRetry }: { onRetry: () => void }) {
  return (
    <VStack alignment="center" spacing={16} padding={32} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <Text font="headline" fontWeight="bold" multilineTextAlignment="center">
        {t("common.depsInstallFailed")}
      </Text>
      <Button
        title={t("common.depsRetryInstall")}
        systemImage="arrow.clockwise"
        action={onRetry}
        buttonStyle="borderedProminent"
      />
    </VStack>
  )
}

/** 確保安裝完成。回傳是否真的載得起來（呼叫端要看這個值）。 */
export async function installMissingDependencies(): Promise<boolean> {
  try {
    await Shell.run("npm install cheerio@^1.2.0 crypto-js@^4.2.0")
  } catch (error) {
    console.error("Failed to install dependencies:", error)
    return false
  }
  verified = checkDependencies(true).every(dep => dep.installed)
  return verified
}

