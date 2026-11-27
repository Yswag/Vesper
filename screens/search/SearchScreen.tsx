import {
  AbortController,
  Button,
  Divider,
  GeometryReader,
  HStack,
  Image,
  LazyHStack,
  LazyVStack,
  NavigationLink,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
  useEffect,
  useObservable,
  useRef,
  useState,
  type AbortSignal,
} from "scripting"

import { type ComicLibrary, type ComicSourceInfo } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { loadHistory, pushHistory, clearHistory } from "../../app/searchHistory"
import { loadSearchSelections } from "../../app/searchOptions"
import { setSearchTriggerListener } from "../../app/navigation"
import { ExitToolbar } from "../../components/ExitToolbar"
import { CoverImage } from "../../components/CoverImage"
import { WidthReporter } from "../../components/WidthReporter"
import { PageBackground } from "../../app/theme"
import { scrollTopBar } from "../../design/glass"
import { Card } from "../../design/layout"
import { Chevron } from "../../design/rows"
import { EmptyState } from "../../design/status"
import { SkeletonCardRow } from "../../design/skeleton"
import { fill, pageInsets, radius, toneText } from "../../design/tokens"
import { type ComicListItem } from "../../engine/adapt"
import { isAbortError } from "../../engine/http"
import { log } from "../../engine/log"
import { type SourceSearchResult } from "../../sources/search"
import { decodeSearchOptions, encodeSearchOptions, type SearchOptionRow } from "../../sources/searchOptions"
import { SourceSearchResults } from "../browse/SourceSearchResults"
import { ComicDetailScreen } from "../shared/ComicDetailScreen"
import { bangumiCardSize, type CardSize } from "../shared/comicMetrics"

const PROGRESS_FLUSH_MS = 300

export interface SearchSnapshot {
  version: number
  term: string
  results: SourceSearchResult[]
  running: boolean
  history: string[]
}

export interface SearchHistoryStore {
  load: () => string[]
  push: (term: string) => string[]
  clear: () => string[]
}

export interface SearchStoreDeps {
  run: (keyword: string, onProgress: (results: SourceSearchResult[]) => void, signal: AbortSignal) => Promise<unknown>
  sources: () => ComicSourceInfo[]
  history: SearchHistoryStore
  setDraft: (keyword: string) => void
}

export interface SearchStore {
  subscribe: (notify: () => void) => () => void
  read: () => SearchSnapshot
  submit: (keyword: string) => void
  clear: () => void
  clearHistory: () => void
  dispose: () => void
}

export function createSearchStore(deps: SearchStoreDeps): SearchStore {
  let version = 0
  let epoch = 0
  let term = ""
  let results: SourceSearchResult[] = []
  let running = false
  let history: string[] = deps.history.load()
  let snapshot: SearchSnapshot = { version, term, results, running, history }
  const listeners = new Set<() => void>()
  let controller: AbortController | null = null
  let pending: SourceSearchResult[] | null = null
  let flushTimer: number | null = null

  function commit(): void {
    version += 1
    snapshot = { version, term, results, running, history }
    for (const listener of [...listeners]) listener()
  }

  function abortCurrentRun(): void {
    controller?.abort()
    controller = null
  }

  function cancelFlush(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    pending = null
  }

  async function runRound(text: string): Promise<void> {
    abortCurrentRun()
    cancelFlush()
    const id = ++epoch
    const abort = new AbortController()
    controller = abort
    const current = () => epoch === id

    term = text
    results = []
    running = true
    commit()

    const flush = () => {
      flushTimer = null
      const latest = pending
      pending = null
      if (latest && current()) {
        results = latest
        commit()
      }
    }

    try {
      await deps.run(
        text,
        progress => {
          if (!current()) return
          pending = progress
          if (flushTimer === null) flushTimer = setTimeout(flush, PROGRESS_FLUSH_MS)
        },
        abort.signal
      )
    } catch (error) {
      if (!isAbortError(error)) log("warning", "search", `「${text}」搜尋未完成`, error)
    } finally {
      if (current()) {
        const last = pending
        if (flushTimer !== null) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
        pending = null
        if (last) results = last
        running = false
        controller = null
        commit()
      }
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    read: () => snapshot,
    submit(raw) {
      const text = raw.trim()
      if (!text) return
      if (deps.sources().length === 0) {
        log("warning", "search", "沒有已啟用的源")
        return
      }
      deps.setDraft(text)
      history = deps.history.push(text)
      if (typeof Keyboard !== "undefined") Keyboard.hide()
      void runRound(text)
    },
    clear() {
      epoch += 1
      abortCurrentRun()
      cancelFlush()
      term = ""
      results = []
      running = false
      commit()
    },
    clearHistory() {
      history = deps.history.clear()
      commit()
    },
    dispose() {
      epoch += 1
      abortCurrentRun()
      cancelFlush()
      listeners.clear()
    },
  }
}

function depsFor(library: ComicLibrary, setDraft: (keyword: string) => void): SearchStoreDeps {
  let selections: Record<string, Array<string | null>> | null = null

  const rowsOf = (key: string): SearchOptionRow[] => library.source(key)?.searchOptions ?? []

  const requestOf = (key: string): Array<string | null> => {
    selections ??= loadSearchSelections()
    return encodeSearchOptions(rowsOf(key), decodeSearchOptions(rowsOf(key), selections[key]))
  }

  return {
    sources: () => library.sources(),
    run: (keyword, onProgress, signal) =>
      library.search({ keyword, optionsOf: requestOf }, progress => onProgress(progress.results), { signal }),
    history: { load: loadHistory, push: pushHistory, clear: clearHistory },
    setDraft,
  }
}

export function SearchScreen({
  autoFocus = false,
  zoomFrom,
}: {
  autoFocus?: boolean
  zoomFrom?: { sourceID: string; namespace: NamespaceID }
}) {
  const [keyword, setKeyword] = useState("")
  const presented = useObservable(autoFocus)
  const storeRef = useRef<SearchStore | null>(null)
  if (storeRef.current === null) storeRef.current = createSearchStore(depsFor(comicLibrary(), setKeyword))
  const store = storeRef.current

  useEffect(() => {
    setSearchTriggerListener(term => store.submit(term))
    return () => {
      store.dispose()
      setSearchTriggerListener(null)
    }
  }, [])

  function handleKeywordChange(text: string) {
    setKeyword(text)
    if (text.trim() === "") store.clear()
  }

  return (
    <ZStack navigationTransition={zoomFrom ? { type: "zoom", ...zoomFrom } : undefined}>
      <PageBackground />
      <VStack
        spacing={0}
        navigationTitle={t("common.tabs.search")}
        navigationBarTitleDisplayMode="inline"
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" }}
        toolbar={{ topBarLeading: <ExitToolbar /> }}
        searchable={{
          value: keyword,
          onChanged: handleKeywordChange,
          prompt: t("search.keyword"),
          presented,
          placement: autoFocus ? "navigationBarDrawerAlwaysDisplay" : undefined,
        }}
        onSubmit={{ triggers: "search", action: () => store.submit(keyword) }}
      >
        <SearchOutcome store={store} />
      </VStack>
    </ZStack>
  )
}

function SearchOutcome({ store }: { store: SearchStore }) {
  const library = comicLibrary()
  useSubscription(store.subscribe, library.onChange, subscribeLocale)
  const state = store.read()
  if (state.term.length === 0) {
    return <HistoryPanel history={state.history} onPick={store.submit} onClear={store.clearHistory} />
  }
  return <SearchResults sources={library.sources()} results={state.results} running={state.running} term={state.term} />
}

export function SearchResults({
  sources,
  results,
  running,
  term,
  closedOpen = false,
}: {
  sources: ComicSourceInfo[]
  results: SourceSearchResult[]
  running: boolean
  term: string
  closedOpen?: boolean
}) {
  const [width, setWidth] = useState(0)
  const size = bangumiCardSize(width)
  const byKey = new Map(results.map(result => [result.key, result]))
  const rows = sources.filter(source => {
    const result = byKey.get(source.key)
    return result === undefined ? running : result.comics.length > 0
  })
  const empty = results.filter(result => result.comics.length === 0 || !!result.error)
  const hits = results.reduce((sum, result) => sum + result.comics.length, 0)
  const allEmpty = !running && hits === 0
  const closed = allEmpty ? empty.filter(result => !!result.error) : empty

  if (sources.length === 0) {
    return <EmptyState variant="page" icon="tray" title={t("search.noSources")} />
  }

  return (
    <ScrollView
      scrollDismissesKeyboard="interactively"
      {...scrollTopBar(null)}
      background={
        <GeometryReader>
          {geometry => <WidthReporter width={geometry.size.width} onWidth={w => setWidth(Math.round(w))} />}
        </GeometryReader>
      }
    >
      <LazyVStack
        spacing={24}
        padding={{ top: 12, bottom: pageInsets.bottom }}
        frame={{ maxWidth: "infinity" }}
        onTapGesture={() => {
          if (Keyboard.visible) Keyboard.hide()
        }}
      >
        {allEmpty ? <EmptyState variant="page" icon="magnifyingglass" title={t("search.noResults")} /> : null}

        {rows.map(source => (
          <SourceRow key={source.key} source={source} result={byKey.get(source.key)} size={size} term={term} />
        ))}

        {closed.length > 0 ? <ClosedRows entries={closed} defaultOpen={closedOpen} /> : null}
      </LazyVStack>
    </ScrollView>
  )
}

function SourceRow({
  source,
  result,
  size,
  term,
}: {
  source: ComicSourceInfo
  result?: SourceSearchResult
  size: CardSize
  term: string
}) {
  return (
    <VStack spacing={4} frame={{ maxWidth: "infinity" }}>
      <NavigationLink
        destination={<SourceResultsScreen source={source} term={term} />}
        buttonStyle="plain"
        frame={{ maxWidth: "infinity" }}
        accessibilityLabel={t("search.openSource", { name: source.name })}
      >
        <HStack spacing={6} alignment="center" padding={{ horizontal: pageInsets.horizontal }} frame={{ maxWidth: "infinity" }}>
          <Text font="headline" fontWeight="bold" lineLimit={1}>
            {source.name}
          </Text>
          {result ? (
            <>
              <Text font="caption" foregroundStyle="tertiaryLabel">
                ·
              </Text>
              <Text font="footnote" foregroundStyle="secondaryLabel">
                {t("search.rowCount", { n: result.comics.length })}
              </Text>
            </>
          ) : null}
          <Spacer />
          <Chevron />
        </HStack>
      </NavigationLink>

      {result ? (
        <ScrollView axes="horizontal" scrollIndicator="hidden">
          <LazyHStack spacing={12} padding={{ horizontal: pageInsets.horizontal, vertical: 8 }}>
            {result.comics.map(comic => (
              <ResultCard key={comic.id} sourceKey={source.key} comic={comic} size={size} />
            ))}
          </LazyHStack>
        </ScrollView>
      ) : (
        <SkeletonCardRow size={size} />
      )}
    </VStack>
  )
}

function SourceResultsScreen({ source, term }: { source: ComicSourceInfo; term: string }) {
  return (
    <VStack
      spacing={0}
      navigationTitle={source.name}
      navigationBarTitleDisplayMode="inline"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    >
      <SourceSearchResults sourceKey={source.key} term={term} />
    </VStack>
  )
}

function ResultCard({ sourceKey, comic, size }: { sourceKey: string; comic: ComicListItem; size: CardSize }) {
  const { width, height } = size
  return (
    <NavigationLink
      destination={<ComicDetailScreen sourceKey={sourceKey} comicId={comic.id} title={comic.title} />}
      buttonStyle="plain"
    >
      <VStack alignment="leading" spacing={6} frame={{ width }}>
        <CoverImage
          sourceKey={sourceKey}
          url={comic.cover}
          width={width}
          height={height}
          cornerRadius={radius.md}
          title={comic.title}
          lifted
        />
        <Text
          font="caption"
          fontWeight="medium"
          foregroundStyle="label"
          lineLimit={1}
          multilineTextAlignment="leading"
          frame={{ width, alignment: "leading" }}
        >
          {comic.title}
        </Text>
      </VStack>
    </NavigationLink>
  )
}

function ClosedRows({ entries, defaultOpen = false }: { entries: SourceSearchResult[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const title = t("search.closedTitle", { n: entries.length })
  return (
    <VStack spacing={6} padding={{ horizontal: pageInsets.horizontal }} frame={{ maxWidth: "infinity" }}>
      <Button
        action={() => setOpen(!open)}
        buttonStyle="plain"
        frame={{ maxWidth: "infinity" }}
        accessibilityLabel={title}
        accessibilityAddTraits={open ? "isSelected" : undefined}
      >
        <HStack spacing={6} alignment="center" padding={{ vertical: 4 }} frame={{ maxWidth: "infinity" }}>
          <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={1}>
            {title}
          </Text>
          <Spacer />
          <Image
            systemName={open ? "chevron.up" : "chevron.down"}
            font="caption"
            fontWeight="semibold"
            foregroundStyle="tertiaryLabel"
          />
        </HStack>
      </Button>

      {open ? (
        <Card>
          {entries.map((entry, index) => (
            <VStack key={entry.key} spacing={0} frame={{ maxWidth: "infinity" }}>
              {index > 0 ? <Divider padding={{ leading: 14 }} /> : null}
              <VStack alignment="leading" spacing={2} padding={{ horizontal: 14, vertical: 10 }} frame={{ maxWidth: "infinity" }}>
                <HStack spacing={6} alignment="center" frame={{ maxWidth: "infinity" }}>
                  <Text font="subheadline" lineLimit={1}>
                    {entry.name}
                  </Text>
                  {entry.error ? (
                    <Image systemName="exclamationmark.triangle.fill" font="caption2" foregroundStyle={toneText.danger} />
                  ) : null}
                  <Spacer />
                </HStack>
                {entry.error ? (
                  <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={3}>
                    {entry.error}
                  </Text>
                ) : null}
              </VStack>
            </VStack>
          ))}
        </Card>
      ) : null}
    </VStack>
  )
}

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
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        onTapGesture={() => {
          if (Keyboard.visible) Keyboard.hide()
        }}
      >
        <EmptyState variant="page" icon="clock.arrow.circlepath" title={t("search.historyEmpty")} />
      </VStack>
    )
  }
  return (
    <ScrollView scrollDismissesKeyboard="interactively" {...scrollTopBar(null)}>
      <VStack
        alignment="leading"
        spacing={12}
        padding={{ horizontal: pageInsets.horizontal, top: 12, bottom: 24 }}
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
              <Image systemName="trash" font="caption" foregroundStyle={toneText.danger} />
              <Text font="footnote" foregroundStyle={toneText.danger}>
                {t("common.clear")}
              </Text>
            </HStack>
          </Button>
        </HStack>

        <Card>
          {history.map((term, index) => (
            <VStack key={`${index}:${term}`} spacing={0} frame={{ maxWidth: "infinity" }}>
              <HStack
                spacing={10}
                alignment="center"
                padding={{ horizontal: 14, vertical: 11 }}
                background={fill.invisible}
                frame={{ maxWidth: "infinity", minHeight: 44 }}
                onTapGesture={() => {
                  Keyboard.hide()
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
        </Card>
      </VStack>
    </ScrollView>
  )
}
