// Aidoku 源的 `editable-list` 設定：一串字串，增刪直接寫回 `installed.json`。
//
// `inline: true` 的源（照 Aidoku 的鏡像清單）把同樣的列攤在設定頁裡；
// 其餘走這一頁。值沒改過時是 schema 的 `default`。

import { Button, Divider, HStack, Image, Spacer, Text, VStack, useEffect, useState } from "scripting"

import { useSubscription } from "../../app/useSubscription"
import { CardGroup, PageScroll } from "../../design/layout"
import { ActionRow } from "../../design/rows"
import { rowPadding } from "../../design/tokens"
import { subscribe as subscribeLocale, t } from "../../i18n"
import type { AidokuSettingItem } from "../../sources/aidoku"
import { findSource, reloadRegistry, updateAidokuSetting, type InstalledSource } from "../../sources/registry"

/** 清單的目前值：存過的陣列優先，沒存過就是 schema 的預設。 */
export function listValuesOf(item: AidokuSettingItem, overrides: Record<string, unknown>): string[] {
  const raw = item.key && item.key in overrides ? overrides[item.key] : item.default
  return Array.isArray(raw) ? raw.map(value => String(value ?? "")) : []
}

/** 增刪的列：inline 與子頁共用，只把新陣列交出去。 */
export function AidokuEditableList({
  item,
  values,
  onChange,
}: {
  item: AidokuSettingItem
  values: string[]
  onChange: (next: string[]) => void
}) {
  async function add() {
    const text = await Dialog.prompt({
      title: item.title,
      message: item.subtitle,
      placeholder: item.placeholder ?? t("settings.aidokuSettings.listPlaceholder"),
      confirmLabel: t("settings.aidokuSettings.listAdd"),
      cancelLabel: t("settings.aidokuSettings.listCancel"),
    })
    const value = text?.trim()
    if (!value) return
    onChange([...values, value])
  }

  function remove(index: number) {
    onChange(values.filter((_, offset) => offset !== index))
  }

  return (
    <VStack spacing={0}>
      {values.length === 0 ? (
        <Text font="subheadline" foregroundStyle="secondaryLabel" padding={rowPadding}>
          {t("settings.aidokuSettings.listEmpty")}
        </Text>
      ) : (
        values.map((value, index) => (
          <VStack key={`${index}:${value}`} spacing={0}>
            {index > 0 ? <Divider padding={{ leading: rowPadding.horizontal }} /> : null}
            <HStack spacing={12} padding={rowPadding} alignment="center" frame={{ maxWidth: "infinity" }}>
              <Text font="body" lineLimit={item.lineLimit > 0 ? item.lineLimit : undefined}>
                {value}
              </Text>
              <Spacer />
              <Button buttonStyle="borderless" tint="systemRed" action={() => remove(index)}>
                <Image systemName="trash" font="subheadline" />
              </Button>
            </HStack>
          </VStack>
        ))
      )}
      {values.length > 0 ? <Divider padding={{ leading: rowPadding.horizontal }} /> : null}
      <ActionRow icon="plus" title={t("settings.aidokuSettings.listAdd")} onTap={() => void add()} />
    </VStack>
  )
}

export function AidokuListScreen({ sourceKey, item }: { sourceKey: string; item: AidokuSettingItem }) {
  const [source, setSource] = useState<InstalledSource | undefined>(undefined)
  useSubscription(subscribeLocale)

  useEffect(() => {
    reloadRegistry()
    setSource(findSource(sourceKey))
  }, [sourceKey])

  const overrides = source?.stored.settings ?? {}
  const values = listValuesOf(item, overrides)

  function change(next: string[]) {
    updateAidokuSetting(sourceKey, item.key, next)
    setSource(findSource(sourceKey))
  }

  return (
    <PageScroll title={item.title}>
      <CardGroup title={item.title} footnote={item.subtitle}>
        <VStack spacing={0}>
          <AidokuEditableList item={item} values={values} onChange={change} />
        </VStack>
      </CardGroup>
    </PageScroll>
  )
}
