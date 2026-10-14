// 文字角色規範：統一 Footnote（最輕次要說明）與 Caption（副標題/狀態行）的字級與語意色。

import { Text } from "scripting"

/** 最輕的註解文字。 */
export function Footnote({ children }: { children: string }) {
  return (
    <Text font="caption2" foregroundStyle="tertiaryLabel">
      {children}
    </Text>
  )
}

/** 次要說明：卡片副標、狀態行。 */
export function Caption({ children }: { children: string }) {
  return (
    <Text font="caption" foregroundStyle="secondaryLabel">
      {children}
    </Text>
  )
}
