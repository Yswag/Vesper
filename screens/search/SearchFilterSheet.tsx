import { Button, Divider, HStack, Image, Navigation, ScrollView, Toolbar, ToolbarItem, VStack, useState } from "scripting"

import { Chip } from "../../design/chip"
import { CardGroup } from "../../design/layout"
import { OptionRow, SelectRow, rowSeparatorInset } from "../../design/rows"
import { pageInsets, pageSpacing } from "../../design/tokens"
import { PageBackground, useTint } from "../../app/theme"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import type { SearchOptionRow, SearchOptionValue } from "../../sources/searchOptions"

const NONE = "\u0000none"

function isChecked(row: SearchOptionRow, value: SearchOptionValue | undefined, option: string): boolean {
  if (row.type === "multi-select") return Array.isArray(value) && value.includes(option)
  return value === option
}

export function SearchFilterSheet({
  rows,
  values,
  defaults,
  onApply,
}: {
  rows: SearchOptionRow[]
  values: SearchOptionValue[]
  defaults: SearchOptionValue[]
  onApply: (values: SearchOptionValue[]) => void
}) {
  const tint = useTint()
  const dismiss = Navigation.useDismiss()
  const [draft, setDraft] = useState<SearchOptionValue[]>(() => [...values])
  useSubscription(subscribeLocale)

  function onChanged(index: number, value: SearchOptionValue) {
    setDraft(previous => previous.map((item, at) => (at === index ? value : item)))
  }

  return (
    <VStack
      spacing={0}
      navigationTitle={t("search.filterTitle")}
      navigationBarTitleDisplayMode="inline"
      toolbar={
        <Toolbar>
          <ToolbarItem placement="topBarLeading">
            <Button buttonStyle="plain" action={dismiss} accessibilityLabel={t("common.cancel")}>
              <Image systemName="xmark" font="body" fontWeight="medium" foregroundStyle="secondaryLabel" />
            </Button>
          </ToolbarItem>
          <ToolbarItem placement="topBarTrailing">
            <Button
              buttonStyle="plain"
              action={() => {
                onApply(draft)
                dismiss()
              }}
              accessibilityLabel={t("search.filterApply")}
            >
              <Image systemName="checkmark" font="body" fontWeight="semibold" foregroundStyle="secondaryLabel" />
            </Button>
          </ToolbarItem>
        </Toolbar>
      }
    >
      {}
      <ScrollView scrollContentBackground="hidden" background={<PageBackground />}>
        <VStack alignment="leading" spacing={pageSpacing} padding={pageInsets}>
          {rows.map((row, index) => {
            const value = draft[index] ?? row.initial
  
            return (
              <CardGroup
                key={`filter:${index}`}
                title={row.label ?? t("search.filterFallback", { n: index + 1 })}
                footnote={row.type === "multi-select" ? t("search.filterMulti") : undefined}
              >
                {row.type === "dropdown" ? (
                  <SelectRow
                    icon="chevron.up.chevron.down"
                    iconColor={tint.tint}
                    title={row.label ?? t("search.filterSelect")}
                    value={typeof value === "string" ? value : NONE}
                    options={[
                      { value: NONE, text: t("search.filterNone") },
                      ...row.options.map(option => ({ value: option.value, text: option.label })),
                    ]}
                    onChanged={next => onChanged(index, next === NONE ? null : next)}
                  />
                ) : (
                  row.options.map((option, optionIndex) => (
                    <VStack key={`filter:${index}:${optionIndex}`} spacing={0}>
                      {optionIndex > 0 ? <Divider padding={{ leading: rowSeparatorInset }} /> : null}
                      <OptionRow
                        title={option.label}
                        checked={isChecked(row, value, option.value)}
                        onTap={() => {
                          if (row.type === "multi-select") {
                            const current = Array.isArray(value) ? value : []
                            onChanged(
                              index,
                              current.includes(option.value)
                                ? current.filter(item => item !== option.value)
                                : [...current, option.value]
                            )
                            return
                          }
                          onChanged(index, option.value)
                        }}
                      />
                    </VStack>
                  ))
                )}
              </CardGroup>
            )
          })}
          <HStack alignment="center" frame={{ maxWidth: "infinity" }} padding={{ top: 8, bottom: 20 }}>
            <Chip
              text={t("search.filterReset")}
              icon="arrow.counterclockwise"
              onTap={() => setDraft([...defaults])}
            />
          </HStack>
        </VStack>
      </ScrollView>
    </VStack>
  )
}
