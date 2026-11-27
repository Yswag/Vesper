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
import { type ExploreEntry, type SourceHome } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { ComicDetailScreen } from "../shared/ComicDetailScreen"
import { exploreCardSize } from "../shared/comicMetrics"
import { ComicGridLayout, ComicGridSkeleton } from "../../components/ComicGrid"
import { WidthReporter } from "../../components/WidthReporter"
import { SkeletonBlock, SkeletonText } from "../../design/skeleton"
import { CoverImage } from "../../components/CoverImage"
import { HomeSections, HomeSkeleton, visibleHomeComponents } from "./HomeSections"
import { SectionGridScreen } from "./SectionGridScreen"
import { PageBackground } from "../../app/theme"
import { CoverBadge } from "../../design/CoverBadge"
import { Chevron } from "../../design/rows"
import { EmptyState, ListFooter, NoticeBanner, type StatusKind } from "../../design/status"
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
  useSubscription(subscribeLocale)
  const [entries, setEntries] = useState<ExploreEntry[]>([])
  const [entriesLoading, setEntriesLoading] = useState(true)
  const [homeAvailable, setHomeAvailable] = useState(false)
  const [selection, setSelection] = useState(0)
  const [home, setHome] = useState<SourceHome | null>(null)
  const [homeLoading, setHomeLoading] = useState(false)
  const [homeError, setHomeError] = useState("")
  const [sections, setSections] = useState<ComicSection[]>([])
  const [activeSection, setActiveSection] = useState(0)
  const [entryPaging, setEntryPaging] = useState<MoreSource>(NO_MORE)
  const [targetPages, setTargetPages] = useState<Record<number, number>>({})
  const [busy, setBusy] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [status, setStatus] = useState<StatusKind>("ready")
  const [errorText, setErrorText] = useState("")
  const entryRun = useRef(0)
  const homeRun = useRef(0)

  const showHome = homeAvailable && selection === 0
  const listingIndex = homeAvailable ? selection - 1 : selection

  async function loadEntries() {
    const id = ++entryRun.current
    const current = () => entryRun.current === id
    setEntriesLoading(true)
    setErrorText("")
    try {
      const list = await library.explore(sourceKey)
      const available = library.hasHome(sourceKey)
      if (!current()) return
      setHomeAvailable(available)
      setSelection(0)
      setEntries(list)
    } catch (error) {
      if (!current()) return
      const available = library.hasHome(sourceKey)
      setHomeAvailable(available)
      setSelection(0)
      setEntries([])
      setErrorText("")
      if (!available) {
        setErrorText(error instanceof Error ? error.message : String(error))
        setStatus("error")
      }
    } finally {
      if (current()) setEntriesLoading(false)
    }
  }

  async function loadHome(reload = false) {
    const id = ++homeRun.current
    const current = () => homeRun.current === id
    setHomeLoading(true)
    setHomeError("")
    try {
      const layout = await library.home(sourceKey, { reload })
      if (current()) setHome(layout)
    } catch (error) {
      if (!current()) return
      setHomeError(error instanceof Error ? error.message : String(error))
    } finally {
      if (current()) setHomeLoading(false)
    }
  }

  useEffect(() => {
    setEntries([])
    setHomeAvailable(false)
    setHome(null)
    setHomeError("")
    setSelection(0)
    setSections([])
    void loadEntries()
    return () => {
      entryRun.current++
    }
  }, [sourceKey])

  useEffect(() => {
    if (showHome) {
      if (home === null && !homeLoading) void loadHome()
      return
    }
    if (entries.length === 0) return
    void loadFirst(entries[listingIndex])
  }, [sourceKey, selection, entries.length, homeAvailable])

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
        const page = await library.browse(sourceKey, { kind: "explore", index: entries[listingIndex].index }, current.cursor)
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

  const isMultiSection = sections.length > 1
  const singleSection = sections[0]
  const singleHasMore = singleSection ? moreOfSection(0).kind !== "none" : false
  const homeComponents = home ? visibleHomeComponents(home.components) : []

  const navTitle = library.source(sourceKey)?.name ?? t("browse.explore")

  const chipItems = [
    ...(homeAvailable ? [{ key: "home", title: t("browse.home"), index: 0 }] : []),
    ...entries.map(entry => ({
      key: `listing:${entry.index}`,
      title: entry.title,
      index: homeAvailable ? entry.index + 1 : entry.index,
    })),
  ]

  const chipRow =
    homeAvailable || chipItems.length > 1 ? (
      <ChipRow>
        {chipItems.map(item => (
          <Chip
            key={`chip:${item.key}`}
            text={item.title}
            selected={item.index === selection}
            onTap={() => setSelection(item.index)}
          />
        ))}
      </ChipRow>
    ) : null

  function homeContent() {
    if (homeLoading && home === null) return <HomeSkeleton />
    if (homeError) return <RetryBlock text={homeError} onRetry={() => void loadHome(true)} />
    if (home === null) return null
    if (homeComponents.length === 0) {
      return <EmptyState variant="page" icon="house" title={t("browse.homeEmpty")} />
    }
    return <HomeSections sourceKey={sourceKey} components={home.components} />
  }

  return (
    <ZStack>
      <PageBackground />
      <VStack
        spacing={0}
        navigationTitle={navTitle}
        navigationBarTitleDisplayMode="inline"
        frame={{ maxHeight: "infinity", alignment: "top" }}
      >
      {}
      <ScrollView
        key={`tab:${selection}`}
        scrollContentBackground="hidden"
        scrollDismissesKeyboard="interactively"
        {...scrollTopBar(chipRow)}
      >

        {}
        {showHome ? homeContent() : null}

        {}
        {!showHome && entries.length === 0 ? (
          entriesLoading ? (
            <ComicGridSkeleton />
          ) : errorText ? (
            <RetryBlock text={errorText} onRetry={() => void loadEntries()} />
          ) : homeAvailable ? null : (
            <EmptyState variant="page" icon="magnifyingglass" title={t("browse.searchOnly")} />
          )
        ) : null}

        {}
        {!showHome && entries.length > 0 && sections.length === 0 && !busy ? (
          status === "error" ? (
            <RetryBlock text={errorText} onRetry={() => void loadFirst(entries[listingIndex])} />
          ) : status === "empty" ? (
            <EmptyState variant="page" icon="magnifyingglass" title={t("browse.noResults")} />
          ) : null
        ) : null}

        {}
        {!showHome && busy && entries.length > 0 && sections.length === 0 ? (
          MULTI_PART_TYPES.has(entries[listingIndex]?.type ?? "") ? <MagazineSkeleton /> : <ComicGridSkeleton />
        ) : null}

        {!showHome && isMultiSection ? (
          <LazyVStack spacing={14} padding={{ top: 10, bottom: 44 }}>
            {sections.map((section, idx) => (
              <MagazineSectionRow
                key={`mag:${idx}:${section.title}`}
                sourceKey={sourceKey}
                entry={entries[listingIndex] ?? { index: 0, title: "", type: "", supportsNext: false }}
                section={section}
                initialMore={moreOfSection(idx)}
              />
            ))}
          </LazyVStack>
        ) : !showHome && singleSection ? (
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

const MULTI_PART_TYPES = new Set(["multiPartPage", "singlePageWithMultiPart"])

function MagazineSkeleton() {
  const [width, setWidth] = useState(0)
  const card = exploreCardSize(width)
  return (
    <VStack
      spacing={14}
      padding={{ top: 10, bottom: 44 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      accessibilityLabel={t("common.loading")}
      background={
        <GeometryReader>
          {geometry => <WidthReporter width={geometry.size.width} onWidth={value => setWidth(Math.round(value))} />}
        </GeometryReader>
      }
    >
      {width > 0
        ? [0, 1, 2].map(row => (
          <VStack key={row} spacing={4} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <HStack padding={{ horizontal: pageInsets.horizontal }} alignment="center">
              <SkeletonText font="title3" fontWeight="bold" length={2} />
              <Spacer />
            </HStack>
            <ScrollView axes="horizontal" scrollDisabled={true} scrollIndicator="hidden">
              <HStack spacing={12} padding={{ horizontal: pageInsets.horizontal, vertical: 12 }}>
                {[0, 1, 2, 3].map(index => (
                  <VStack key={index} alignment="leading" spacing={6} frame={{ width: card.width }}>
                    <SkeletonBlock width={card.width} height={card.height} />
                    <VStack alignment="leading" spacing={1.5}>
                      <SkeletonText font="footnote" fontWeight="medium" length={2} />
                      <SkeletonText font="caption2" length={1} />
                    </VStack>
                  </VStack>
                ))}
              </HStack>
            </ScrollView>
          </VStack>
        ))
        : null}
    </VStack>
  )
}

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
  const [carouselWidth, setCarouselWidth] = useState(0)
  const card = exploreCardSize(carouselWidth)

  return (
    <NamespaceReader>
      {exploreNs => (
        <VStack spacing={4}>
          {}
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

          {}
          <ScrollView
            axes="horizontal"
            scrollIndicator="hidden"
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
                      {}
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
                          <HStack
                            offset={{ x: -6, y: -6 }}
                            frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomTrailing" }}
                          >
                            <CoverBadge text={comic.updateTime} maxWidth={card.width - 12} />
                          </HStack>
                        ) : null}
                      </ZStack>

                      {}
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

                        {}
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
