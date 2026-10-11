// 文字角色。同一種角色只有一個寫法 —— 原本 caption2+tertiaryLabel 與 caption+secondaryLabel
// 在十幾個地方各寫一次，看不出差別，卻又每個地方都不太一樣。
//
// 兩個角色：
//   Footnote = 卡下、清單尾、頁尾的註解（最輕）
//   Caption  = 卡片副標、狀態行（比 Footnote 明顯）

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
