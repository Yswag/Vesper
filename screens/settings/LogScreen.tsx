// 日誌：相容層的每一次 HTTP、每一次解析、每一次例外都會落在這裡。
// 沒有這頁，「這個源壞了是源的錯還是 shim 的錯」只能瞎猜。

import { Divider, HStack, LazyVStack, Spacer, Text, VStack, useState } from "scripting"

import { useSubscription } from "../../app/useSubscription"

import { Card, CardGroup, PageScroll } from "../../design/layout"
import { ActionRow, SelectRow, rowSeparatorInset } from "../../design/rows"
import { EmptyState, StatusLine } from "../../design/status"
import { Caption, Footnote } from "../../design/text"
import { denseRowPadding } from "../../design/tokens"
import { clearLog, logEntries, subscribeLog, type LogEntry, type LogLevel } from "../../engine/log"
import { t } from "../../i18n"

const LEVELS: Array<{ id: LogLevel | "all"; label: string }> = [
  { id: "all", label: "ALL" },
  { id: "error", label: "ERROR" },
  { id: "warning", label: "WARN" },
  { id: "info", label: "INFO" },
  { id: "debug", label: "DEBUG" },
]

export function LogScreen() {
  const [level, setLevel] = useState<LogLevel | "all">("info")

  useSubscription(subscribeLog)

  const entries = [...logEntries()].reverse()
  const shown = level === "all" ? entries : entries.filter(entry => entry.level === level)

  return (
    <PageScroll title={t("settings.log.title")}>
      <CardGroup>
        <SelectRow
          icon="line.3.horizontal.decrease"
          title={t("settings.log.level")}
          value={level}
          options={LEVELS.map(item => ({ value: item.id, text: item.label }))}
          onChanged={next => {
            const match = LEVELS.find(item => item.id === next)
            if (match) setLevel(match.id)
          }}
        />

        <Divider padding={{ leading: rowSeparatorInset }} />
        <ActionRow
          icon="trash"
          title={t("settings.log.clear")}
          tone="destructive"
          onTap={clearLog}
        />
      </CardGroup>

      <StatusLine text={t("settings.log.count", { shown: shown.length, total: entries.length })} />

      {shown.length === 0 ? (
        <EmptyState variant="page" icon="doc.text" title={t("settings.log.empty")} />
      ) : (
        <Card>
          <LazyVStack spacing={0} frame={{ maxWidth: "infinity" }}>
            {shown.slice(0, 300).map((entry, index) => (
              <VStack key={entry.id} spacing={0}>
                {index > 0 ? <Divider padding={{ leading: 16 }} /> : null}
                <LogRow entry={entry} />
              </VStack>
            ))}
          </LazyVStack>
        </Card>
      )}
    </PageScroll>
  )
}

function levelText(level: LogLevel): string {
  if (level === "warning") return "WARN"
  return level.toUpperCase()
}

function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <VStack alignment="leading" spacing={2} padding={denseRowPadding} frame={{ maxWidth: "infinity" }}>
      <HStack spacing={6} frame={{ maxWidth: "infinity" }}>
        <Text font="caption2" foregroundStyle={colorOf(entry.level)}>
          {levelText(entry.level)}
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
