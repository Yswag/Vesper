// 搜尋頁面：包含左側來源清單（含結果計數）與右側漫畫網格，支援個別來源自訂篩選。

import { AbortController, Button, Divider, HStack, Image, RoundedRectangle, ScrollView, Spacer, Text, VStack, ZStack, useEffect, useRef, useObservable, useState } from "scripting"

import { type ComicSourceInfo } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { loadHistory, pushHistory, clearHistory } from "../../app/searchHistory"
import { loadSearchSelections, saveSearchSelection } from "../../app/searchOptions"
import { setSearchTriggerListener } from "../../app/navigation"
import { LeadingToolbar } from "../../components/LeadingToolbar"
import { ComicGrid, type ComicGridEntry } from "../../components/ComicGrid"
import { ActionRow } from "../../design/rows"
import { isAbortError } from "../../engine/http"
import { log } from "../../engine/log"
import { type SourceSearchResult } from "../../sources/search"
import {
  decodeSearchOptions,
  defaultSearchValues,
  encodeSearchOptions,
  hasCustomSearchOptions,
  type SearchOptionRow,
  type SearchOptionValue,
} from "../../sources/searchOptions"
import { SearchFilterSheet } from "./SearchFilterSheet"
import { sourceSidebarLabel } from "./sidebarLabel"
import { PageBackground } from "../../app/theme"
import { cardBackground, cardGap, fill, hairlineStroke, palette, radius, rect } from "../../design/tokens"

export function SearchScreen() {
  const library = comicLibrary()
  const [keyword, setKeyword] = useState("")
  const [submitted, setSubmitted] = useState("")
  const [results, setResults] = useState<SourceSearchResult[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [running, setRunning] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  // 每個源存下來的篩選（"sourceKey" → 送去源的 options 陣列）。
  const [selections, setSelections] = useState<Record<string, Array<string | null>>>({})
  const [filterKey, setFilterKey] = useState<string | null>(null)
  const [filterShown, setFilterShown] = useState(false)
  const [draft, setDraft] = useState<SearchOptionValue[]>([])
  /** 正在重跑篩選的那個源。 */
  const [rerunning, setRerunning] = useState<string | null>(null)
  // 搜尋框展開狀態由系統綁定（勿手動設為 false，否則將觸發取消並切換分頁）
  const presented = useObservable(false)

  /**
   * 搜尋輪次管理（epoch + AbortController）：新關鍵字或離開畫面時作廢舊輪次並中止請求。
   */
  const runRef = useRef({ id: 0, controller: null as AbortController | null })

  // 訂閱來源異動與語言切換
  useSubscription(library.onChange, subscribeLocale)
  const sources = library.sources()

  useEffect(() => {
    setHistory(loadHistory())
    setSelections(loadSearchSelections())

    setSearchTriggerListener(kw => {
      void run(kw)
    })
    return () => {
      // 離開畫面：這一輪作廢（id 一換，回來的東西就不會再 setState）並取消在飛的請求。
      runRef.current.id++
      abortCurrentRun()
      setSearchTriggerListener(null)
    }
  }, [])

  function abortCurrentRun() {
    runRef.current.controller?.abort()
    runRef.current.controller = null
  }

  async function run(term: string) {
    const text = term.trim()
    if (!text) return
    const list = library.sources()
    if (list.length === 0) {
      log("warning", "search", "沒有已啟用的源")
      return
    }

    // 新的一輪：先把上一輪取消（在飛的請求真的中止，排隊中的源不再派出）。
    abortCurrentRun()
    const id = ++runRef.current.id
    const controller = new AbortController()
    runRef.current.controller = controller
    /** 這一批回來的東西還算不算數。 */
    const current = () => runRef.current.id === id

    setKeyword(text)
    setSubmitted(text)
    setRunning(true)
    setResults([])
    setSelected(null)
    setProgress({ done: 0, total: list.length })
    setHistory(pushHistory(text))
    if (Keyboard.visible) Keyboard.hide()
    try {
      await library.search(
        { keyword: text, optionsOf: key => requestOf(key) },
        snapshot => {
          // 舊的一輪的進度可能還在飛回來的路上，對不上就丟掉。
          if (!current()) return
          setResults(snapshot.results)
          setProgress({ done: snapshot.done, total: snapshot.total })
        },
        { signal: controller.signal }
      )
    } catch (error) {
      // 取消是正常結束（結果由 epoch 丟掉）；其他錯誤留一筆 warning，不要靜默。
      if (!isAbortError(error)) log("warning", "search", `「${text}」搜尋未完成`, error)
    } finally {
      if (current()) {
        setRunning(false)
        runRef.current.controller = null
      }
    }
  }

  /** 這個源的篩選列（庫給的 domain 資料，不再碰源的 instance）。 */
  function rowsOf(key: string): SearchOptionRow[] {
    return library.source(key)?.searchOptions ?? []
  }

  /** 這個源目前的篩選（存過的優先，否則源的預設）。 */
  function valuesOf(key: string): SearchOptionValue[] {
    return decodeSearchOptions(rowsOf(key), selections[key])
  }

  /** 送去源的那個 options 陣列。 */
  function requestOf(key: string): Array<string | null> {
    return encodeSearchOptions(rowsOf(key), valuesOf(key))
  }

  function openFilter(key: string) {
    setFilterKey(key)
    setDraft(valuesOf(key))
    setFilterShown(true)
  }

  function applyFilter() {
    const key = filterKey
    setFilterShown(false)
    if (!key) return
    const options = encodeSearchOptions(rowsOf(key), draft)
    saveSearchSelection(key, options)
    setSelections(previous => ({ ...previous, [key]: options }))
    void rerunSource(key, options)
  }

  /** 改完篩選只重跑這一個源，其他 29 個不動。 */
  async function rerunSource(key: string, options: Array<string | null>) {
    if (!submitted) return
    const id = runRef.current.id
    setRerunning(key)
    try {
      // 跟著這一輪的 controller：離開畫面或換關鍵字時，這個重跑也會被取消。
      const result = await library.searchSource(key, submitted, options, {
        signal: runRef.current.controller?.signal,
      })
      // 這一輪已經被換掉了（使用者又搜了別的關鍵字）→ 不要把它併進新的結果。
      if (runRef.current.id !== id) return
      setResults(previous =>
        previous.some(item => item.key === result.key)
          ? previous.map(item => (item.key === result.key ? result : item))
          : previous.concat(result)
      )
    } catch (error) {
      if (!isAbortError(error)) log("warning", "search", `${key} 重新搜尋失敗`, error)
    } finally {
      setRerunning(null)
    }
  }

  const byKey = new Map(results.map(result => [result.key, result]))
  const visible: ComicGridEntry[] = []
  for (const source of sources) {
    if (selected && source.key !== selected) continue
    const result = byKey.get(source.key)
    if (!result) continue
    for (const comic of result.comics) visible.push({ sourceKey: source.key, sourceName: source.name, comic })
  }

  const total = results.reduce((sum, result) => sum + result.comics.length, 0)
  const selectedInfo = selected ? sources.find(source => source.key === selected) : undefined
  const filterRows = selectedInfo ? selectedInfo.searchOptions : []
  const filterCustom = selectedInfo ? hasCustomSearchOptions(filterRows, valuesOf(selectedInfo.key)) : false
  const filterName = selectedInfo?.name ?? ""

  function handleKeywordChange(text: string) {
    setKeyword(text)
    if (text.trim() === "") {
      abortCurrentRun()
      runRef.current.id++
      setSubmitted("")
      setResults([])
      setSelected(null)
      setRunning(false)
    }
  }

  return (
    <ZStack>
      <PageBackground />
      <VStack
        spacing={0}
        navigationTitle={t("common.tabs.search")}
        navigationBarTitleDisplayMode="inline"
        toolbar={{ topBarLeading: <LeadingToolbar /> }}
        // 用系統的搜尋框（role="search" 的 tab 會把它放在底部、展開時收起其他 tab）。
        // 送出事件用 onSubmit(triggers: "search")：跨 30 個源跑一次要好幾秒，不適合逐字搜。
        searchable={{ value: keyword, onChanged: handleKeywordChange, prompt: t("search.keyword"), presented }}
        onSubmit={{ triggers: "search", action: () => void run(keyword) }}
        sheet={
          filterKey
            ? {
                isPresented: filterShown,
                onChanged: setFilterShown,
                content: (
                  <VStack
                    spacing={0}
                    frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
                    presentationBackground="clear"
                    glassEffect={{ glass: UIGlass.regular(), shape: rect(radius.sheet) }}
                    presentationDetents={["medium", "large"]}
                    presentationDragIndicator="visible"
                    presentationCornerRadius={24}
                  >
                    <HStack alignment="center" padding={{ top: 18, horizontal: 20, bottom: 12 }} spacing={12}>
                      <VStack alignment="leading" spacing={2}>
                        <Text font="headline" fontWeight="bold">
                          {t("search.filterTitle")}
                        </Text>
                        <Text font="caption2" foregroundStyle="secondaryLabel">
                          {filterName}
                        </Text>
                      </VStack>
                      <Spacer />
                      <Button title={t("search.filterApply")} buttonStyle="glassProminent" action={applyFilter} />
                    </HStack>

                    <SearchFilterSheet
                      rows={rowsOf(filterKey)}
                      values={draft}
                      onChanged={(index, value) =>
                        setDraft(previous => previous.map((item, at) => (at === index ? value : item)))
                      }
                    />

                    <VStack spacing={0} padding={{ bottom: 10 }}>
                      <Divider />
                      <ActionRow
                        icon="arrow.counterclockwise"
                        iconColor={palette.blue}
                        title={t("search.filterReset")}
                        onTap={() => setDraft(defaultSearchValues(rowsOf(filterKey)))}
                      />
                    </VStack>
                  </VStack>
                ),
              }
            : undefined
        }
      >
      {submitted.length === 0 ? (
        <HistoryPanel history={history} onPick={term => void run(term)} onClear={() => setHistory(clearHistory())} />
      ) : (
        <HStack spacing={0} frame={{ maxHeight: "infinity" }}>
          <SourceSidebar
            sources={sources}
            byKey={byKey}
            selected={selected}
            total={total}
            running={running}
            progress={progress}
            onSelect={setSelected}
          />
          <Divider />
          <VStack spacing={0} frame={{ maxWidth: "infinity" }}>
            {selectedInfo ? (
              <HStack spacing={6} padding={{ horizontal: 12, top: 4 }} alignment="center">
                <Text font="footnote" fontWeight="medium" foregroundStyle="secondaryLabel" lineLimit={1}>
                  {filterName}
                </Text>
                {filterCustom ? (
                  <Text font="caption2" foregroundStyle="tertiaryLabel">
                    {t("search.filterChanged")}
                  </Text>
                ) : null}
                <Spacer />
                {filterRows.length > 0 ? (
                  <Button buttonStyle="plain" action={() => openFilter(selectedInfo.key)} accessibilityLabel={t("search.filterLabel", { name: filterName })}>
                    <HStack spacing={4} frame={{ minHeight: 36 }}>
                      <Image systemName="line.3.horizontal.decrease" font={13} fontWeight="medium" foregroundStyle={palette.blue} />
                      <Text font="subheadline" fontWeight="medium" foregroundStyle={palette.blue}>
                        {rerunning === selectedInfo.key ? t("search.updating") : t("search.filter")}
                      </Text>
                    </HStack>
                  </Button>
                ) : null}
              </HStack>
            ) : null}

            {visible.length > 0 ? (
              <ComicGrid entries={visible} showSource={selected === null} />
            ) : (
              <VStack
                alignment="center"
                spacing={6}
                padding={{ top: 40 }}
                frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
                onTapGesture={() => {
                  if (Keyboard.visible) Keyboard.hide()
                }}
              >
                <Text foregroundStyle="secondaryLabel">
                  {running ? t("search.running", { done: progress.done, total: progress.total }) : t("search.noResults")}
                </Text>
              </VStack>
            )}
          </VStack>
        </HStack>
      )}
    </VStack>
  </ZStack>
  )
}

/** 側邊欄：全部 + 每個源，右對齊結果數。順序照源的順序，跑完不會跳位。 */
function SourceSidebar({
  sources,
  byKey,
  selected,
  total,
  running,
  progress,
  onSelect,
}: {
  sources: ComicSourceInfo[]
  byKey: Map<string, SourceSearchResult>
  selected: string | null
  total: number
  running: boolean
  progress: { done: number; total: number }
  onSelect: (key: string | null) => void
}) {
  const hasResults = byKey.size > 0
  return (
    <ScrollView frame={{ width: 110 }} scrollDismissesKeyboard="interactively">
      <VStack alignment="leading" spacing={2} padding={{ vertical: 6, horizontal: 4 }}>
        {hasResults || running ? (
          <SidebarRow label={t("search.all")} count={hasResults ? total : null} active={selected === null} onTap={() => onSelect(null)} />
        ) : null}

        {hasResults || running
          ? sources.map(source => {
              const result = byKey.get(source.key)
              const hasError = !!result?.error
              return (
                <SidebarRow
                  key={source.key}
                  label={source.name}
                  count={result ? (hasError ? 0 : result.comics.length) : null}
                  failed={hasError}
                  active={selected === source.key}
                  onTap={() => onSelect(source.key)}
                />
              )
            })
          : null}

        {hasResults || running ? null : (
          <Text font="caption" foregroundStyle="tertiaryLabel" padding={{ horizontal: 8 }}>
            {sources.length > 0 ? t("search.sourcesPending", { n: sources.length }) : t("search.noSources")}
          </Text>
        )}

        {running ? (
          <Text font="caption2" foregroundStyle="tertiaryLabel" padding={{ horizontal: 8, top: 6 }}>
            {progress.done}/{progress.total}
          </Text>
        ) : null}
      </VStack>
    </ScrollView>
  )
}

function SidebarRow({
  label,
  count,
  failed,
  active,
  onTap,
}: {
  label: string
  count: number | null
  failed?: boolean
  active: boolean
  onTap: () => void
}) {
  const hasHits = count != null && count > 0
  return (
    <Button
      action={onTap}
      buttonStyle="plain"
      frame={{ maxWidth: "infinity" }}
      accessibilityLabel={sourceSidebarLabel({ label, failed, count })}
      accessibilityAddTraits={active ? "isSelected" : undefined}
    >
      <HStack
        spacing={4}
        padding={{ horizontal: 8, vertical: 6 }}
        frame={{ maxWidth: "infinity", minHeight: 40 }}
        background={active ? fill.chip : "clear"}
        clipShape={rect(radius.chip)}
      >
        <Text
          font="footnote"
          lineLimit={1}
          foregroundStyle={failed ? "secondaryLabel" : active ? "label" : hasHits ? "label" : "secondaryLabel"}
        >
          {label}
        </Text>
        <Spacer />
        {failed ? (
          <Text font="caption2" fontWeight="semibold" foregroundStyle={palette.red}>
            !
          </Text>
        ) : count == null ? (
          <Text font="caption2" foregroundStyle="quaternaryLabel">
            …
          </Text>
        ) : count > 0 ? (
          <Text
            font="caption2"
            fontWeight={active ? "bold" : "medium"}
            foregroundStyle={active ? "accentColor" : "secondaryLabel"}
          >
            {String(count)}
          </Text>
        ) : (
          <Text font="caption2" foregroundStyle="quaternaryLabel">
            0
          </Text>
        )}
      </HStack>
    </Button>
  )
}

/** 搜尋前的狀態：只有歷史搜尋（Q34）。 */
function HistoryPanel({
  history,
  onPick,
  onClear,
}: {
  history: string[]
  onPick: (term: string) => void
  onClear: () => void
}) {
  if (history.length === 0) {
    return (
      <VStack
        alignment="center"
        spacing={6}
        padding={{ top: 40 }}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        onTapGesture={() => {
          if (Keyboard.visible) Keyboard.hide()
        }}
      >
        <Text foregroundStyle="secondaryLabel">{t("search.historyEmpty")}</Text>
      </VStack>
    )
  }
  return (
    <ScrollView scrollDismissesKeyboard="interactively">
      <VStack
        alignment="leading"
        spacing={12}
        padding={{ horizontal: 16, top: 12, bottom: 24 }}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        onTapGesture={() => {
          if (Keyboard.visible) Keyboard.hide()
        }}
      >
        <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
          <Text font="headline" fontWeight="bold">
            {t("search.history")}
          </Text>
          <Spacer />
          <Button action={onClear} buttonStyle="plain" accessibilityLabel={t("search.historyClear")}>
            <HStack spacing={4} alignment="center">
              <Image systemName="trash" font="caption" foregroundStyle="secondaryLabel" />
              <Text font="footnote" foregroundStyle="secondaryLabel">
                {t("common.clear")}
              </Text>
            </HStack>
          </Button>
        </HStack>

        <VStack
          spacing={0}
          background={cardBackground}
          clipShape={rect(radius.card)}
          overlay={<RoundedRectangle cornerRadius={radius.card} stroke={hairlineStroke} />}
          frame={{ maxWidth: "infinity" }}
        >
          {history.map((term, index) => (
            <VStack key={`${index}:${term}`} spacing={0} frame={{ maxWidth: "infinity" }}>
              <HStack
                spacing={10}
                alignment="center"
                padding={{ horizontal: 14, vertical: 11 }}
                background={fill.invisible}
                frame={{ maxWidth: "infinity", minHeight: 44 }}
                onTapGesture={() => {
                  if (Keyboard.visible) Keyboard.hide()
                  onPick(term)
                }}
              >
                <Image systemName="clock" font="subheadline" foregroundStyle="tertiaryLabel" />
                <Text font="body" lineLimit={1} foregroundStyle="label">
                  {term}
                </Text>
                <Spacer />
                <Image systemName="arrow.up.left" font="caption" foregroundStyle="tertiaryLabel" />
              </HStack>
              {index < history.length - 1 ? (
                <Divider padding={{ leading: 40 }} />
              ) : null}
            </VStack>
          ))}
        </VStack>
      </VStack>
    </ScrollView>
  )
}
