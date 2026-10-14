// 單一來源探索頁：支援分類膠囊切換、垂直分區橫向輪播（multiPart）與三欄網格（multiPage）。
// 導覽列搜尋框採 drawer 佈局，送出時針對當前來源發起搜尋。

import {
  AbortController,
  Button,
  Divider,
  GeometryReader,
  HStack,
  LazyHStack,
  NamespaceReader,
  NavigationLink,
  ProgressView,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
  useEffect,
  useRef,
  useState,
} from "scripting"

import type { ComicListItem, ComicSection, JumpTarget, SectionPage } from "../../engine/adapt"
import { isAbortError } from "../../engine/http"
import { type ExploreEntry } from "../../app/comic"
import { loadSearchSelections } from "../../app/searchOptions"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { decodeSearchOptions, encodeSearchOptions } from "../../sources/searchOptions"
import { ComicDetailScreen } from "../shared/ComicDetailScreen"
import { exploreCardSize } from "../shared/comicMetrics"
import { ComicGridLayout } from "../../components/ComicGrid"
import { WidthReporter } from "../../components/WidthReporter"
import { GlassBadge } from "../../design/GlassBadge"
import { CoverImage } from "../../components/CoverImage"
import { SectionGridScreen } from "./SectionGridScreen"
import { PageBackground } from "../../app/theme"
import { Chevron } from "../../design/rows"
import { ListFooter, PageLoading, type StatusKind } from "../../design/status"
import { Chip, ChipRow } from "../../design/chip"
import { radius, rect } from "../../design/tokens"

type Cursor = { page: number } | { next: string }

type MoreSource =
  | { kind: "entry"; cursor: Cursor }
  | { kind: "target"; target: JumpTarget; page: number }
  | { kind: "none" }

const NO_MORE: MoreSource = { kind: "none" }

function entryMore(page: SectionPage, used: Cursor): MoreSource {
  if (page.next) return { kind: "entry", cursor: { next: page.next } }
  if ("page" in used && typeof page.maxPage === "number" && used.page < page.maxPage) {
    return { kind: "entry", cursor: { page: used.page + 1 } }
  }
  return NO_MORE
}

export function ExploreScreen({ sourceKey }: { sourceKey: string }) {
  const library = comicLibrary()
  // 畫面自己訂閱語言：導覽列標題與下面的字都在 render 時取自 `t()`，換語言要重繪才算數。
  useSubscription(subscribeLocale)
  const [entries, setEntries] = useState<ExploreEntry[]>([])
  const [active, setActive] = useState(0)
  const [sections, setSections] = useState<ComicSection[]>([])
  const [activeSection, setActiveSection] = useState(0)
  const [entryPaging, setEntryPaging] = useState<MoreSource>(NO_MORE)
  const [targetPages, setTargetPages] = useState<Record<number, number>>({})
  const [busy, setBusy] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [status, setStatus] = useState<StatusKind>("ready")
  const [errorText, setErrorText] = useState("")
  // 搜尋框：`keyword` 是框裡的原文，`submitted` 是「這些結果屬於哪個關鍵字」（**送出才更新**）。
  // `hits` 是這個源回來的結果（`null` ＝還沒搜／已清空 → 內容區顯示探索）。
  const [keyword, setKeyword] = useState("")
  const [submitted, setSubmitted] = useState("")
  const [hits, setHits] = useState<ComicListItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState("")
  /**
   * 這一輪搜尋的 epoch（跟 SearchScreen 同一套）：每次重跑換一個 id＋一個 controller。
   * 換關鍵字、清空或離開畫面時舊的一輪作廢（回來的東西一律丟掉），在飛的請求真的被中止。
   */
  const searchRun = useRef({ id: 0, controller: null as AbortController | null })

  useEffect(() => {
    setEntries(library.explore(sourceKey))
  }, [sourceKey])

  useEffect(() => {
    if (entries.length === 0) return
    void loadFirst(entries[active])
  }, [sourceKey, active, entries.length])

  // 換源／離開畫面（切到分類／排行）：這一輪作廢（回來的東西不再寫 state），
  // 搜尋框與結果也不該跟著搬到下一個源去。
  useEffect(() => {
    return () => {
      abortSearch()
      searchRun.current.id++
      setKeyword("")
      setSubmitted("")
      setHits(null)
      setSearching(false)
      setSearchError("")
    }
  }, [sourceKey])

  /**
   * 這個源要帶的搜尋 options：跟搜尋分頁同一套（存過的篩選優先，否則是源的預設），
   * 不然同一個源的同一組關鍵字會在兩邊給出不同結果。沒宣告篩選的源就不必讀那個檔。
   */
  function searchOptions(): Array<string | null> {
    const rows = library.source(sourceKey)?.searchOptions ?? []
    if (rows.length === 0) return []
    return encodeSearchOptions(rows, decodeSearchOptions(rows, loadSearchSelections()[sourceKey]))
  }

  /** 收掉目前在飛的那一輪。 */
  function abortSearch() {
    searchRun.current.controller?.abort()
    searchRun.current.controller = null
  }

  /**
   * 搜尋框的每一次變動：**不搜**，只記在原字。清成空的就復原（回探索）。
   * 送出才真的打——源是對外網站（有的還有 WAF、速率限制），逐字搜會一連送好幾輪請求；
   * 搜尋分頁也是同一個理由用送出才跑。
   */
  function handleKeyword(text: string) {
    setKeyword(text)
    if (text.trim() !== "") return
    // 清掉關鍵字＝復原：這一輪作廢、內容區回到探索（分頁資料還在 state 裡，不必重載）。
    abortSearch()
    searchRun.current.id++
    setSubmitted("")
    setHits(null)
    setSearching(false)
    setSearchError("")
  }

  /** 送出（鍵盤的搜尋鍵）：現在框裡的字才去搜。 */
  function submitSearch() {
    const term = keyword.trim()
    if (!term) return
    // 結果拿到就收起鍵盤，讓出來給網格。
    if (Keyboard.visible) Keyboard.hide()
    void runSearch(term)
  }

  /** 搜這個源。失敗也回一筆（`error` 有值），取消則原樣丟上去（由 epoch 丟掉）。 */
  async function runSearch(term: string) {
    if (!term) return
    abortSearch()
    const id = ++searchRun.current.id
    const controller = new AbortController()
    searchRun.current.controller = controller
    const current = () => searchRun.current.id === id
    setSubmitted(term)
    setSearching(true)
    try {
      const result = await library.searchSource(sourceKey, term, searchOptions(), {
        signal: controller.signal,
      })
      if (!current()) return
      setSearchError(result.error ?? "")
      setHits(result.comics)
    } catch (error) {
      // 取消是正常結束；其他錯誤留在畫面上讓使用者看得到。
      if (!current() || isAbortError(error)) return
      setSearchError(error instanceof Error ? error.message : String(error))
      setHits([])
    } finally {
      if (current()) {
        setSearching(false)
        searchRun.current.controller = null
      }
    }
  }

  function moreOfSection(index: number): MoreSource {
    if (entryPaging.kind !== "none") return entryPaging
    const item = sections[index]
    if (!item?.more) return NO_MORE
    const page = targetPages[index] ?? 1
    return page < 0 ? NO_MORE : { kind: "target", target: item.more, page }
  }

  async function loadFirst(entry: ExploreEntry | undefined) {
    if (!entry) return
    const used: Cursor = { page: 1 }
    setBusy(true)
    setStatus("loading")
    setSections([])
    setActiveSection(0)
    setEntryPaging(NO_MORE)
    setTargetPages({})
    try {
      const page = await library.browse(sourceKey, { kind: "explore", index: entry.index }, used)
      setSections(page.sections.filter(item => item.comics.length > 0))
      setEntryPaging(entryMore(page, used))
      setStatus(page.sections.length === 0 ? "empty" : "ready")
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
      setStatus("error")
    } finally {
      setBusy(false)
    }
  }

  async function loadMoreSingleSection() {
    const index = 0
    const current = moreOfSection(index)
    if (loadingMore || current.kind === "none") return
    setLoadingMore(true)
    try {
      if (current.kind === "entry") {
        const page = await library.browse(sourceKey, { kind: "explore", index: entries[active].index }, current.cursor)
        appendComics(index, page.sections.flatMap(item => item.comics))
        setEntryPaging(entryMore(page, current.cursor))
      } else {
        const result = await library.browse(sourceKey, { kind: "category", target: current.target }, { page: current.page })
        const incoming = result.sections.flatMap(item => item.comics)
        const added = appendComics(index, incoming)
        const nextPage = current.page + 1
        const alive = result.maxPage != null ? nextPage <= result.maxPage : incoming.length > 0 && added > 0
        setTargetPages(previous => ({ ...previous, [index]: alive ? nextPage : -1 }))
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
      setStatus("error")
      setTargetPages(previous => ({ ...previous, [index]: -1 }))
    } finally {
      setLoadingMore(false)
    }
  }

  function appendComics(index: number, items: ComicListItem[]): number {
    const current = sections[index]
    if (!current) return 0
    const seen = new Set(current.comics.map(comic => comic.id))
    const fresh = items.filter(comic => !seen.has(comic.id))
    if (fresh.length === 0) return 0
    setSections(previous =>
      previous.map((item, i) => (i === index ? { ...item, comics: [...item.comics, ...fresh] } : item))
    )
    return fresh.length
  }

  // 顯示文字在 render 時才算：狀態只負責判斷。
  const message = status === "error" ? errorText : status === "empty" ? t("browse.noResults") : ""

  const isMultiSection = sections.length > 1
  const singleSection = sections[0]
  const singleHasMore = singleSection ? moreOfSection(0).kind !== "none" : false

  // 導覽列標題使用源的名稱，更具歸屬感與清晰感
  const navTitle = library.source(sourceKey)?.name ?? t("browse.explore")

  /** 結果已經拿到（＝送出去過一次）才把內容區換成搜尋結果。 */
  const searchMode = submitted.length > 0

  /**
   * 分類 chip 列（源有多個 explore 分類才有，放置於 ScrollView 內隨內容捲動）。
   */
  const chipRow =
    entries.length > 1 ? (
      <ChipRow>
        {entries.map(entry => (
          <Chip
            key={`chip:${entry.index}`}
            text={entry.title}
            selected={entry.index === active}
            onTap={() => setActive(entry.index)}
          />
        ))}
      </ChipRow>
    ) : null

  return (
    <ZStack>
      <PageBackground />
      <VStack
        spacing={0}
        navigationTitle={navTitle}
        navigationBarTitleDisplayMode="inline"
        // 靠頂對齊避免內容不足時被 ZStack 垂直置中
        frame={{ maxHeight: "infinity", alignment: "top" }}
        // 搜尋框採用系統 drawer 模式（下拉展開、滑動收起）
        searchable={{
          placement: "navigationBarDrawerAutomaticDisplay",
          prompt: t("browse.searchInSource", { name: navTitle }),
          value: keyword,
          onChanged: handleKeyword,
        }}
        // 送出（鍵盤的搜尋鍵）才真的打這個源。
        onSubmit={{ triggers: "search", action: submitSearch }}
      >
      {/* 內容區 */}
      {searchMode ? (
        <ScrollView scrollContentBackground="hidden" scrollDismissesKeyboard="interactively">
          <SearchResults
            sourceKey={sourceKey}
            hits={hits}
            searching={searching}
            error={searchError}
            onRetry={() => void runSearch(submitted)}
          />
        </ScrollView>
      ) : (
        <ScrollView scrollContentBackground="hidden" scrollDismissesKeyboard="interactively">
          {chipRow}

          {/* 錯誤或狀態提示 */}
          {message && sections.length === 0 ? (
            <MessageBlock text={message} onRetry={() => void loadFirst(entries[active])} />
          ) : null}

          {/* 載入初態 */}
          {busy && sections.length === 0 ? <PageLoading /> : null}

          {isMultiSection ? (
            /* 多區塊模式：垂直列表 + 橫向輪播 */
            <VStack spacing={14} padding={{ top: 10, bottom: 44 }}>
              {sections.map((section, idx) => (
                <MagazineSectionRow
                  key={`mag:${idx}:${section.title}`}
                  sourceKey={sourceKey}
                  entry={entries[active] ?? { index: 0, title: "", type: "", supportsNext: false }}
                  section={section}
                  initialMore={moreOfSection(idx)}
                />
              ))}
            </VStack>
          ) : singleSection ? (
            /* 單一區塊模式：3 欄網格與滾動分頁 */
            <VStack spacing={0}>
              {singleSection.title ? (
                <HStack padding={{ horizontal: 16, top: 12, bottom: 4 }}>
                  <Text font="headline" fontWeight="bold">
                    {singleSection.title}
                  </Text>
                  <Spacer />
                </HStack>
              ) : null}
              <ComicGridLayout
                entries={singleSection.comics.map(comic => ({ sourceKey, comic }))}
                onLastAppear={singleHasMore ? () => void loadMoreSingleSection() : undefined}
              />
              <ListFooter loading={singleHasMore} />
            </VStack>
          ) : null}
        </ScrollView>
      )}
    </VStack>
  </ZStack>
  )
}

/** 橫向輪播區塊列 */
function MagazineSectionRow({
  sourceKey,
  entry,
  section,
  initialMore,
}: {
  sourceKey: string
  entry: ExploreEntry
  section: ComicSection
  initialMore: MoreSource
}) {
  // 卡片寬照這條 carousel 的**捲動視窗**寬算（不是螢幕、也不是卡片自己的寬），見 dev/probe-carousel-width.tsx。
  const [carouselWidth, setCarouselWidth] = useState(0)
  const card = exploreCardSize(carouselWidth)

  return (
    <NamespaceReader>
      {exploreNs => (
        <VStack spacing={4}>
          {/* 標題欄 */}
          <NavigationLink
            destination={
              <SectionGridScreen
                sourceKey={sourceKey}
                entry={entry}
                section={section}
                initialMore={initialMore}
              />
            }
          >
            <HStack padding={{ horizontal: 16 }} alignment="center">
              <Text font="title3" fontWeight="bold" foregroundStyle="label">
                {section.title || t("browse.hotPicks")}
              </Text>
              <Spacer />
              <Chevron />
            </HStack>
          </NavigationLink>

          {/* 橫向滑動卡片架 */}
          <ScrollView
            axes="horizontal"
            background={
              <GeometryReader>
                {geometry => (
                  <WidthReporter
                    width={geometry.size.width}
                    onWidth={width => setCarouselWidth(Math.round(width))}
                  />
                )}
              </GeometryReader>
            }
          >
            <LazyHStack spacing={12} padding={{ horizontal: 16, vertical: 12 }}>
              {section.comics.map(comic => {
                const sourceID = `explore:${sourceKey}:${comic.id}`
                return (
                  <NavigationLink
                    key={`card:${sourceKey}:${comic.id}`}
                    destination={
                      <ComicDetailScreen
                        sourceKey={sourceKey}
                        comicId={comic.id}
                        title={comic.title}
                        zoomTransition={{ sourceID, namespace: exploreNs }}
                      />
                    }
                    buttonStyle="plain"
                  >
                    <VStack alignment="center" spacing={6} frame={{ width: card.width }}>
                      {/* 封面海報（1:1.48 經典劇集/電影海報比例） */}
                      <ZStack
                        alignment="bottomTrailing"
                        frame={{ width: card.width, height: card.height }}
                        shadow={{ color: "rgba(0, 0, 0, 0.32)", radius: 6, x: 0, y: 3 }}
                        matchedTransitionSource={{ id: sourceID, namespace: exploreNs }}
                      >
                        <CoverImage
                          sourceKey={sourceKey}
                          url={comic.cover}
                          width={card.width}
                          height={card.height}
                          cornerRadius={radius.cover}
                        />
                        {comic.updateTime ? (
                          // 更新時間徽章（夾寬度避免長字串超出封面）
                          <HStack
                            offset={{ x: -6, y: -6 }}
                            frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomTrailing" }}
                          >
                            <HStack
                              padding={{ horizontal: 6, vertical: 3 }}
                              background="ultraThinMaterial"
                              clipShape={rect(radius.tag)}
                              frame={{ maxWidth: card.width - 12, alignment: "trailing" }}
                            >
                              <Text font="caption2" fontWeight="semibold" foregroundStyle="label" lineLimit={1}>
                                {comic.updateTime}
                              </Text>
                            </HStack>
                          </HStack>
                        ) : null}
                      </ZStack>

                      {/* 文字區域：水平置中（Center）+ 單行嚴格截斷，字體微縮更精緻 */}
                      <VStack alignment="center" spacing={1.5} frame={{ width: card.width }}>
                        <Text
                          font="footnote"
                          fontWeight="medium"
                          foregroundStyle="label"
                          lineLimit={1}
                          frame={{ width: card.width, alignment: "center" }}
                        >
                          {comic.title}
                        </Text>

                        {/* 副標資訊：更新話數 / 標籤 / 作者（極小淡灰字，無內容則不佔位） */}
                        {comic.subtitle || (comic.tags && comic.tags[0]) ? (
                          <Text
                            font="caption2"
                            fontWeight="regular"
                            foregroundStyle="secondaryLabel"
                            lineLimit={1}
                            frame={{ width: card.width, alignment: "center" }}
                          >
                            {comic.subtitle || comic.tags![0]}
                          </Text>
                        ) : null}
                      </VStack>
                    </VStack>
                  </NavigationLink>
                )
              })}
            </LazyHStack>
          </ScrollView>
        </VStack>
      )}
    </NamespaceReader>
  )
}

/** 失敗時的一句話＋重試鈕（探索與搜尋共用：兩個狀態的形狀一模一樣）。 */
function MessageBlock({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <VStack alignment="center" spacing={12} padding={{ top: 60, horizontal: 20 }}>
      <Text foregroundStyle="secondaryLabel">{text}</Text>
      <Button title={t("browse.refresh")} systemImage="arrow.clockwise" action={onRetry} buttonStyle="glassProminent" />
    </VStack>
  )
}

/** 這個源的搜尋結果。用跟探索同一套網格，點進詳情與封面解析的行為完全一樣。 */
function SearchResults({
  sourceKey,
  hits,
  searching,
  error,
  onRetry,
}: {
  sourceKey: string
  /** `null` ＝還沒回來（去抖中／第一次搜尋）。 */
  hits: ComicListItem[] | null
  searching: boolean
  /** 源回的失敗原因（有值就不看結果）。 */
  error: string
  onRetry: () => void
}) {
  if (error) return <MessageBlock text={error} onRetry={onRetry} />
  // 尚無結果或重新搜尋中：顯示加載動畫
  if (hits === null || (searching && hits.length === 0)) return <PageLoading />
  if (hits.length === 0) {
    return (
      <VStack alignment="center" padding={{ top: 60, horizontal: 20 }}>
        <Text foregroundStyle="secondaryLabel">{t("browse.noResults")}</Text>
      </VStack>
    )
  }
  return (
    <VStack spacing={0}>
      {/* 已經有結果時再改關鍵字：舊的先留著，只在上面放一條進行中，免得整個網格閃掉。 */}
      {searching ? (
        <HStack spacing={8} padding={{ horizontal: 16, top: 10 }} frame={{ maxWidth: "infinity" }}>
          <ProgressView />
          <Text font="caption" foregroundStyle="secondaryLabel">
            {t("browse.searching")}
          </Text>
          <Spacer />
        </HStack>
      ) : null}
      <ComicGridLayout entries={hits.map(comic => ({ sourceKey, comic }))} />
    </VStack>
  )
}
