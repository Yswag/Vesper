// 封面投影：key／penumbra／ambient 三層（見 tokens 的三個 coverShadow*）。
// 引擎的 shadow 一次只有一層，所以疊三塊圓角矩形，各掛一層。
//
// 影子掛在背後同尺寸的不透明圓角矩形上，不掛在封面內容上：
// 掛在內容上每一幀都要照內容輪廓重算，網格捲動會明顯卡頓。
// 所以內容必須填滿整個 frame（fit 留白的圖會露出底板）。
// 底板用 surface 色：遠端圖還沒載入時會露出來，剛好就是載入中的底。

import { RoundedRectangle, ZStack } from "scripting"
import { coverShadowAmbient, coverShadowKey, coverShadowPenumbra, fill, radius, type StackChildren } from "./tokens"

export function CoverShadow({ children, cornerRadius = radius.md }: { children: StackChildren; cornerRadius?: number }) {
  return (
    <ZStack
      background={
        // 內縮 1pt：不然底板會從封面圓角的抗鋸齒邊透出一圈。
        <ZStack padding={1}>
          <RoundedRectangle cornerRadius={cornerRadius} fill={fill.surface} shadow={coverShadowAmbient} />
          <RoundedRectangle cornerRadius={cornerRadius} fill={fill.surface} shadow={coverShadowPenumbra} />
          <RoundedRectangle cornerRadius={cornerRadius} fill={fill.surface} shadow={coverShadowKey} />
        </ZStack>
      }
    >
      {children}
    </ZStack>
  )
}
