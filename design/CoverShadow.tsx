// 封面投影：key／penumbra／ambient 三層（見 tokens 的三個 coverShadow*）。
// 引擎的 shadow 一次只有一層，傳陣列會整組被丟掉，所以一層包一層 ZStack。

import { ZStack } from "scripting"
import { coverShadowAmbient, coverShadowKey, coverShadowPenumbra, type StackChildren } from "./tokens"

export function CoverShadow({ children }: { children: StackChildren }) {
  return (
    <ZStack shadow={coverShadowAmbient}>
      <ZStack shadow={coverShadowPenumbra}>
        <ZStack shadow={coverShadowKey}>{children}</ZStack>
      </ZStack>
    </ZStack>
  )
}
