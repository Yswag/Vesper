// 源的設定。四種欄位都支援：input（可帶 regex validator）、select、switch、callback。
//
// 版面全走 design/（頁面殼 · 卡片 · 列 · 狀態橫幅），跟設定分頁其他頁面同一套語言，
// 這裡不再出現任何顏色、圓角或列結構的字面值。
//
// 這一頁是自架類的源能不能用的前提 —— komga / kavita / lanraragi 都只宣告一個
// `base_url`（input），預設指向 demo 伺服器，使用者得填自己的位址。

import { Divider, Text, VStack, type Color, useEffect, useState } from "scripting"
import { CardGroup, PageScroll } from "../../design/layout"
import { FieldRow, IconRow, OptionRow, ToggleRow, rowSeparatorInset } from "../../design/rows"
import { EmptyState, NoticeBanner, statusTone, type StatusNotice } from "../../design/status"
import { badgeOff, palette } from "../../design/tokens"
import type { SettingSpec } from "../../engine/loader"
import { t } from "../../i18n"
import {
  findSource,
  reloadRegistry,
  resetSourceSetting,
  runSourceSettingCallback,
  updateSourceSetting,
  type InstalledSource,
} from "../../sources/registry"

/** 每個型別的圖示（純色線條風格，相容深淺色模式）。未知型別一律當 input 處理。 */
const SPEC_STYLE: Record<string, { icon: string }> = {
  input: { icon: "character.cursor.ibeam" },
  select: { icon: "list.bullet" },
  switch: { icon: "switch.2" },
  callback: { icon: "bolt" },
}

function specStyle(type: string): { icon: string } {
  return SPEC_STYLE[type] ?? SPEC_STYLE.input
}

export function SourceSettingsScreen({ sourceKey }: { sourceKey: string }) {
  const [source, setSource] = useState<InstalledSource | undefined>(undefined)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<StatusNotice | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    reloadRegistry()
    setSource(findSource(sourceKey))
    setDraft({})
    setStatus(null)
  }, [sourceKey])

  const specs = source?.settingsSpecs ?? []

  /** input 的驗證：validator 是源給的 regex 字串，不是函式。 */
  function validate(spec: SettingSpec, raw: string): string | null {
    if (!spec.validator) return null
    try {
      return new RegExp(spec.validator).test(raw) ? null : t("settings.sourceSettings.formatMismatch")
    } catch {
      return null
    }
  }

  function refresh() {
    setSource(findSource(sourceKey))
  }

  function apply(id: string, value: unknown) {
    const spec = specs.find(item => item.id === id)
    const raw = String(value).trim()
    if (spec) {
      const error = validate(spec, raw)
      if (error) {
        // `spec.title` 是源自己給的設定名（資料），只有外框那句是我們的文案。
        setStatus({
          kind: "error",
          text: t("settings.sourceSettings.invalidValue", { title: spec.title, error }),
        })
        return
      }
    }
    updateSourceSetting(sourceKey, id, raw)
    refresh()
    setStatus({ kind: "ready", text: t("settings.sourceSettings.saved") })
  }

  function reset(id: string) {
    resetSourceSetting(sourceKey, id)
    setDraft(current => {
      const next = { ...current }
      delete next[id]
      return next
    })
    refresh()
    setStatus({ kind: "ready", text: t("settings.sourceSettings.resetDone") })
  }

  async function runCallback(id: string, label: string) {
    setBusy(true)
    setStatus({ kind: "loading", text: t("common.inProgress", { label }) })
    try {
      await runSourceSettingCallback(sourceKey, id)
      setStatus({ kind: "ready", text: t("settings.shared.done", { label }) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus({ kind: "error", text: t("common.failed", { message }) })
      await Dialog.alert({ title: label, message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <SourceSettingsView
      specs={specs}
      values={source?.stored.settings ?? {}}
      draft={draft}
      status={status}
      busy={busy}
      onDraft={(id, value) => setDraft(current => ({ ...current, [id]: value }))}
      onApply={apply}
      onReset={reset}
      onRun={runCallback}
    />
  )
}

export interface SourceSettingsViewProps {
  specs: SettingSpec[]
  values: Record<string, unknown>
  draft: Record<string, string>
  status: StatusNotice | null
  busy: boolean
  onDraft: (id: string, value: string) => void
  onApply: (id: string, value: unknown) => void
  onReset: (id: string) => void
  onRun: (id: string, label: string) => void
}

/** 只有版面：把 specs / 狀態轉成卡片。抽出來是為了能用假資料預覽整頁。 */
export function SourceSettingsView({
  specs,
  values,
  draft,
  status,
  busy,
  onDraft,
  onApply,
  onReset,
  onRun,
}: SourceSettingsViewProps) {
  const hasCallback = specs.some(spec => spec.type === "callback")

  return (
    <PageScroll title={t("settings.sourceSettings.title")}>
      {status ? <NoticeBanner tone={statusTone(status.kind)} text={status.text} /> : null}

      {specs.length === 0 ? (
        <EmptyState icon="slider.horizontal.3" title={t("settings.sourceSettings.empty")} />
      ) : (
        specs.map(spec => (
          <SpecCard
            key={spec.id}
            spec={spec}
            values={values}
            draft={draft}
            busy={busy}
            onDraft={onDraft}
            onApply={onApply}
            onReset={onReset}
            onRun={onRun}
          />
        ))
      )}

      {specs.length > 0 ? (
        <Text font="caption2" foregroundStyle="tertiaryLabel" padding={{ leading: 6, top: 2 }}>
          {t("settings.sourceSettings.footer", { n: specs.length })}
          {hasCallback ? t("settings.sourceSettings.footerCallback") : ""}
        </Text>
      ) : null}
    </PageScroll>
  )
}

/** 一個設定項 = 小標題 + 一張卡片。 */
function SpecCard({
  spec,
  values,
  draft,
  busy,
  onDraft,
  onApply,
  onReset,
  onRun,
}: {
  spec: SettingSpec
  values: Record<string, unknown>
  draft: Record<string, string>
  busy: boolean
  onDraft: (id: string, value: string) => void
  onApply: (id: string, value: unknown) => void
  onReset: (id: string) => void
  onRun: (id: string, label: string) => void
}) {
  const style = specStyle(spec.type)
  const stored = String(values[spec.id] ?? "")
  const current = draft[spec.id] ?? stored
  const dirty = draft[spec.id] !== undefined && draft[spec.id] !== stored

  if (spec.type === "select") {
    return (
      <CardGroup
        title={spec.title}
        footnote={spec.options.length === 0 ? t("settings.sourceSettings.noOptions") : undefined}
      >
        {spec.options.map((option, index) => (
          <VStack key={option.value} spacing={0}>
            {index > 0 ? <Divider padding={{ leading: 16 }} /> : null}
            <OptionRow
              title={option.text}
              checked={stored === option.value}
              onTap={() => onApply(spec.id, option.value)}
            />
          </VStack>
        ))}
      </CardGroup>
    )
  }

  if (spec.type === "switch") {
    const on = values[spec.id] === true
    return (
      <CardGroup title={spec.title}>
        <ToggleRow
          icon={style.icon}
          title={on ? t("settings.sourceSettings.on") : t("settings.sourceSettings.off")}
          value={on}
          onChanged={next => onApply(spec.id, next)}
        />
      </CardGroup>
    )
  }

  if (spec.type === "callback") {
    const label = spec.buttonText ?? t("settings.sourceSettings.run")
    return (
      <CardGroup title={spec.title}>
        <IconRow
          icon={style.icon}
          title={busy ? t("settings.shared.running") : label}
          titleColor={busy ? "secondaryLabel" : "label"}
          onTap={busy ? undefined : () => onRun(spec.id, label)}
        />
      </CardGroup>
    )
  }

  // input（含未知型別）
  const fallback = typeof spec.default === "string" && spec.default.length > 0 ? spec.default : undefined
  return (
    <CardGroup
      title={spec.title}
      footnote={
        fallback && fallback !== stored
          ? t("settings.sourceSettings.defaultValue", { value: fallback })
          : undefined
      }
    >
      <FieldRow
        icon={style.icon}
        value={current}
        prompt={t("settings.sourceSettings.prompt")}
        onChanged={next => onDraft(spec.id, next)}
      />

      <Divider padding={{ leading: rowSeparatorInset }} />
      <IconRow
        icon="square.and.arrow.down"
        iconColor={dirty ? "tintColor" : "secondaryLabel"}
        title={t("common.save")}
        titleColor={dirty ? "tintColor" : "secondaryLabel"}
        detail={dirty ? t("settings.sourceSettings.unsaved") : undefined}
        detailColor="systemOrange"
        onTap={() => onApply(spec.id, current)}
      />

      {spec.default !== undefined ? (
        <>
          <Divider padding={{ leading: rowSeparatorInset }} />
          <IconRow
            icon="arrow.counterclockwise"
            title={t("settings.sourceSettings.restoreDefault")}
            onTap={() => onReset(spec.id)}
          />
        </>
      ) : null}
    </CardGroup>
  )
}
