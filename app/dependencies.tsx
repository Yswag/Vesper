import { ProgressView, Text, VStack } from "scripting"
import { neutral } from "../design/tokens"

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
        正在準備閱讀器環境…
      </Text>
      <Text font="subheadline" foregroundStyle={neutral.secondary} multilineTextAlignment="center">
        初次啟動正在安裝必要核心依賴 (cheerio, crypto-js)，請稍候數秒…
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
    console.error("安裝依賴失敗:", error)
    return false
  }
}
