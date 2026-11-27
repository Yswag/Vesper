import { Script } from "scripting"

import { t } from "../i18n"

export type ProFeature = "aidoku" | "mihon" | "upscale"

export function hasPro(): boolean {
  return Script.hasFullAccess()
}

export class ProRequiredError extends Error {
  readonly feature: ProFeature

  constructor(feature: ProFeature) {
    super(
      feature === "aidoku"
        ? t("sources.aidoku.requiresPro")
        : feature === "mihon"
          ? t("sources.mihon.requiresPro")
          : t("reader.upscaleRequiresPro")
    )
    this.name = "ProRequiredError"
    this.feature = feature
  }
}

export function requirePro(feature: ProFeature, allowed: boolean = hasPro()): void {
  if (!allowed) throw new ProRequiredError(feature)
}
