import { ProgressView, Text, VStack } from "scripting"
import { neutral } from "../design/tokens"
import { t } from "../i18n"

declare const require: {
  (id: string): any
  resolve?: (id: string) => string
}
declare const Shell: { run(cmd: string, options?: any): Promise<any> }

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
  try {
    if (typeof require.resolve === "function") {
      require.resolve("cheerio")
      require.resolve("crypto-js")
    } else {
      require("cheerio")
      require("crypto-js")
    }
    verified = true
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
      <Text font="subheadline" foregroundStyle={neutral.secondary} multilineTextAlignment="center">
        {t("common.installingCoreDeps")}
      </Text>
    </VStack>
  )
}

/**
 * 確保依賴完整安裝。
 */
export async function installMissingDependencies(): Promise<boolean> {
  try {
    await Shell.run("npm install cheerio@^1.2.0 crypto-js@^4.2.0")
    verified = true
    return true
  } catch (error) {
    console.error("Failed to install dependencies:", error)
    return false
  }
}

