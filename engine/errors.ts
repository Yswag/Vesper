import { t } from "../i18n"

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
