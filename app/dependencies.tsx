import { ProgressView, Text, VStack } from "scripting"
import { neutral } from "../design/tokens"
import { t } from "../i18n"

declare const require: (id: string) => any
declare const Shell: { run(cmd: string, options?: any): Promise<any> }

let verified = false

/** 檢查套件是否已在設備 store 中就緒。 */
export function areDependenciesInstalled(): boolean {
  if (verified) return true
  try {
    require("cheerio")
    require("crypto-js")
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
