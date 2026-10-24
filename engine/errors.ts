// 錯誤訊息人話化：源與網路丟上來的技術字串，只在這一支翻譯成使用者看得到的一句話。
// 原始字串照樣留在 log／狀態裡，畫面只負責顯示。

import { t } from "../i18n"

/** axios／原生錯誤字串 → 使用者看得懂的一句話；不認得就原樣回傳。 */
export function describeError(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error ?? "")).trim()
  if (!raw) return t("common.problem.unknown")

  const status = raw.match(/(?:status code|HTTP)\s*(\d{3})/i)?.[1]
  if (status) {
    const code = Number(status)
    if (code >= 500) return t("common.problem.server", { status: code })
    if (code >= 400) return t("common.problem.request", { status: code })
  }

  if (/timeout|timed out|ETIMEDOUT/i.test(raw)) return t("common.problem.timeout")
  if (/network|offline|internet connection|ENOTFOUND|ECONNREFUSED|NSURLErrorDomain|-1009/i.test(raw)) {
    return t("common.problem.network")
  }

  return raw
}
