import { Divider, NavigationLink, Text, VStack, useEffect, useState } from "scripting"

import { useSubscription } from "../../app/useSubscription"
import { Card, CardGroup, PageScroll } from "../../design/layout"
import { ActionRow, FieldRow, IconRow, OptionRow, SelectRow, ToggleRow, rowSeparatorInset } from "../../design/rows"
import { EmptyState, NoticeBanner, statusTone, type StatusNotice } from "../../design/status"
import { SkeletonCardGroups } from "../../design/skeleton"
import { subscribe as subscribeLocale, t } from "../../i18n"
import * as mihon from "../../sources/mihon"
import {
  controlOf,
  countOf,
  detailOf,
  editableOf,
  multiStoredValue,
  multiValuesOf,
  optionsOf,
  sectionsOf,
  selectValueOf,
  summaryOf,
  switchValueOf,
  textValueOf,
  type MihonPreference,
  type MihonPreferenceValues,
} from "../../sources/mihonPrefs"
import { findSource, reloadRegistry, type InstalledSource } from "../../sources/registry"

const ICON: Record<string, string> = {
  select: "list.bullet",
  multi: "checklist",
  switch: "switch.2",
  text: "character.cursor.ibeam",
  info: "info.circle",
  screen: "slider.horizontal.3",
  category: "folder",
}

type Apply = (key: string, value: unknown) => void

export function MihonSettingsScreen({ sourceKey }: { sourceKey: string }) {
  useSubscription(subscribeLocale)
  const [source, setSource] = useState<InstalledSource | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)
  const [nodes, setNodes] = useState<MihonPreference[] | null>(null)
  const [values, setValues] = useState<MihonPreferenceValues>({})
  const [status, setStatus] = useState<StatusNotice | null>(null)
  const [busy, setBusy] = useState(false)

  async function load(current: InstalledSource) {
    setStatus(null)
    setBusy(true)
    try {
      const result = await mihon.preferencesOf(current)
      setNodes(result.nodes)
      setValues(result.values)
    } catch (error) {
      setNodes([])
      setStatus({ kind: "error", text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
      setLoaded(true)
    }
  }

  useEffect(() => {
    reloadRegistry()
    const current = findSource(sourceKey)
    setSource(current)
    setNodes(null)
    setValues({})
    setLoaded(false)
    if (current) void load(current)
    else setLoaded(true)
  }, [sourceKey])

  const apply: Apply = (key, value) => {
    if (!source || busy) return
    setBusy(true)
    setStatus({ kind: "loading", text: t("settings.mihonSettings.saving") })
    void mihon
      .setPreferenceValue(source, key, value)
      .then(next => {
        setValues(next)
        setStatus({ kind: "ready", text: t("settings.mihonSettings.saved") })
      })
      .catch((error: unknown) => {
        setStatus({ kind: "error", text: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => setBusy(false))
  }

  const total = nodes ? countOf(nodes) : 0

  function content() {
    if (!loaded) return <SkeletonCardGroups />
    if (!source) {
      return (
        <EmptyState
          variant="page"
          icon="questionmark.circle"
          title={t("settings.sourceDetail.notFound")}
          detail={t("settings.sourceDetail.notFoundDetail")}
        />
      )
    }
    if (!nodes) return <SkeletonCardGroups />
    if (nodes.length === 0) {
      if (status?.kind === "error") {
        return (
          <Card>
            <ActionRow icon="arrow.clockwise" title={t("common.retry")} onTap={() => void load(source)} />
          </Card>
        )
      }
      return <EmptyState variant="page" icon="slider.horizontal.3" title={t("settings.mihonSettings.empty")} />
    }
    return (
      <>
        <PreferenceCards sourceKey={sourceKey} nodes={nodes} values={values} apply={apply} />
        <Text font="caption2" foregroundStyle="tertiaryLabel" padding={{ leading: 6, top: 2 }}>
          {t("settings.mihonSettings.footer", { n: total })}
        </Text>
      </>
    )
  }

  return (
    <PageScroll title={t("settings.mihonSettings.title")}>
      {status ? <NoticeBanner tone={statusTone(status.kind)} text={status.text} /> : null}
      {content()}
    </PageScroll>
  )
}

function PreferenceCards({
  sourceKey,
  nodes,
  values,
  apply,
}: {
  sourceKey: string
  nodes: MihonPreference[]
  values: MihonPreferenceValues
  apply: Apply
}) {
  return (
    <>
      {sectionsOf(nodes).map((section, index) => (
        <CardGroup key={`${index}:${section.title}`} title={section.title || undefined}>
          {section.nodes.map((node, at) => (
            <VStack key={`${index}:${at}:${node.key ?? node.title ?? ""}`} spacing={0}>
              {at > 0 ? <Divider padding={{ leading: rowSeparatorInset }} /> : null}
              <PreferenceRow sourceKey={sourceKey} node={node} values={values} apply={apply} />
            </VStack>
          ))}
        </CardGroup>
      ))}
    </>
  )
}

function PreferenceRow({
  sourceKey,
  node,
  values,
  apply,
}: {
  sourceKey: string
  node: MihonPreference
  values: MihonPreferenceValues
  apply: Apply
}) {
  const control = controlOf(node)
  const icon = ICON[control] ?? ICON.info
  const subtitle = summaryOf(node, values)
  const editable = editableOf(node)

  const body = (() => {
    switch (control) {
      case "switch":
        return (
          <ToggleRow
            icon={icon}
            title={node.title ?? ""}
            subtitle={subtitle || undefined}
            value={switchValueOf(node, values)}
            onChanged={next => node.key && apply(node.key, next)}
          />
        )
      case "select": {
        const options = optionsOf(node)
        if (options.length === 0) return <IconRow icon={icon} title={node.title ?? ""} detail={subtitle || undefined} />
        return (
          <SelectRow
            icon={icon}
            title={node.title ?? ""}
            value={selectValueOf(node, values)}
            options={options.map(option => ({ value: option.value, text: option.label }))}
            onChanged={next => node.key && apply(node.key, next)}
          />
        )
      }
      case "text":
        return (
          <IconRow
            icon={icon}
            title={node.title ?? ""}
            detail={textValueOf(node, values) || subtitle || undefined}
            detailColor={textValueOf(node, values) ? "secondaryLabel" : "tertiaryLabel"}
            onTap={() => void promptText(node, values, value => node.key && apply(node.key, value))}
          />
        )
      case "multi":
        return (
          <NavigationLink
            destination={
              <MihonMultiSelectScreen
                title={node.title ?? ""}
                node={node}
                selected={multiValuesOf(node, values)}
                onChange={next => node.key && apply(node.key, multiStoredValue(next))}
              />
            }
          >
            <IconRow
              icon={icon}
              title={node.title ?? ""}
              detail={t("settings.mihonSettings.selected", { n: multiValuesOf(node, values).length })}
              chevron
            />
          </NavigationLink>
        )
      case "screen":
        return (
          <NavigationLink
            destination={
              <MihonPreferenceSubScreen
                title={node.title ?? ""}
                sourceKey={sourceKey}
                nodes={node.children ?? []}
                values={values}
                apply={apply}
              />
            }
          >
            <IconRow icon={icon} title={node.title ?? ""} detail={subtitle || undefined} chevron />
          </NavigationLink>
        )
      default:
        return <IconRow icon={icon} title={node.title ?? ""} detail={subtitle || undefined} detailColor="secondaryLabel" />
    }
  })()

  if (!editable && control !== "info" && control !== "screen") {
    return (
      <VStack spacing={0} allowsHitTesting={false} opacity={0.45}>
        {body}
      </VStack>
    )
  }
  return body
}

function MihonPreferenceSubScreen({
  title,
  sourceKey,
  nodes,
  values,
  apply,
}: {
  title: string
  sourceKey: string
  nodes: MihonPreference[]
  values: MihonPreferenceValues
  apply: Apply
}) {
  return (
    <PageScroll title={title}>
      <PreferenceCards sourceKey={sourceKey} nodes={nodes} values={values} apply={apply} />
    </PageScroll>
  )
}

function MihonMultiSelectScreen({
  title,
  node,
  selected,
  onChange,
}: {
  title: string
  node: MihonPreference
  selected: string[]
  onChange: (values: string[]) => void
}) {
  useSubscription(subscribeLocale)
  const [picked, setPicked] = useState<string[]>(selected)
  const options = optionsOf(node)

  function toggle(value: string) {
    const next = picked.includes(value) ? picked.filter(item => item !== value) : [...picked, value]
    setPicked(next)
    onChange(next)
  }

  return (
    <PageScroll title={title}>
      <CardGroup title={title} footnote={summaryOf(node, {}) || undefined}>
        {options.map((option, index) => (
          <VStack key={option.value} spacing={0}>
            {index > 0 ? <Divider padding={{ leading: rowSeparatorInset }} /> : null}
            <OptionRow
              title={option.label}
              checked={picked.includes(option.value)}
              onTap={() => toggle(option.value)}
            />
          </VStack>
        ))}
      </CardGroup>
    </PageScroll>
  )
}

async function promptText(node: MihonPreference, values: MihonPreferenceValues, apply: (value: string) => void) {
  const text = await Dialog.prompt({
    title: node.title ?? "",
    message: summaryOf(node, values),
    defaultValue: textValueOf(node, values),
    placeholder: t("settings.mihonSettings.textPlaceholder"),
    confirmLabel: t("common.save"),
    cancelLabel: t("common.cancel"),
  })
  if (typeof text !== "string") return
  apply(text)
}
