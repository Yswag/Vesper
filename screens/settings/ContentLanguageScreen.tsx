import { Divider, HStack, Image, TextField, VStack, useState } from "scripting"

import {
  compareContentLanguage,
  contentLanguageName,
  contentLanguageOptions,
  getContentLanguages,
  repositoryLanguages,
  subscribeContentLanguages,
  toggleContentLanguage,
} from "../../app/contentLanguages"
import { useSubscription } from "../../app/useSubscription"
import { Card, CardGroup, PageScroll } from "../../design/layout"
import { OptionRow, rowSeparatorInset } from "../../design/rows"
import { rowPadding } from "../../design/tokens"
import { subscribe as subscribeLocale, t } from "../../i18n"

export function ContentLanguageScreen({
  value,
  onChanged,
  candidates,
}: {
  value?: string[]
  onChanged?: (codes: string[]) => void
  candidates?: string[]
} = {}) {
  useSubscription(subscribeLocale, subscribeContentLanguages)
  const [query, setQuery] = useState("")
  const selected = value ?? getContentLanguages()
  const pool = contentLanguageOptions(candidates ?? repositoryLanguages())
  const nameCounts = new Map<string, number>()
  for (const code of pool) {
    const name = contentLanguageName(code)
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
  }
  const needle = query.trim().toLowerCase()
  const options = [...pool]
    .filter(code => {
      if (needle.length === 0) return true
      return contentLanguageName(code).toLowerCase().includes(needle) || code.toLowerCase().includes(needle)
    })
    .sort((a, b) => {
      const rankA = selected.includes(a) ? 0 : 1
      const rankB = selected.includes(b) ? 0 : 1
      if (rankA !== rankB) return rankA - rankB
      return compareContentLanguage(a, b, selected)
    })

  function toggle(code: string) {
    const has = selected.includes(code)
    if (has && selected.length === 1) return
    const next = has ? selected.filter(value => value !== code) : [...selected, code]
    if (value !== undefined) onChanged?.(next)
    else toggleContentLanguage(code)
  }

  return (
    <PageScroll title={t("settings.contentLanguage.title")}>
      {pool.length > 10 ? (
        <Card>
          <HStack spacing={10} padding={rowPadding} alignment="center">
            <Image systemName="magnifyingglass" font="footnote" foregroundStyle="tertiaryLabel" />
            <TextField
              title=""
              prompt={t("settings.contentLanguage.search")}
              value={query}
              textFieldStyle="plain"
              onChanged={setQuery}
            />
          </HStack>
        </Card>
      ) : null}
      <CardGroup title={t("settings.contentLanguage.group")}>
        {options.map((code, index) => (
          <VStack key={code} spacing={0}>
            {index > 0 ? <Divider padding={{ leading: rowSeparatorInset }} /> : null}
            <OptionRow
              title={contentLanguageName(code)}
              subtitle={(nameCounts.get(contentLanguageName(code)) ?? 0) > 1 ? code : undefined}
              checked={selected.includes(code)}
              onTap={() => toggle(code)}
            />
          </VStack>
        ))}
      </CardGroup>
    </PageScroll>
  )
}
