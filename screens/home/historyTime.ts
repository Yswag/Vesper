// 閱讀紀錄的時間戳 → 顯示字。
//
// 為什麼自己一支：① 相對時間的規則票 07 已經有一支（`screens/shared/commentTime.ts`），
// 書架不再刻第二套——這裡只做「書架記的是毫秒時間戳、那一支吃的是源給的字串」這個形狀
// 轉換。② 探針因此不必把整個書架畫面拉進來，就能在三種語言下驗這一條。
//
// 註：書架自己一個中文字面值都沒有（`probe-i18n` ③ 掃得到），所以「又刻一套相對時間」
// （`剛剛`／`分鐘前`）或再建一顆 `Intl` 格式器都會在探針上現形。

import { formatCommentTime } from "../shared/commentTime"

/**
 * `timestamp` 是毫秒（`Progress.updatedAt`）。
 *
 * 解析不出來的值回空字串：一列壞掉不該把整頁拖下去（`new Date(NaN).toISOString()` 會丟
 * `RangeError`），而空字串在呼叫端就是「這一段沒有」。
 */
export function formatHistoryTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return ""
  return formatCommentTime(new Date(timestamp).toISOString())
}
