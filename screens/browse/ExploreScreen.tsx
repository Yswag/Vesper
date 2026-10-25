// 單一來源探索頁：支援分類膠囊切換、垂直分區橫向輪播（multiPart）與三欄網格（multiPage）。

import {
  GeometryReader,
  HStack,
  LazyHStack,
  LazyVStack,
  NamespaceReader,
  NavigationLink,
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
import { type ExploreEntry } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { ComicDetailScreen } from "../shared/ComicDetailScreen"
import { exploreCardSize } from "../shared/comicMetrics"
import { ComicGridLayout } from "../../components/ComicGrid"
import { WidthReporter } from "../../components/WidthReporter"
import { CoverImage } from "../../components/CoverImage"
import { SectionGridScreen } from "./SectionGridScreen"
import { PageBackground } from "../../app/theme"
import { CoverBadge } from "../../design/CoverBadge"
import { Chevron } from "../../design/rows"
import { EmptyState, ListFooter, NoticeBanner, PageLoading, type StatusKind } from "../../design/status"
import { Chip, ChipRow } from "../../design/chip"
import { scrollTopBar } from "../../design/glass"
import { pageInsets } from "../../design/tokens"

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
  const [entriesLoading, setEntriesLoading] = useState(true)
  const [active, setActive] = useState(0)
  const [sections, setSections] = useState<ComicSection[]>([])
  const [activeSection, setActiveSection] = useState(0)
  const [entryPaging, setEntryPaging] = useState<MoreSource>(NO_MORE)
  const [targetPages, setTargetPages] = useState<Record<number, number>>({})
  const [busy, setBusy] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [status, setStatus] = useState<StatusKind>("ready")
  const [errorText, setErrorText] = useState("")
  /** 這一輪 listings 的 epoch：換源或重試時舊的一輪作廢。 */
  const entryRun = useRef(0)

  /** 讀這一源的探索分類。Aidoku 要先讓源把 listings 載進來，所以整段是非同步的。 */
  async function loadEntries() {
    const id = ++entryRun.current
    const current = () => entryRun.current === id
    setEntriesLoading(true)
    setErrorText("")
    try {
      const list = await library.explore(sourceKey)
      if (current()) setEntries(list)
    } catch (error) {
      if (!current()) return
      setEntries([])
      setErrorText(error instanceof Error ? error.message : String(error))
      setStatus("error")
    } finally {
      if (current()) setEntriesLoading(false)
    }
  }

  useEffect(() => {
    setEntries([])
    void loadEntries()
    return () => {
      entryRun.current++
    }
  }, [sourceKey])

  useEffect(() => {
    if (entries.length === 0) return
    void loadFirst(entries[active])
  }, [sourceKey, active, entries.length])

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
  const isMultiSection = sections.length > 1
  const singleSection = sections[0]
  const singleHasMore = singleSection ? moreOfSection(0).kind !== "none" : false

  // 導覽列標題使用源的名稱，更具歸屬感與清晰感
  const navTitle = library.source(sourceKey)?.name ?? t("browse.explore")

  /**
   * 分類 chip 列（源有多個 explore 分類才有）：當捲動區頂部的 bar，貼在導覽列下面，內容從它後面捲過去。
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
      >
      {/* 內容區 */}
      <ScrollView
        scrollContentBackground="hidden"
        scrollDismissesKeyboard="interactively"
        // 頂部邊緣用柔和樣式：導覽列標題仍有底，但沒有硬邊。
        {...scrollTopBar(chipRow)}
      >

          {/* 沒有探索分類：載入中、讀失敗（可重試），或這個源真的只能搜尋 */}
          {entries.length === 0 ? (
            entriesLoading ? (
              <PageLoading />
            ) : errorText ? (
              <RetryBlock text={errorText} onRetry={() => void loadEntries()} />
            ) : (
              <EmptyState variant="page" icon="magnifyingglass" title={t("browse.searchOnly")} />
            )
          ) : null}

          {/* 讀失敗（可重試）或這個分類真的沒東西 */}
          {entries.length > 0 && sections.length === 0 && !busy ? (
            status === "error" ? (
              <RetryBlock text={errorText} onRetry={() => void loadFirst(entries[active])} />
            ) : status === "empty" ? (
              <EmptyState variant="page" icon="magnifyingglass" title={t("browse.noResults")} />
            ) : null
          ) : null}

          {/* 載入初態 */}
          {busy && entries.length > 0 && sections.length === 0 ? <PageLoading /> : null}

          {isMultiSection ? (
            /* 多區塊模式：垂直列表 + 橫向輪播 */
            <LazyVStack spacing={14} padding={{ top: 10, bottom: 44 }}>
              {sections.map((section, idx) => (
                <MagazineSectionRow
                  key={`mag:${idx}:${section.title}`}
                  sourceKey={sourceKey}
                  entry={entries[active] ?? { index: 0, title: "", type: "", supportsNext: false }}
                  section={section}
                  initialMore={moreOfSection(idx)}
                />
              ))}
            </LazyVStack>
          ) : singleSection ? (
            /* 單一區塊模式：3 欄網格與滾動分頁 */
            <VStack spacing={0}>
              {singleSection.title ? (
                <HStack padding={{ horizontal: pageInsets.horizontal, top: 12, bottom: 4 }}>
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
            <HStack padding={{ horizontal: pageInsets.horizontal }} alignment="center">
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
            <LazyHStack spacing={12} padding={{ horizontal: pageInsets.horizontal, vertical: 12 }}>
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
                    <VStack alignment="leading" spacing={6} frame={{ width: card.width }}>
                      {/* 封面海報（1:1.48 經典劇集/電影海報比例） */}
                      <ZStack
                        alignment="bottomTrailing"
                        frame={{ width: card.width, height: card.height }}
                        matchedTransitionSource={{ id: sourceID, namespace: exploreNs }}
                      >
                        <CoverImage
                          sourceKey={sourceKey}
                          url={comic.cover}
                          title={comic.title}
                          width={card.width}
                          height={card.height}
                          lifted
                        />
                        {comic.updateTime ? (
                          // 更新時間角標：源的原始字串，夾在封面寬度內才不會溢出。
                          <HStack
                            offset={{ x: -6, y: -6 }}
                            frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomTrailing" }}
                          >
                            <CoverBadge text={comic.updateTime} maxWidth={card.width - 12} />
                          </HStack>
                        ) : null}
                      </ZStack>

                      {/* 書名與副標靠左一行：同一排的卡片才會對齊 */}
                      <VStack alignment="leading" spacing={1.5} frame={{ width: card.width }}>
                        <Text
                          font="footnote"
                          fontWeight="medium"
                          foregroundStyle="label"
                          lineLimit={1}
                          multilineTextAlignment="leading"
                          frame={{ width: card.width, alignment: "leading" }}
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
                            multilineTextAlignment="leading"
                            frame={{ width: card.width, alignment: "leading" }}
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

/** 失敗時的一句說明＋重試膠囊。 */
function RetryBlock({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <VStack
      alignment="center"
      spacing={12}
      padding={{ top: 40, horizontal: pageInsets.horizontal }}
      frame={{ maxWidth: "infinity" }}
    >
      <NoticeBanner tone="error" text={text} />
      <Chip text={t("browse.refresh")} icon="arrow.clockwise" onTap={onRetry} />
    </VStack>
  )
}

