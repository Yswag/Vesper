// 搜尋篩選 sheet 的內容：單一源的 `search.optionList`。
//
// 每列照 `type` 畫不同的控制項：select / multi-select 用 settings 那種勾選列，
// dropdown 用系統的 menu picker（ccc 的出版社有 55 項，chip 排不下）。
// 草稿狀態放在 SearchScreen，這裡只收 value 與 onChanged —— 「取消」才會是真的丟掉。

import { Divider, ScrollView, VStack } from "scripting"

import { CardGroup } from "../../design/layout"
import { OptionRow, SelectRow, rowSeparatorInset } from "../../design/rows"
import { pageInsets, pageSpacing } from "../../design/tokens"
import { PageBackground, useTint } from "../../app/theme"
import { t } from "../../i18n"
import type { SearchOptionRow, SearchOptionValue } from "../../sources/searchOptions"

/** dropdown 的「不指定」用的哨兵（源的選項值不會長這樣）。 */
const NONE = "\u0000none"

function isChecked(row: SearchOptionRow, value: SearchOptionValue | undefined, option: string): boolean {
  if (row.type === "multi-select") return Array.isArray(value) && value.includes(option)
  return value === option
}

export function SearchFilterSheet({
  rows,
  values,
  onChanged,
}: {
  rows: SearchOptionRow[]
  values: SearchOptionValue[]
  /** 第 index 列改成新值。 */
  onChanged: (index: number, value: SearchOptionValue) => void
}) {
  const tint = useTint()
  // sheet 本身是白底：不鋪頁面底色的話，淺色下半透明白卡片看不到邊。
  return (
    <ScrollView scrollContentBackground="hidden" background={<PageBackground />}>
      <VStack alignment="leading" spacing={pageSpacing} padding={pageInsets}>
        {rows.map((row, index) => {
          const value = values[index] ?? row.initial

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
      </VStack>
    </ScrollView>
  )
}
