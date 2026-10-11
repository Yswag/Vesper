// 日誌：相容層的每一次 HTTP、每一次解析、每一次例外都會落在這裡。
// 沒有這頁，「這個源壞了是源的錯還是 shim 的錯」只能瞎猜。

import { Divider, HStack, LazyVStack, Spacer, Text, VStack, useState } from "scripting"

import { useSubscription } from "../../app/useSubscription"

import { CardGroup, PageScroll } from "../../design/layout"
import { ActionRow, SelectRow, rowSeparatorInset } from "../../design/rows"
import { EmptyState, StatusLine } from "../../design/status"
import { Caption, Footnote } from "../../design/text"
import { cardBackground, cardShape, denseRowPadding, palette } from "../../design/tokens"
import { clearLog, logEntries, subscribeLog, type LogEntry, type LogLevel } from "../../engine/log"
import { t, type MessageKey } from "../../i18n"

// 層級是資料（值的 id 就是 log 自己的 level），標籤是文案：只放 key，
// 篩選列在 render 時才 `t()`——模組層常數不能在 import 時就把語言算死。
const LEVELS: Array<{ id: LogLevel | "all"; labelKey: MessageKey }> = [
  { id: "all", labelKey: "settings.log.levels.all" },
  { id: "error", labelKey: "settings.log.levels.error" },
  { id: "warning", labelKey: "settings.log.levels.warning" },
  { id: "info", labelKey: "settings.log.levels.info" },
  { id: "debug", labelKey: "settings.log.levels.debug" },
]

export function LogScreen() {
  const [level, setLevel] = useState<LogLevel | "all">("all")

  useSubscription(subscribeLog)

  const entries = [...logEntries()].reverse()
  const shown = level === "all" ? entries : entries.filter(entry => entry.level === level)

  return (
    <PageScroll title={t("settings.log.title")}>
      <CardGroup>
        <SelectRow
          icon="line.3.horizontal.decrease"
          iconColor={palette.indigo}
          title={t("settings.log.level")}
          value={level}
          options={LEVELS.map(item => ({ value: item.id, text: t(item.labelKey) }))}
          onChanged={next => {
            const match = LEVELS.find(item => item.id === next)
            if (match) setLevel(match.id)
          }}
        />

        <Divider padding={{ leading: rowSeparatorInset }} />
        <ActionRow
          icon="trash"
          iconColor={palette.red}
          title={t("settings.log.clear")}
          tone="destructive"
          onTap={clearLog}
        />
      </CardGroup>

      <StatusLine text={t("settings.log.count", { shown: shown.length, total: entries.length })} />

      {shown.length === 0 ? (
        <EmptyState icon="doc.text" title={t("settings.log.empty")} />
      ) : (
        <LazyVStack spacing={0} background={cardBackground} clipShape={cardShape} frame={{ maxWidth: "infinity" }}>
          {shown.slice(0, 300).map((entry, index) => (
            <VStack key={entry.id} spacing={0}>
              {index > 0 ? <Divider padding={{ leading: 16 }} /> : null}
              <LogRow entry={entry} />
            </VStack>
          ))}
        </LazyVStack>
      )}
    </PageScroll>
  )
}

function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <VStack alignment="leading" spacing={2} padding={denseRowPadding} frame={{ maxWidth: "infinity" }}>
      <HStack spacing={6} frame={{ maxWidth: "infinity" }}>
        <Text font="caption2" foregroundStyle={colorOf(entry.level)}>
          {entry.level.toUpperCase()}
        </Text>
        <Footnote>{entry.scope}</Footnote>
        <Spacer />
        <Footnote>{timeOf(entry.time)}</Footnote>
      </HStack>
      <Text font="footnote">{entry.message}</Text>
      {entry.detail ? <Caption>{entry.detail}</Caption> : null}
    </VStack>
  )
}

function colorOf(level: LogLevel): "systemRed" | "systemOrange" | "label" | "secondaryLabel" {
  if (level === "error") return "systemRed"
  if (level === "warning") return "systemOrange"
  if (level === "debug") return "secondaryLabel"
  return "label"
}

function timeOf(time: number): string {
  const date = new Date(time)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
