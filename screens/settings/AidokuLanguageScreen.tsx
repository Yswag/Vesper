// Aidoku 源的語言選擇（manifest 的 `languages`）：照 Aidoku 的來源設定。
// 只有一種語言時整個入口不出現；`languageSelectType: "single"` 只能選一個。
//
// 值寫在 `installed.json` 的 `settings.languages`（陣列），源用 `defaults.get("languages")` 讀。

import { Divider, VStack, useEffect, useState } from "scripting"

import { languageName } from "../../app/languageNames"
import { useSubscription } from "../../app/useSubscription"
import { CardGroup, PageScroll } from "../../design/layout"
import { OptionRow, rowSeparatorInset } from "../../design/rows"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { findSource, reloadRegistry, updateAidokuSetting, type InstalledSource } from "../../sources/registry"

export function AidokuLanguageScreen({ sourceKey }: { sourceKey: string }) {
  const [source, setSource] = useState<InstalledSource | undefined>(undefined)
  // 語言名稱照介面語言顯示；這個頁面是獨立的 render 根。
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
      // 順序照 manifest，不照點擊順序：源比對陣列時比較穩。
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
