// 搜尋頁面：送出關鍵字後，每個源一排（標題列＋橫向卡片排），順序照源清單；
// 0 筆與失敗的源不佔主清單，收在最底一個可展開的區塊。

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

/** 搜尋中：進度最多每 300ms 上一次畫面（合併更新）。 */
const PROGRESS_FLUSH_MS = 300

/** 結果區看到的狀態；每次 commit 換一個新的物件。 */
export interface SearchSnapshot {
  /** 每次 commit +1：晚到的非同步結果拿舊版號比對就知道自己過期了。 */
  version: number
  /** 這一輪的關鍵字；空字串＝還沒搜尋（結果區顯示歷史）。 */
  term: string
  results: SourceSearchResult[]
  running: boolean
  history: string[]
}

/** 搜尋歷史的讀寫（畫面接真的儲存，探針接假的）。 */
export interface SearchHistoryStore {
  load: () => string[]
  push: (term: string) => string[]
  clear: () => string[]
}

/**
 * store 對外的依賴。畫面接真的 `ComicLibrary`，探針接假的——
 * 「換了關鍵字之後晚到的結果寫不進來」就是在這一層驗的。
 */
export interface SearchStoreDeps {
  /** 派一輪搜尋；每完成一個源就呼叫 `onProgress`（整份快照），`signal` 取消。 */
  run: (keyword: string, onProgress: (results: SourceSearchResult[]) => void, signal: AbortSignal) => Promise<unknown>
  /** 這一頁要顯示哪些源（順序決定排法，還沒回來的畫骨架）。 */
  sources: () => ComicSourceInfo[]
  history: SearchHistoryStore
  /** 送出時把關鍵字寫回搜尋框的草稿。 */
  setDraft: (keyword: string) => void
}

/**
 * 一輪聚合搜尋的狀態。**每個畫面實例一份**（兩個搜尋頁同時開著時各有一份結果，
 * 晚到的回呼也只進得去自己那一份）；結果區自己訂閱，打字不會碰到它。
 */
export interface SearchStore {
  /** 給 `useSubscription`。 */
  subscribe: (notify: () => void) => () => void
  read: () => SearchSnapshot
  /** 送出關鍵字（歷史、草稿、取消上一輪都在這裡）。 */
  submit: (keyword: string) => void
  /** 搜尋框被清掉：作廢這一輪、丟掉結果。 */
  clear: () => void
  /** 清空搜尋歷史（歷史面板那顆按鈕）。 */
  clearHistory: () => void
  /** 離開畫面：作廢這一輪並取消在飛的請求。 */
  dispose: () => void
}

export function createSearchStore(deps: SearchStoreDeps): SearchStore {
  let version = 0
  /** 輪次序號：新的一輪、清空、離開畫面都 +1；晚到的回呼帶著舊號，直接被擋掉。 */
  let epoch = 0
  let term = ""
  let results: SourceSearchResult[] = []
  let running = false
  // 歷史在建立 store 時就讀好：畫面第一幀就要看得到，不能等 effect（那時結果區已經畫完了）。
  let history: string[] = deps.history.load()
  let snapshot: SearchSnapshot = { version, term, results, running, history }
  const listeners = new Set<() => void>()
  let controller: AbortController | null = null
  /** 還沒沖出去的最新進度快照（合併更新用）。 */
  let pending: SourceSearchResult[] | null = null
  /** 排定的沖出計時器；0 是合法 handle，判斷用 `!== null`。 */
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

  /** 取消排定的沖出，並丟掉還沒沖出去的快照。 */
  function cancelFlush(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    pending = null
  }

  async function runRound(text: string): Promise<void> {
    // 新的一輪：先把上一輪取消（在飛的請求真的中止，排隊中的源不再派出），
    // 上一輪還沒沖出去的進度一併丟掉。
    abortCurrentRun()
    cancelFlush()
    const id = ++epoch
    const abort = new AbortController()
    controller = abort
    /** 這一批回來的東西還算不算數。 */
    const current = () => epoch === id

    term = text
    results = []
    running = true
    commit()

    // 進度一次一源回來：先放著，最多每 300ms 才寫一次（trailing）。
    // 不然 30 個源就是幾秒內 30 次重繪，搜尋中滑動會卡。
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
          // 舊的一輪的進度可能還在飛回來的路上，對不上就丟掉。
          if (!current()) return
          pending = progress
          if (flushTimer === null) flushTimer = setTimeout(flush, PROGRESS_FLUSH_MS)
        },
        abort.signal
      )
    } catch (error) {
      // 取消是正常結束（結果由 epoch 丟掉）；其他錯誤留一筆 warning，不要靜默。
      if (!isAbortError(error)) log("warning", "search", `「${text}」搜尋未完成`, error)
    } finally {
      if (current()) {
        // 這一輪結束：排定中的沖出作廢，直接補上最後一份結果。
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
      if (typeof Keyboard !== "undefined" && Keyboard.visible) Keyboard.hide()
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

/** 把這一頁接到共用的搜尋引擎（store 只認這幾個函式，探針換假的也能跑）。 */
function depsFor(library: ComicLibrary, setDraft: (keyword: string) => void): SearchStoreDeps {
  // 每個源存下來的篩選（"sourceKey" → 送去源的 options 陣列）。
  // 這頁只讀不寫：篩選入口在單源搜尋頁，這裡只負責把存過的值帶進請求。
  // 真的送出第一輪時才讀儲存，掛載時不必先讀一份用不到的。
  let selections: Record<string, Array<string | null>> | null = null

  /** 這個源的篩選列（庫給的 domain 資料，不再碰源的 instance）。 */
  const rowsOf = (key: string): SearchOptionRow[] => library.source(key)?.searchOptions ?? []

  /** 送去源的那個 options 陣列（存過的優先，否則源的預設）。 */
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
  /** 推入的用法（Mini Hub）：進頁就展開搜尋框。搜尋分頁由系統自己展開，不要給。 */
  autoFocus?: boolean
  /** 推入時從哪個 `matchedTransitionSource` zoom 出來。 */
  zoomFrom?: { sourceID: string; namespace: NamespaceID }
}) {
  const [keyword, setKeyword] = useState("")
  // 搜尋框展開狀態由系統綁定（勿手動設為 false，否則將觸發取消並切換分頁）。
  // 推入時第一幀就是展開的：鍵盤跟著轉場上來，不用等轉場完再補。
  const presented = useObservable(autoFocus)
  /** 這一頁自己的搜尋狀態：`keyword` 只是草稿，結果在 store 裡（結果區自己訂閱）。 */
  const storeRef = useRef<SearchStore | null>(null)
  if (storeRef.current === null) storeRef.current = createSearchStore(depsFor(comicLibrary(), setKeyword))
  const store = storeRef.current

  useEffect(() => {
    setSearchTriggerListener(term => store.submit(term))
    return () => {
      // 離開畫面：這一輪作廢並取消在飛的請求（store 只屬於這個實例）。
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
        // 用系統的搜尋框（role="search" 的 tab 會把它放在底部、展開時收起其他 tab）。
        // 送出事件用 onSubmit(triggers: "search")：跨 30 個源跑一次要好幾秒，不適合逐字搜。
        // 推入時搜尋框固定佔位：預設的會在轉場後才長出來，蓋在內容上再把內容推下去。
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

/**
 * 結果區：自己訂閱 store。打字只動草稿，這個元件的函式體不重跑，
 * 也不必把整份結果當 props 比一遍（props 只有一個每實例建立的 store）。
 */
function SearchOutcome({ store }: { store: SearchStore }) {
  const library = comicLibrary()
  // 源清單與語言變了要重排；結果本身由 store 通知。
  useSubscription(store.subscribe, library.onChange, subscribeLocale)
  const state = store.read()
  if (state.term.length === 0) {
    return <HistoryPanel history={state.history} onPick={store.submit} onClear={store.clearHistory} />
  }
  return <SearchResults sources={library.sources()} results={state.results} running={state.running} term={state.term} />
}

/** 一輪聚合搜尋的結果：每個源一排，順序照源清單（回來的先後不影響排法）。 */
export function SearchResults({
  sources,
  results,
  running,
  term,
  closedOpen = false,
}: {
  sources: ComicSourceInfo[]
  results: SourceSearchResult[]
  /** 這一輪還在跑：還沒回來的源先畫骨架排。 */
  running: boolean
  /** 推入單源結果頁時要重搜的關鍵字。 */
  term: string
  /** 底部收合區一開始就展開（預覽要拍展開的樣子）。 */
  closedOpen?: boolean
}) {
  // 每排一樣寬：整個捲動視窗量一次就夠，卡片尺寸沿用首頁 Bangumi 卡。
  const [width, setWidth] = useState(0)
  const size = bangumiCardSize(width)
  const byKey = new Map(results.map(result => [result.key, result]))
  const rows = sources.filter(source => {
    const result = byKey.get(source.key)
    return result === undefined ? running : result.comics.length > 0
  })
  const empty = results.filter(result => result.comics.length === 0 || !!result.error)
  const hits = results.reduce((sum, result) => sum + result.comics.length, 0)
  // 全部源都 0 筆：整頁空狀態；這一輪失敗的源仍然要能看得到，所以只留它們。
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

/** 一個源的排：整列推入該源的完整結果，下面是它的橫向卡片排（還沒回來就是骨架）。 */
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

/** 推入的那一頁：單源完整結果（它自己會用存過的篩選重搜一次）。 */
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

/** 結果卡：跟首頁橫向卡片排同一種（封面 lifted、書名靠左一行），不顯示源名（這一排就是那個源）。 */
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

/** 底部收合區：0 筆與失敗的源。失敗的那列帶 danger 小圖示，展開看得到原因。 */
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
        </Card>
      </VStack>
    </ScrollView>
  )
}
