// 源的載入指示的浮動視圖（見 app/loadingState.ts）。
//
// 一張小卡片，浮在 App 內容上方（掛在 App 的 TabView overlay），不是 modal——
// 所以不會遮住整個畫面，也不需要處理「present 還沒完成就被取消」那類競態。

import { Button, HStack, ProgressView, Text, VStack, useEffect, useState } from "scripting"

import { GlassSurface } from "../design/GlassSurface"

import { activeLoadings, cancelLoadingFromUser, subscribeLoading, type LoadingEntry } from "./loadingState"
import { t } from "../i18n"

export function LoadingHUD() {
  const [stack, setStack] = useState<LoadingEntry[]>(activeLoadings())

  useEffect(() => {
    setStack(activeLoadings())
    return subscribeLoading(() => setStack(activeLoadings()))
  }, [])

  const top = stack[stack.length - 1]
  if (!top) return null

  return (
    <VStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" }}
      padding={{ top: 58 }}
      allowsHitTesting={false}
    >
      <GlassSurface
        variant="regular"
        shape={{ type: "capsule", style: "circular" }}
      >
        <HStack
          spacing={8}
          padding={{ horizontal: 16, vertical: 9 }}
          alignment="center"
          allowsHitTesting={true}
        >
          <ProgressView controlSize="small" />
          <Text font="footnote" fontWeight="semibold" foregroundStyle="label">
            {top.message || t("common.working")}
          </Text>
          {top.onCancel ? (
            <Button
              title={t("common.cancel")}
              buttonStyle="plain"
              font="caption"
              foregroundStyle="secondaryLabel"
              action={() => cancelLoadingFromUser(top.id)}
            />
          ) : null}
        </HStack>
      </GlassSurface>
    </VStack>
  )
}
