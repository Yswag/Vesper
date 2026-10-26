// Scripting Pro 能力判定：HttpServer 是 Pro 專屬功能，缺它時要讓使用者當場看見原因，而不是只留一則 log。
// 錯誤訊息本身就是畫面顯示的那句話；技術原文留在呼叫端。

import { Script } from "scripting"

import { t } from "../i18n"

export type ProFeature = "aidoku" | "upscale"

/** 有沒有 Scripting Pro。每次重問：升級後切回 App 要立刻生效，不能快取。 */
export function hasPro(): boolean {
  return Script.hasFullAccess()
}

/** 少了一項 Pro 能力；`message` 直接給使用者看。 */
export class ProRequiredError extends Error {
  readonly feature: ProFeature

  constructor(feature: ProFeature) {
    super(feature === "aidoku" ? t("sources.aidoku.requiresPro") : t("reader.upscaleRequiresPro"))
    this.name = "ProRequiredError"
    this.feature = feature
  }
}

/** 沒有 Pro 就丟 `ProRequiredError`。`allowed` 只給探針注入。 */
export function requirePro(feature: ProFeature, allowed: boolean = hasPro()): void {
  if (!allowed) throw new ProRequiredError(feature)
}
