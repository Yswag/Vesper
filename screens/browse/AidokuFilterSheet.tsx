// Aidoku 源的搜尋篩選 sheet：草稿留在這裡，按「套用」才交出去。
//
// 五種列：text / select / sort / check / multi。
// multi 在源允許時是三態（不選 → 包含 → 排除），沒允許就只有包含。

import {
  Button,
  Divider,
  HStack,
  Image,
  Navigation,
  ScrollView,
  Spacer,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
  useState,
} from "scripting"

import { useSubscription } from "../../app/useSubscription"
import { CardGroup } from "../../design/layout"
import { OptionRow, SelectRow, TextInputRow, ToggleRow, rowSeparatorInset } from "../../design/rows"
import { pageInsets, pageSpacing, palette } from "../../design/tokens"
import { subscribe as subscribeLocale, t } from "../../i18n"
import type { AidokuFilterRow, AidokuFilterValue } from "../../sources/aidokuFilters"

type Value = AidokuFilterValue

function copyValue(value: Value): Value {
  if (typeof value === "object" && value !== null) {
    if ("included" in value) return { included: [...value.included], excluded: [...value.excluded] }
    if ("index" in value) return { index: value.index, ascending: value.ascending }
  }
  return value
}

/** multi 的三態：不選 / 包含 / 排除。 */
function TriStateRow({ title, state, onTap }: { title: string; state: "none" | "included" | "excluded"; onTap: () => void }) {
  return (
    <HStack
      spacing={8}
      padding={{ horizontal: 16, vertical: 12 }}
      alignment="center"
      frame={{ maxWidth: "infinity" }}
      contentShape="rect"
      onTapGesture={onTap}
    >
      <Text
        font="body"
        fontWeight={state === "none" ? "regular" : "medium"}
        foregroundStyle={state === "excluded" ? "secondaryLabel" : state === "included" ? "tintColor" : "label"}
      >
        {title}
      </Text>
      <Spacer />
      {state === "included" ? (
        <Image systemName="checkmark" font="subheadline" fontWeight="semibold" foregroundStyle="tintColor" />
      ) : null}
      {state === "excluded" ? <Image systemName="minus.circle" font="subheadline" foregroundStyle="secondaryLabel" /> : null}
    </HStack>
  )
}

export function AidokuFilterSheet({
  rows,
  values,
  defaults,
  onApply,
}: {
  rows: AidokuFilterRow[]
  values: Value[]
  defaults: Value[]
  /** 按「套用」交出草稿；`null` 代表重設成預設值。 */
  onApply: (values: Value[] | null) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [draft, setDraft] = useState<Value[]>(() => values.map(copyValue))
  // sheet 是獨立的 render 根：語言一換就重繪。
  useSubscription(subscribeLocale)

  function update(index: number, value: Value) {
    setDraft(previous => previous.map((item, at) => (at === index ? value : item)))
  }

  function body(row: AidokuFilterRow, index: number, value: Value) {
    switch (row.kind) {
      case "text":
        return (
          <TextInputRow
            label={row.label}
            prompt={row.label}
            value={typeof value === "string" ? value : ""}
            onChanged={next => update(index, next)}
          />
        )
      case "select":
        return (
          <SelectRow
            icon="chevron.up.chevron.down"
            iconColor={palette.blue}
            title={row.label}
            value={typeof value === "string" ? value : (row.options[0]?.value ?? "")}
            options={row.options.map(option => ({ value: option.value, text: option.label }))}
            onChanged={next => update(index, next)}
          />
        )
      case "sort": {
        const sort =
          typeof value === "object" && value !== null && "index" in value ? value : { index: 0, ascending: false }
        return (
          <VStack spacing={0}>
            <SelectRow
              icon="arrow.up.arrow.down"
              iconColor={palette.blue}
              title={row.label}
              value={String(sort.index)}
              options={row.options.map((option, at) => ({ value: String(at), text: option }))}
              onChanged={next => update(index, { index: Number(next) || 0, ascending: sort.ascending })}
            />
            {row.canAscend ? (
              <VStack spacing={0}>
                <Divider padding={{ leading: rowSeparatorInset }} />
                <ToggleRow
                  icon="arrow.up"
                  title={t("search.filterAscending")}
                  value={sort.ascending}
                  onChanged={ascending => update(index, { index: sort.index, ascending })}
                />
              </VStack>
            ) : null}
          </VStack>
        )
      }
      case "check":
        return (
          <ToggleRow
            icon="checkmark.square"
            title={row.label}
            value={value === true}
            onChanged={next => update(index, next)}
          />
        )
      case "multi": {
        const picked =
          typeof value === "object" && value !== null && "included" in value
            ? value
            : { included: [] as string[], excluded: [] as string[] }
        return (
          <VStack spacing={0}>
            {row.options.map((option, at) => {
              const state =
                picked.included.includes(option.value)
                  ? "included"
                  : picked.excluded.includes(option.value)
                    ? "excluded"
                    : "none"
              return (
                <VStack key={`multi:${at}`} spacing={0}>
                  {at > 0 ? <Divider padding={{ leading: rowSeparatorInset }} /> : null}
                  {row.canExclude ? (
                    <TriStateRow
                      title={option.label}
                      state={state}
                      onTap={() => {
                        const included = picked.included.filter(item => item !== option.value)
                        const excluded = picked.excluded.filter(item => item !== option.value)
                        if (state === "none") included.push(option.value)
                        else if (state === "included") excluded.push(option.value)
                        update(index, { included, excluded })
                      }}
                    />
                  ) : (
                    <OptionRow
                      title={option.label}
                      checked={state === "included"}
                      onTap={() =>
                        update(index, {
                          included:
                            state === "included"
                              ? picked.included.filter(item => item !== option.value)
                              : [...picked.included, option.value],
                          excluded: picked.excluded,
                        })
                      }
                    />
                  )}
                </VStack>
              )
            })}
          </VStack>
        )
      }
    }
  }

  return (
    <VStack
      spacing={0}
      navigationTitle={t("search.filterTitle")}
      navigationBarTitleDisplayMode="inline"
      toolbar={
        <Toolbar>
          <ToolbarItem placement="topBarLeading">
            <Button title={t("common.cancel")} action={dismiss} />
          </ToolbarItem>
          <ToolbarItem placement="topBarTrailing">
            <Button
              title={t("search.filterApply")}
              action={() => {
                onApply(draft)
                dismiss()
              }}
            />
          </ToolbarItem>
        </Toolbar>
      }
    >
      <ScrollView>
        <VStack alignment="leading" spacing={pageSpacing} padding={pageInsets}>
          {rows.map((row, index) => (
            <CardGroup
              key={`aidoku-filter:${index}`}
              title={row.label}
              footnote={row.kind === "multi" && row.canExclude ? t("search.filterTriState") : undefined}
            >
              {body(row, index, draft[index] ?? defaults[index])}
            </CardGroup>
          ))}
          <Button title={t("search.filterReset")} action={() => setDraft(defaults.map(copyValue))} />
        </VStack>
      </ScrollView>
    </VStack>
  )
}
