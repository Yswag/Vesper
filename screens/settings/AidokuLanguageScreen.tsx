import { Divider, VStack, useEffect, useState } from "scripting"

import { languageName } from "../../app/languageNames"
import { useSubscription } from "../../app/useSubscription"
import { CardGroup, PageScroll } from "../../design/layout"
import { OptionRow, rowSeparatorInset } from "../../design/rows"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { findSource, reloadRegistry, updateAidokuSetting, type InstalledSource } from "../../sources/registry"

export function AidokuLanguageScreen({ sourceKey }: { sourceKey: string }) {
  const [source, setSource] = useState<InstalledSource | undefined>(undefined)
  useSubscription(subscribeLocale)

  useEffect(() => {
    reloadRegistry()
    setSource(findSource(sourceKey))
  }, [sourceKey])

  const spec = source?.settingsSpec
  const languages = spec?.languages ?? []
  const overrides = source?.stored.settings ?? {}
  const stored = Array.isArray(overrides.languages) ? overrides.languages.map(value => String(value ?? "")) : null
  const selected = stored ?? spec?.defaultLanguages ?? []

  function toggle(code: string) {
    const has = selected.includes(code)
    if (spec?.singleLanguage) {
      if (has) return
      updateAidokuSetting(sourceKey, "languages", [code])
    } else {
      const next = has ? selected.filter(value => value !== code) : [...selected, code]
      updateAidokuSetting(
        sourceKey,
        "languages",
        languages.filter(value => next.includes(value))
      )
    }
    setSource(findSource(sourceKey))
  }

  return (
    <PageScroll title={t("settings.aidokuSettings.language")}>
      <CardGroup title={t("settings.aidokuSettings.languageGroup")} footnote={t("settings.aidokuSettings.languageFootnote")}>
        {languages.map((code, index) => (
          <VStack key={code} spacing={0}>
            {index > 0 ? <Divider padding={{ leading: rowSeparatorInset }} /> : null}
            <OptionRow title={languageName(code)} checked={selected.includes(code)} onTap={() => toggle(code)} />
          </VStack>
        ))}
      </CardGroup>
    </PageScroll>
  )
}
