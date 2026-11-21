// 導覽列左側的「離開」按鈕；首頁模式下不畫（那裡沒有東西好離開）。
// 實際退出走 `app/lifecycle` 的 `exitApp`（會先過下載中的關卡）。

import { Button, Image, Script } from "scripting"

import { exitApp } from "../app/lifecycle"
import { t } from "../i18n"

export function ExitToolbar() {
  if (Script.env === "home_screen") {
    return null
  }

  return (
    <Button
      action={() => {
        void exitApp()
      }}
      buttonStyle="plain"
      accessibilityLabel={t("common.exitLabel")}
    >
      <Image
        systemName="xmark"
        font="subheadline"
        fontWeight="semibold"
        foregroundStyle="label"
      />
    </Button>
  )
}
