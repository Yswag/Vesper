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
} from "scripting"

import { type ComicSourceInfo } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { loadHistory, pushHistory, clearHistory } from "../../app/searchHistory"
import { loadSearchSelections } from "../../app/searchOptions"
import { setSearchTriggerListener } from "../../app/navigation"
import { LeadingToolbar } from "../../components/LeadingToolbar"
import { CoverImage } from "../../components/CoverImage"
import { WidthReporter } from "../../components/WidthReporter"
import { PageBackground } from "../../app/theme"
import { Card } from "../../design/layout"
import { Chevron } from "../../design/rows"
import { EmptyState } from "../../design/status"
import { fill, pageInsets, radius, rect, toneText } from "../../design/tokens"
import { type ComicListItem } from "../../engine/adapt"
import { isAbortError } from "../../engine/http"
import { log } from "../../engine/log"
import { type SourceSearchResult } from "../../sources/search"
import {
  decodeSearchOptions,
  encodeSearchOptions,
  type SearchOptionRow,
  type SearchOptionValue,
} from "../../sources/searchOptions"
import { SourceSearchResults } from "../browse/SourceSearchResults"
import { ComicDetailScreen } from "../shared/ComicDetailScreen"
import { bangumiCardSize, type CardSize } from "../shared/comicMetrics"

export function SearchScreen() {
  const library = comicLibrary()
  const [keyword, setKeyword] = useState("")
  const [submitted, setSubmitted] = useState("")
  const [results, setResults] = useState<SourceSearchResult[]>([])
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  // 每個源存下來的篩選（"sourceKey" → 送去源的 options 陣列）。
  // 這頁只讀不寫：篩選入口在單源搜尋頁，這裡只負責把存過的值帶進請求。
  const [selections, setSelections] = useState<Record<string, Array<string | null>>>({})
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
    setHistory(pushHistory(text))
    if (Keyboard.visible) Keyboard.hide()
    try {
      await library.search(
        { keyword: text, optionsOf: key => requestOf(key) },
        snapshot => {
          // 舊的一輪的進度可能還在飛回來的路上，對不上就丟掉。
          if (!current()) return
          setResults(snapshot.results)
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

  function handleKeywordChange(text: string) {
    setKeyword(text)
    if (text.trim() === "") {
      abortCurrentRun()
      runRef.current.id++
      setSubmitted("")
      setResults([])
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
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" }}
        toolbar={{ topBarLeading: <LeadingToolbar /> }}
        // 用系統的搜尋框（role="search" 的 tab 會把它放在底部、展開時收起其他 tab）。
        // 送出事件用 onSubmit(triggers: "search")：跨 30 個源跑一次要好幾秒，不適合逐字搜。
        searchable={{ value: keyword, onChanged: handleKeywordChange, prompt: t("search.keyword"), presented }}
        onSubmit={{ triggers: "search", action: () => void run(keyword) }}
      >
        {submitted.length === 0 ? (
          <HistoryPanel history={history} onPick={term => void run(term)} onClear={() => setHistory(clearHistory())} />
        ) : (
          <SearchResults sources={sources} results={results} running={running} term={submitted} />
        )}
      </VStack>
    </ZStack>
  )
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
      background={
        <GeometryReader>
          {geometry => <WidthReporter width={geometry.size.width} onWidth={w => setWidth(Math.round(w))} />}
        </GeometryReader>
      }
    >
      <VStack
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
      </VStack>
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
        <ScrollView axes="horizontal">
          <LazyHStack spacing={12} padding={{ horizontal: pageInsets.horizontal, vertical: 8 }}>
            {result.comics.map(comic => (
              <ResultCard key={comic.id} sourceKey={source.key} comic={comic} size={size} />
            ))}
          </LazyHStack>
        </ScrollView>
      ) : (
        <RowSkeleton size={size} />
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

// 骨架的字條：redacted 會把它畫成一塊灰。內容不會顯示。
const SKELETON_TEXT = "XXXXXXXX"

/** 還沒回來的源：跟真的那排同尺寸，結果到了版面不會跳。 */
function RowSkeleton({ size }: { size: CardSize }) {
  return (
    <ScrollView axes="horizontal" scrollDisabled={true}>
      <HStack spacing={12} padding={{ horizontal: pageInsets.horizontal, vertical: 8 }}>
        {[0, 1, 2, 3].map(index => (
          <VStack key={index} alignment="leading" spacing={6} frame={{ width: size.width }}>
            <VStack frame={{ width: size.width, height: size.height }} background={fill.surface} clipShape={rect(radius.md)} />
            <Text font="caption" fontWeight="medium" lineLimit={1} redacted="placeholder">
              {SKELETON_TEXT}
            </Text>
          </VStack>
        ))}
      </HStack>
    </ScrollView>
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
    <ScrollView scrollDismissesKeyboard="interactively">
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
