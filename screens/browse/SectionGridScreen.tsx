import { HStack, ScrollView, VStack, ZStack, useEffect, useState } from "scripting"

import type { ComicListItem, ComicSection, JumpTarget, SectionPage } from "../../engine/adapt"
import { type CategoryOptionRow, type ExploreEntry, type HomeListing } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { ComicGridLayout, ComicGridSkeleton } from "../../components/ComicGrid"
import { Chip, ChipRow } from "../../design/chip"
import { scrollTopBar } from "../../design/glass"
import { EmptyState, ListFooter, NoticeBanner } from "../../design/status"
import { Caption } from "../../design/text"
import { pageInsets } from "../../design/tokens"
import { initialOptionValues } from "../../sources/category"
import { PageBackground } from "../../app/theme"

type Cursor = { page: number } | { next: string }

export type MoreSource =
  | { kind: "entry"; cursor: Cursor }
  | { kind: "target"; target: JumpTarget; page: number }
  | { kind: "listing"; listing: HomeListing; page: number }
  | { kind: "search"; keyword: string; filters: unknown[]; page: number }
  | { kind: "none" }

const NO_MORE: MoreSource = { kind: "none" }

function entryMore(page: SectionPage, used: Cursor): MoreSource {
  if (page.next) return { kind: "entry", cursor: { next: page.next } }
  if ("page" in used && typeof page.maxPage === "number" && used.page < page.maxPage) {
    return { kind: "entry", cursor: { page: used.page + 1 } }
  }
  return NO_MORE
}

const EMPTY_SECTION: ComicSection = { title: "", comics: [] }

export interface SectionGridScreenProps {
  sourceKey: string
  entry?: ExploreEntry
  section?: ComicSection
  initialMore?: MoreSource
  listing?: HomeListing
  search?: { keyword: string; filters: unknown[] }
  title?: string
}

export function SectionGridScreen({
  sourceKey,
  entry,
  section: initialSection = EMPTY_SECTION,
  initialMore = NO_MORE,
  listing,
  search,
  title,
}: SectionGridScreenProps) {
  const library = comicLibrary()
  useSubscription(subscribeLocale)
  const categoryTarget = initialMore.kind === "target" ? initialMore.target : undefined
  const [section, setSection] = useState<ComicSection>(initialSection)
  const [entryPaging, setEntryPaging] = useState<MoreSource>(initialMore)
  const [target, setTarget] = useState<JumpTarget | undefined>(categoryTarget)
  const [rows, setRows] = useState<CategoryOptionRow[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [targetPage, setTargetPage] = useState<number>(initialMore.kind === "target" ? initialMore.page : 1)
  const [listingPage, setListingPage] = useState(1)
  const [searchPage, setSearchPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [status, setStatus] = useState("")

  function withOptions(base: JumpTarget): JumpTarget {
    if (rows.length === 0 || selected.length !== rows.length) return base
    return { ...base, attributes: { ...base.attributes, options: selected } }
  }

  function currentMore(): MoreSource {
    if (listing) return listingPage < 0 ? NO_MORE : { kind: "listing", listing, page: listingPage }
    if (search) {
      return searchPage < 0 ? NO_MORE : { kind: "search", keyword: search.keyword, filters: search.filters, page: searchPage }
    }
    if (entryPaging.kind === "entry") return entry ? entryPaging : NO_MORE
    const base = entryPaging.kind === "target" ? target : section.more
    if (!base) return NO_MORE
    return targetPage < 0 ? NO_MORE : { kind: "target", target: withOptions(base), page: targetPage }
  }

  const more = currentMore()
  const hasMore = more.kind !== "none"

  useEffect(() => {
    if (listing || search) {
      void loadMore()
      return
    }
    if (categoryTarget) {
      void openCategory(categoryTarget, section.comics.length > 0)
      return
    }
    if (section.comics.length === 0 && more.kind === "target") void loadMore()
  }, [])

  async function openCategory(base: JumpTarget, keepExisting = false) {
    const loaded = await library.categoryOptionRows(sourceKey, base)
    if (keepExisting && loaded.length === 0) return
    const values = initialOptionValues(loaded)
    setRows(loaded)
    setSelected(values)
    await reload(base, values)
  }

  async function reload(base: JumpTarget, options: string[]) {
    setLoadingMore(true)
    setStatus("")
    setSection(prev => ({ ...prev, comics: [] }))
    try {
      const result = await library.browse(
        sourceKey,
        { kind: "category", target: { ...base, attributes: { ...base.attributes, options } } },
        { page: 1 }
      )
      const incoming = result.sections.flatMap(item => item.comics)
      setSection(prev => ({ ...prev, comics: incoming }))
      const alive = result.maxPage != null ? 1 < result.maxPage : incoming.length > 0
      setTargetPage(alive ? 2 : -1)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
      setTargetPage(-1)
    } finally {
      setLoadingMore(false)
    }
  }

  function choose(index: number, value: string) {
    const next = selected.map((current, at) => (at === index ? value : current))
    setSelected(next)
    if (target) void reload(target, next)
  }

  async function loadMore() {
    if (loadingMore || more.kind === "none") return
    setLoadingMore(true)
    try {
      if (more.kind === "entry") {
        if (!entry) return
        const page = await library.browse(sourceKey, { kind: "explore", index: entry.index }, more.cursor)
        appendComics(page.sections.flatMap(item => item.comics))
        setEntryPaging(entryMore(page, more.cursor))
      } else if (more.kind === "listing") {
        const result = await library.browse(sourceKey, { kind: "listing", listing: more.listing }, { page: more.page })
        setListingPage(nextPageOf(result, more.page))
      } else if (more.kind === "search") {
        const result = await library.browse(
          sourceKey,
          { kind: "search", keyword: more.keyword, filters: more.filters },
          { page: more.page }
        )
        setSearchPage(nextPageOf(result, more.page))
      } else {
        const result = await library.browse(sourceKey, { kind: "category", target: more.target }, { page: more.page })
        setTargetPage(nextPageOf(result, more.page))
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
      setTargetPage(-1)
      if (listing) setListingPage(-1)
      if (search) setSearchPage(-1)
    } finally {
      setLoadingMore(false)
    }
  }

  function nextPageOf(result: SectionPage, used: number): number {
    const incoming = result.sections.flatMap(item => item.comics)
    const added = appendComics(incoming)
    const nextPage = used + 1
    const alive = result.maxPage != null ? nextPage <= result.maxPage : incoming.length > 0 && added > 0
    return alive ? nextPage : -1
  }

  function appendComics(items: ComicListItem[]): number {
    const seen = new Set(section.comics.map(comic => comic.id))
    const fresh = items.filter(comic => !seen.has(comic.id))
    if (fresh.length === 0) return 0
    setSection(prev => ({ ...prev, comics: [...prev.comics, ...fresh] }))
    return fresh.length
  }

  const filterBar = rows.length > 0 ? (
    <VStack spacing={0} frame={{ maxWidth: "infinity" }}>
      {rows.map((row, index) => (
        <VStack key={`option:${index}`} alignment="leading" spacing={0} frame={{ maxWidth: "infinity" }}>
          {row.label ? (
            <HStack padding={{ horizontal: 16 }}>
              <Caption>{row.label}</Caption>
            </HStack>
          ) : null}

          <ChipRow>
            {row.options.map(option => (
              <Chip
                key={`option:${index}:${option.value}:${option.label}`}
                text={option.label}
                selected={selected[index] === option.value}
                onTap={() => choose(index, option.value)}
              />
            ))}
          </ChipRow>
        </VStack>
      ))}
    </VStack>
  ) : null

  return (
    <ZStack>
      <PageBackground />
      <VStack
        spacing={0}
        navigationTitle={section.title || entry?.title || listing?.name || title || t("browse.all")}
        navigationBarTitleDisplayMode="inline"
        {...scrollTopBar(filterBar)}
      >
      {status ? (
        <VStack padding={{ horizontal: pageInsets.horizontal, top: 12 }} frame={{ maxWidth: "infinity" }}>
          <NoticeBanner tone="error" text={status} />
        </VStack>
      ) : null}

      {section.comics.length === 0 && loadingMore ? (
        <ScrollView scrollDisabled={true} scrollContentBackground="hidden">
          <ComicGridSkeleton />
        </ScrollView>
      ) : (
        <ScrollView scrollContentBackground="hidden">
          {section.comics.length === 0 ? (
            <EmptyState variant="page" icon="magnifyingglass" title={t("browse.noResults")} />
          ) : (
            <VStack spacing={0}>
              <ComicGridLayout
                entries={section.comics.map(comic => ({ sourceKey, comic }))}
                onLastAppear={hasMore ? () => void loadMore() : undefined}
              />

              <ListFooter loading={hasMore} />
            </VStack>
          )}
        </ScrollView>
      )}
    </VStack>
  </ZStack>
  )
}
