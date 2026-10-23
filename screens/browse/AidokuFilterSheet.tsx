// Aidoku 源的搜尋篩選 sheet：草稿留在這裡，按「套用」才交出去。
//
// 五種列：text / select / sort / check / multi。
// multi 在源允許時是三態（不選 → 包含 → 排除），沒允許就只有包含。

import {
  Button,
  FlowLayout,
  HStack,
  Image,
  Navigation,
  ScrollView,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
  useState,
  type Color,
} from "scripting"

import { useSubscription } from "../../app/useSubscription"
import { CardGroup } from "../../design/layout"
import { FieldRow, IconBadge, SelectRow, ToggleRow } from "../../design/rows"
import { capsule, fill, pageInsets, pageSpacing, palette, rowPadding } from "../../design/tokens"
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

/** 多選與三態標籤膠囊：預設 / 包含（綠色勾號）/ 排除（紅色叉號）。 */
function FilterChip({
  label,
  state,
  onTap,
}: {
  label: string
  state: "none" | "included" | "excluded"
  onTap: () => void
}) {
  const isIncluded = state === "included"
  const isExcluded = state === "excluded"

  const bg: Color = isIncluded
    ? "rgba(48, 209, 88, 0.18)"
    : isExcluded
      ? "rgba(255, 69, 58, 0.18)"
      : fill.tag

  const fg: Color = isIncluded
    ? palette.green
    : isExcluded
      ? palette.red
      : "secondaryLabel"

  return (
    <Button buttonStyle="plain" action={onTap} accessibilityLabel={label}>
      <HStack
        spacing={5}
        padding={{ horizontal: 12, vertical: 7 }}
        alignment="center"
        background={bg}
        clipShape={capsule("circular")}
      >
        {isIncluded ? (
          <Image systemName="checkmark" font="caption2" fontWeight="bold" foregroundStyle={palette.green} />
        ) : null}
        {isExcluded ? (
          <Image systemName="xmark" font="caption2" fontWeight="bold" foregroundStyle={palette.red} />
        ) : null}
        <Text font="subheadline" fontWeight={state === "none" ? "regular" : "medium"} foregroundStyle={fg}>
          {label}
        </Text>
      </HStack>
    </Button>
  )
}

/** 排序的升降序切換膠囊按鈕（無彩色，貼合設定頁風格）。 */
function SortAscendButton({ ascending, onToggle }: { ascending: boolean; onToggle: () => void }) {
  return (
    <Button
      buttonStyle="plain"
      action={onToggle}
      accessibilityLabel={ascending ? t("search.filterAscending") : t("search.filterDescending")}
    >
      <HStack
        spacing={4}
        padding={{ horizontal: 8, vertical: 4 }}
        alignment="center"
        background={fill.tag}
        clipShape={capsule("circular")}
      >
        <Image
          systemName={ascending ? "arrow.up" : "arrow.down"}
          font="caption"
          fontWeight="semibold"
          foregroundStyle="secondaryLabel"
        />
        <Text font="caption" fontWeight="medium" foregroundStyle="secondaryLabel">
          {ascending ? t("search.filterAscending") : t("search.filterDescending")}
        </Text>
      </HStack>
    </Button>
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
          <FieldRow
            icon={row.author ? "person" : "magnifyingglass"}
            value={typeof value === "string" ? value : ""}
            prompt={row.label}
            onChanged={next => update(index, next)}
          />
        )
      case "select": {
        const selected = typeof value === "string" ? value : (row.options[0]?.value ?? "")
        return (
          <SelectRow
            icon="chevron.up.chevron.down"
            title={row.label}
            value={selected}
            options={row.options.map(option => ({ value: option.value, text: option.label }))}
            onChanged={next => update(index, next)}
          />
        )
      }
      case "sort": {
        const sort =
          typeof value === "object" && value !== null && "index" in value ? value : { index: 0, ascending: false }
        return (
          <SelectRow
            icon="arrow.up.arrow.down"
            title={row.label}
            value={String(sort.index)}
            options={row.options.map((option, at) => ({ value: String(at), text: option }))}
            onChanged={next => update(index, { index: Number(next) || 0, ascending: sort.ascending })}
          />
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
          <VStack padding={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
            <FlowLayout horizontalSpacing={8} verticalSpacing={8}>
              {row.options.map(option => {
                const state =
                  picked.included.includes(option.value)
                    ? "included"
                    : picked.excluded.includes(option.value)
                      ? "excluded"
                      : "none"
                return (
                  <FilterChip
                    key={option.value}
                    label={option.label}
                    state={state}
                    onTap={() => {
                      const included = picked.included.filter(item => item !== option.value)
                      const excluded = picked.excluded.filter(item => item !== option.value)
                      if (row.canExclude) {
                        if (state === "none") included.push(option.value)
                        else if (state === "included") excluded.push(option.value)
                      } else {
                        if (state === "none") included.push(option.value)
                      }
                      update(index, { included, excluded })
                    }}
                  />
                )
              })}
            </FlowLayout>
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
            <Button
              buttonStyle="plain"
              action={dismiss}
              accessibilityLabel={t("common.cancel")}
            >
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
      <ScrollView>
        <VStack alignment="leading" spacing={pageSpacing} padding={pageInsets}>
          {rows.map((row, index) => {
            const value = draft[index] ?? defaults[index]
            const accessory =
              row.kind === "sort" && row.canAscend ? (
                <SortAscendButton
                  ascending={
                    typeof value === "object" && value !== null && "ascending" in value
                      ? value.ascending
                      : false
                  }
                  onToggle={() => {
                    const current =
                      typeof value === "object" && value !== null && "index" in value
                        ? value
                        : { index: 0, ascending: false }
                    update(index, { index: current.index, ascending: !current.ascending })
                  }}
                />
              ) : undefined

            return (
              <CardGroup key={`aidoku-filter:${index}`} title={row.label} headerAccessory={accessory}>
                {body(row, index, value)}
              </CardGroup>
            )
          })}
          <HStack alignment="center" frame={{ maxWidth: "infinity" }} padding={{ top: 8, bottom: 20 }}>
            <Button buttonStyle="plain" action={() => setDraft(defaults.map(copyValue))}>
              <HStack
                spacing={6}
                padding={{ horizontal: 16, vertical: 10 }}
                alignment="center"
                background={fill.tag}
                clipShape={capsule("circular")}
              >
                <Image systemName="arrow.counterclockwise" font="subheadline" foregroundStyle="secondaryLabel" />
                <Text font="subheadline" fontWeight="medium" foregroundStyle="secondaryLabel">
                  {t("search.filterReset")}
                </Text>
              </HStack>
            </Button>
          </HStack>
        </VStack>
      </ScrollView>
    </VStack>
  )
}
