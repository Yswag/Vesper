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
