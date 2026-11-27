import { formatCommentTime } from "../shared/commentTime"

export function formatHistoryTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return ""
  return formatCommentTime(new Date(timestamp).toISOString())
}
