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
