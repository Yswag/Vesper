// 源搜尋篩選的 UI：上緣那排膠囊與完整的 sheet。Aidoku 與 Mihon 共用（資料在 `app/searchFilters.ts`）。
//
// 膠囊照 Aidoku 的 `FilterHeaderView`：最前面 `[☰ 數量]` 開 sheet，其餘每個「可以直接操作」的篩選一顆。
// 位置**不隨選取改變**（Menu 一換位置就會被收掉，多選就沒辦法連點），改過的用選取色標示。
// text、header、separator 與單獨的 tristate 只進 sheet。
//
// sheet 照 Mihon `SourceFilterDialog` 的結構：header＝分組標題、separator＝分隔線、group＝可展開的
// 區塊。勾選、三態、下拉是一列一項，相鄰的併進同一張卡；文字、排序、標籤各自一張帶標題的卡。
// 底部「重設」回到源給的預設。

import {
  Button,
  Divider,
  FlowLayout,
  HStack,
  Image,
  Menu,
  Navigation,
  Picker,
  ScrollView,
  Spacer,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
  useState,
  type Color,
  type DynamicShapeStyle,
  type VirtualNode,
} from "scripting"

import { PageBackground, useTint } from "../app/theme"
import { useSubscription } from "../app/useSubscription"
import { Chip } from "../design/chip"
import { CardGroup, GroupHeader } from "../design/layout"
import { FieldRow, OptionRow, SelectRow, rowSeparatorInset } from "../design/rows"
import { capsule, fill, filterTone, pageInsets, pageSpacing, rowPadding } from "../design/tokens"
import { changedCount, draftOf, isChanged, resetDraft, type FilterControl, type FilterDraft, type FilterEntry, type FilterField, type FilterToken, type Tristate } from "../design/filterEntries"
import { subscribe as subscribeLocale, t } from "../i18n"

/** 選取狀態的三種顏色：忽略不出現、包含是勾、排除是叉（跟 Aidoku 的 multi 一樣的語彙）。 */
function StateChip({ label, state, onTap }: { label: string; state: Tristate; onTap?: () => void }) {
  const tone = state === 1 ? filterTone.included : state === 2 ? filterTone.excluded : null
  const background: Color | DynamicShapeStyle = tone ? tone.background : fill.tag
  const textColor: Color | DynamicShapeStyle = tone ? tone.text : "secondaryLabel"

  return (
    <Button buttonStyle="plain" action={() => onTap?.()} accessibilityLabel={label}>
      <HStack
        spacing={5}
        padding={{ horizontal: 12, vertical: 7 }}
        alignment="center"
        background={background}
        clipShape={capsule("circular")}
      >
        {state === 0 ? null : (
          <Image
            systemName={state === 1 ? "checkmark" : "xmark"}
            font="caption2"
            fontWeight="bold"
            foregroundStyle={textColor}
          />
        )}
        <Text font="subheadline" fontWeight={state === 0 ? "regular" : "medium"} foregroundStyle={textColor}>
          {label}
        </Text>
      </HStack>
    </Button>
  )
}

/** 排序方向的切換鈕（卡片標題右側，無彩色）。 */
function SortDirectionButton({ ascending, canAscend, onToggle }: { ascending: boolean; canAscend: boolean; onToggle: () => void }): VirtualNode | null {
  if (!canAscend) return null
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

/** 勾選／三態的一列：名稱在左、狀態在右，點整列切換（三態循環忽略→包含→排除）。 */
function StateRow({ label, state, onTap }: { label: string; state: Tristate; onTap: () => void }) {
  const tint = useTint()
  const mark =
    state === 1
      ? { icon: "checkmark.square.fill", color: tint.tint as Color | DynamicShapeStyle }
      : state === 2
        ? { icon: "xmark.square.fill", color: filterTone.excluded.text as Color | DynamicShapeStyle }
        : { icon: "square", color: "tertiaryLabel" as Color | DynamicShapeStyle }
  return (
    <HStack
      spacing={8}
      padding={rowPadding}
      alignment="center"
      frame={{ maxWidth: "infinity" }}
      contentShape="rect"
      onTapGesture={onTap}
      accessibilityLabel={`${label}, ${
        state === 1 ? t("search.filterInclude") : state === 2 ? t("search.filterExclude") : t("search.filterIgnore")
      }`}
    >
      <Text font="body" foregroundStyle="label">
        {label}
      </Text>
      <Spacer />
      <Image systemName={mark.icon} font="title3" foregroundStyle={mark.color} />
    </HStack>
  )
}

/** 可以當一列放進共用卡片的篩選。 */
function isInline(control: FilterControl): boolean {
  return control.kind === "check" || control.kind === "tristate" || control.kind === "select"
}

/** 共用卡片裡的一列。 */
function InlineRow({ field, control, onChange }: { field: FilterField; control: FilterControl; onChange: (next: FilterControl) => void }) {
  switch (control.kind) {
    case "check":
      return <StateRow label={field.label} state={control.value ? 1 : 0} onTap={() => onChange({ ...control, value: !control.value })} />
    case "tristate":
      return (
        <StateRow
          label={field.label}
          state={control.value}
          onTap={() => onChange({ ...control, value: (control.value === 0 ? 1 : control.value === 1 ? 2 : 0) as Tristate })}
        />
      )
    case "select":
      return (
        <SelectRow
          title={field.label}
          value={String(control.value)}
          options={control.options.map((label, index) => ({ value: String(index), text: label }))}
          onChanged={next => onChange({ ...control, value: Number(next) || 0 })}
        />
      )
    default:
      return null
  }
}

/** 自己一張卡的篩選（文字、排序、標籤）的內容。 */
function ControlBody({ control, onChange }: { control: FilterControl; onChange: (next: FilterControl) => void }) {
  switch (control.kind) {
    case "check":
    case "tristate":
    case "select":
      return null
    case "text":
      return (
        <FieldRow
          icon={control.icon}
          value={control.value}
          prompt={control.prompt}
          onChanged={value => onChange({ ...control, value })}
        />
      )
    case "sort":
      return (
        <VStack spacing={0} alignment="leading">
          {control.options.map((option, index) => (
            <VStack key={String(index)} spacing={0}>
              {index > 0 ? <Divider padding={{ leading: rowSeparatorInset }} /> : null}
              <OptionRow title={option} checked={control.index === index} onTap={() => onChange({ ...control, index })} />
            </VStack>
          ))}
        </VStack>
      )
    case "tokens":
      return (
        <VStack padding={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <FlowLayout horizontalSpacing={8} verticalSpacing={8}>
            {control.tokens.map(token => (
              <StateChip
                key={token.value}
                label={token.label}
                state={token.state}
                onTap={() => {
                  const next: Tristate = token.state === 0 ? 1 : token.state === 1 && control.canExclude ? 2 : 0
                  onChange({
                    ...control,
                    tokens: control.tokens.map(item => (item.value === token.value ? { ...item, state: next } : item)),
                  })
                }}
              />
            ))}
          </FlowLayout>
        </VStack>
      )
  }
}

export function SourceFilterSheet({
  entries,
  onApply,
}: {
  entries: FilterEntry[]
  /** 按「套用」交出草稿（重設也是給一份等於預設的草稿）。 */
  onApply: (draft: FilterDraft) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [draft, setDraft] = useState<FilterDraft>(() => draftOf(entries))
  /** 收起來的群組（預設展開，跟 Mihon 的 `FilterGroup` 一樣）。 */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  // sheet 是獨立的 render 根：語言一換就重繪。
  useSubscription(subscribeLocale)

  function update(id: string, control: FilterControl) {
    setDraft(previous => ({ ...previous, [id]: control }))
  }

  function fieldCard(field: FilterField): VirtualNode {
    const control = draft[field.id] ?? field.control
    const accessory =
      control.kind === "sort" ? (
        <SortDirectionButton
          ascending={control.ascending}
          canAscend={control.canAscend}
          onToggle={() => update(field.id, { ...control, ascending: !control.ascending })}
        />
      ) : undefined
    return (
      <CardGroup key={`filter:${field.id}`} title={field.label} headerAccessory={accessory}>
        <ControlBody control={control} onChange={next => update(field.id, next)} />
      </CardGroup>
    )
  }

  /** 相鄰的勾選／三態／下拉併成一張卡，一列一項。 */
  function inlineCard(fields: FilterField[]): VirtualNode {
    return (
      <CardGroup key={`rows:${fields[0].id}`}>
        {fields.map((field, index) => (
          <VStack key={field.id} spacing={0}>
            {index > 0 ? <Divider padding={{ leading: rowPadding.horizontal }} /> : null}
            <InlineRow field={field} control={draft[field.id] ?? field.control} onChange={next => update(field.id, next)} />
          </VStack>
        ))}
      </CardGroup>
    )
  }

  function entriesView(list: FilterEntry[]): VirtualNode[] {
    const out: VirtualNode[] = []
    let pending: FilterField[] = []
    const flush = () => {
      if (pending.length > 0) out.push(inlineCard(pending))
      pending = []
    }
    for (const entry of list) {
      if (entry.kind === "field" && isInline(entry.field.control)) {
        pending.push(entry.field)
        continue
      }
      flush()
      out.push(entryView(entry))
    }
    flush()
    return out
  }

  function entryView(entry: FilterEntry): VirtualNode {
    switch (entry.kind) {
        case "header":
          return (
            <VStack key={`header:${entry.id}`} alignment="leading" padding={{ top: 6 }}>
              <GroupHeader title={entry.label} />
            </VStack>
          )
        case "separator":
          return <Divider key={`separator:${entry.id}`} />
        case "field":
          return fieldCard(entry.field)
        case "group": {
          const open = collapsed[entry.id] !== true
          return (
            <VStack key={`group:${entry.id}`} spacing={pageSpacing} alignment="leading">
              <HStack
                spacing={8}
                alignment="center"
                frame={{ maxWidth: "infinity" }}
                contentShape="rect"
                onTapGesture={() => setCollapsed(previous => ({ ...previous, [entry.id]: open }))}
              >
                <GroupHeader title={entry.label} />
                <Spacer />
                <Image
                  systemName={open ? "chevron.down" : "chevron.forward"}
                  font="caption2"
                  fontWeight="semibold"
                  foregroundStyle="secondaryLabel"
                />
              </HStack>
              {open ? (
                <VStack spacing={pageSpacing} alignment="leading">
                  {entriesView(entry.entries)}
                </VStack>
              ) : null}
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
      {/* sheet 本身是白底：不鋪頁面底色的話，淺色下半透明白卡片看不到邊。 */}
      <ScrollView scrollContentBackground="hidden" background={<PageBackground />}>
        <VStack alignment="leading" spacing={pageSpacing} padding={pageInsets}>
          {entriesView(entries)}
          <HStack alignment="center" frame={{ maxWidth: "infinity" }} padding={{ top: 8, bottom: 20 }}>
            <Chip
              text={t("search.filterReset")}
              icon="arrow.counterclockwise"
              onTap={() => setDraft(resetDraft(entries))}
            />
          </HStack>
        </VStack>
      </ScrollView>
    </VStack>
  )
}

// ---------------------------------------------------------------- 膠囊列

/** 每顆膠囊的狀態色：跟預設不同就亮起來。 */
function chipTone(control: FilterControl, initial: FilterControl): boolean {
  return control.kind === initial.kind && JSON.stringify(control) !== JSON.stringify(initial)
}

function tokenCycle(control: FilterControl, token: FilterToken): FilterControl {
  if (control.kind !== "tokens") return control
  const next: Tristate = token.state === 0 ? 1 : token.state === 1 && control.canExclude ? 2 : 0
  return {
    ...control,
    tokens: control.tokens.map(item => (item.value === token.value ? { ...item, state: next } : item)),
  }
}

/**
 * 上緣那一排：`[☰ 數量]` 開 sheet，後面每個可以直接操作的篩選一顆膠囊。
 * `entries` 是整棵樹，群組自己一顆（子項在 Menu 裡連點）。
 */
export function SourceFilterBar({
  entries,
  onOpenAll,
  onChange,
}: {
  entries: FilterEntry[]
  onOpenAll: () => void
  onChange: (id: string, control: FilterControl) => void
}) {
  const tint = useTint()
  const count = changedCount(entries)

  function fieldChip(field: FilterField): VirtualNode | null {
    const control = field.control
    const selected = isChanged(field)

    switch (control.kind) {
      case "text":
      case "tristate":
        return null
      case "check":
        return (
          <Chip text={field.label} selected={selected} onTap={() => onChange(field.id, { ...control, value: !control.value })} />
        )
      case "select":
        return (
          <Menu label={<Chip text={field.label} selected={selected} chevron />}>
            <Picker
              title={field.label}
              value={String(control.value)}
              onChanged={(next: string | number) => onChange(field.id, { ...control, value: Number(next) || 0 })}
            >
              {control.options.map((label, index) => (
                <Text key={String(index)} tag={String(index)}>
                  {label}
                </Text>
              ))}
            </Picker>
          </Menu>
        )
      case "sort": {
        // 點同一項＝切換升降冪：所以每一項都不關 Menu，方向用箭頭畫在目前那一列。
        const label = control.options[control.index] ?? ""
        return (
          <Menu label={<Chip text={`${field.label}: ${label}`} selected={selected} chevron />}>
            {control.options.map((option, index) => (
              <Button
                key={String(index)}
                menuActionDismissBehavior="disabled"
                action={() =>
                  onChange(
                    field.id,
                    index === control.index
                      ? { ...control, ascending: control.canAscend ? !control.ascending : control.ascending }
                      : { ...control, index }
                  )
                }
              >
                <HStack spacing={8}>
                  <Text>{option}</Text>
                  {index === control.index ? (
                    <Image
                      systemName={
                        control.canAscend && control.ascending ? "arrow.up" : control.canAscend ? "arrow.down" : "checkmark"
                      }
                      foregroundStyle={tint.tint}
                    />
                  ) : null}
                </HStack>
              </Button>
            ))}
          </Menu>
        )
      }
      case "tokens": {
        const picked = control.tokens.filter(token => token.state !== 0).length
        return (
          <Menu
            label={
              <Chip text={field.label} selected={selected} detail={picked > 0 ? String(picked) : undefined} chevron />
            }
          >
            {control.tokens.map(token => (
              <Button
                key={token.value}
                menuActionDismissBehavior="disabled"
                action={() => onChange(field.id, tokenCycle(control, token))}
              >
                <HStack spacing={8}>
                  <Text>{token.label}</Text>
                  {token.state === 1 ? (
                    <Image systemName="checkmark" foregroundStyle={tint.tint} />
                  ) : token.state === 2 ? (
                    <Image systemName="xmark" foregroundStyle={tint.tint} />
                  ) : null}
                </HStack>
              </Button>
            ))}
          </Menu>
        )
      }
    }
  }

  /** 群組：一顆 Menu，子項 tristate 循環、checkbox 直接切，都不關 Menu。 */
  function groupChip(label: string, children: FilterEntry[]): VirtualNode | null {
    const fields = children.filter((entry): entry is { kind: "field"; field: FilterField } => entry.kind === "field")
    const changed = fields.filter(entry => isChanged(entry.field)).length
    if (fields.length === 0) return null

    return (
      <Menu
        label={<Chip text={label} selected={changed > 0} detail={changed > 0 ? String(changed) : undefined} chevron />}
      >
        {fields.map(({ field }) => (
          <Button key={field.id} menuActionDismissBehavior="disabled" action={() => onChange(field.id, nextChildValue(field))}>
            <HStack spacing={8}>
              <Text>{field.label}</Text>
              {childMark(field.control, tint.tint)}
            </HStack>
          </Button>
        ))}
      </Menu>
    )
  }

  return (
    <ScrollView axes="horizontal" scrollIndicator="hidden">
      <HStack spacing={6} padding={{ horizontal: pageInsets.horizontal, vertical: 6 }}>
        <Chip
          icon="line.3.horizontal.decrease"
          detail={count > 0 ? String(count) : undefined}
          selected={count > 0}
          onTap={onOpenAll}
          accessibilityLabel={t("search.filterTitle")}
        />
        {entries.map(entry => {
          if (entry.kind === "field") {
            const control = entry.field.control
            if (control.kind === "text" || control.kind === "tristate") return null
            return <VStack key={`chip:${entry.field.id}`} spacing={0}>{fieldChip(entry.field)}</VStack>
          }
          if (entry.kind === "group") {
            return (
              <VStack key={`chip:${entry.id}`} spacing={0}>
                {groupChip(entry.label, entry.entries)}
              </VStack>
            )
          }
          return null
        })}
      </HStack>
    </ScrollView>
  )
}

/** 子項的下一個狀態：tristate 循環（忽略→包含→排除），checkbox 直接切。 */
function nextChildValue(field: FilterField): FilterControl {
  const control = field.control
  switch (control.kind) {
    case "tristate":
      return { ...control, value: (control.value === 0 ? 1 : control.value === 1 ? 2 : 0) as Tristate }
    case "check":
      return { ...control, value: !control.value }
    default:
      return control
  }
}

function childMark(control: FilterControl, tint: Color | DynamicShapeStyle): VirtualNode | null {
  switch (control.kind) {
    case "check":
      return control.value ? <Image systemName="checkmark" foregroundStyle={tint} /> : null
    case "tristate":
      return control.value === 1 ? (
        <Image systemName="checkmark" foregroundStyle={tint} />
      ) : control.value === 2 ? (
        <Image systemName="xmark" foregroundStyle={tint} />
      ) : null
    default:
      return null
  }
}
