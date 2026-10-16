// 核心依賴子頁：cheerio／crypto-js 的狀態與重新安裝。
// 依賴只在啟動時檢查一次，壞掉時別處沒得修，所以源的錯誤訊息會指到這裡。
//
// 檢查排在 render 之後、逐項進行：`require` 是同步的，放在 render 裡會卡住推進來的那一幀。

import { Divider, VStack, useEffect, useState } from "scripting"

import {
  CORE_DEPENDENCIES,
  checkDependency,
  installMissingDependencies,
  type DependencyStatus,
} from "../../app/dependencies"
import { CardGroup, PageScroll } from "../../design/layout"
import { ActionRow, IconRow, rowSeparatorInset } from "../../design/rows"
import { NoticeBanner, StatusLine, statusTone, type StatusNotice } from "../../design/status"
import { palette } from "../../design/tokens"
import { t } from "../../i18n"

/** `installed === null` ＝還沒量到。 */
type RowState = { name: string; installed: boolean | null }

export function DependencyScreen() {
  const [deps, setDeps] = useState<DependencyStatus[]>([])
  // 上一輪檢查花多久（頁尾顯示）。
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const [runId, setRunId] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<StatusNotice | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: number | null = null
    let index = 0
    const started = Date.now()
    const step = () => {
      if (cancelled) return
      const status = checkDependency(CORE_DEPENDENCIES[index])
      const position = index
      setDeps(previous => {
        const next = previous.slice(0, position)
        next[position] = status
        return next
      })
      index++
      if (index < CORE_DEPENDENCIES.length) {
        timer = setTimeout(step, 0)
      } else {
        setElapsedMs(Date.now() - started)
      }
    }
    timer = setTimeout(step, 0)
    return () => {
      cancelled = true
      if (timer !== null) clearTimeout(timer)
    }
  }, [runId])

  async function reinstall() {
    if (busy || deps.length < CORE_DEPENDENCIES.length) return
    setBusy(true)
    setNotice({ kind: "loading", text: t("settings.deps.installing") })
    const ok = await installMissingDependencies()
    setNotice(
      ok
        ? { kind: "ready", text: t("settings.deps.installDone") }
        : { kind: "error", text: t("settings.deps.installFailed") }
    )
    // 裝完重檢一次。
    setDeps([])
    setElapsedMs(null)
    setRunId(id => id + 1)
    setBusy(false)
  }

  // 未量到的列先佔位，順序＝CORE_DEPENDENCIES。
  const rows: RowState[] = CORE_DEPENDENCIES.map((name, index) => deps[index] ?? { name, installed: null })

  return (
    <PageScroll title={t("settings.deps.title")}>
      {notice ? <NoticeBanner tone={statusTone(notice.kind)} text={notice.text} /> : null}

      <CardGroup title={t("settings.deps.title")} footnote={t("settings.deps.footnote")}>
        {rows.map((dep, index) => {
          const known = dep.installed !== null
          return (
            <VStack key={dep.name} spacing={0}>
              {index > 0 ? <Divider padding={{ leading: rowSeparatorInset }} /> : null}
              <IconRow
                icon={!known ? "hourglass" : dep.installed ? "checkmark.circle" : "exclamationmark.triangle"}
                iconColor={!known ? "secondaryLabel" : dep.installed ? palette.green : palette.red}
                title={dep.name}
                detail={t(
                  !known ? "settings.deps.checking" : dep.installed ? "settings.deps.installed" : "settings.deps.missing"
                )}
                detailColor={known && !dep.installed ? palette.red : "secondaryLabel"}
              />
            </VStack>
          )
        })}
        <Divider padding={{ leading: rowSeparatorInset }} />
        <ActionRow
          icon="arrow.clockwise"
          title={t("settings.shared.reinstall")}
          busy={busy}
          disabled={deps.length < CORE_DEPENDENCIES.length}
          onTap={() => void reinstall()}
        />
      </CardGroup>

      {elapsedMs === null ? null : <StatusLine text={t("settings.deps.timing", { ms: elapsedMs })} />}
    </PageScroll>
  )
}
