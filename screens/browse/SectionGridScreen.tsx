// 單一列表的完整大網格頁：分類 chip 與探索區塊的「查看全部 ›」都導到這裡。
//
// 三種進來的方式：
//   entry   ：從探索的某個區塊進來，往後翻頁靠 `loadExploreSections`。
//   target  ：從分類 chip 進來，帶著一個 `categoryComics.load` 的目標；
//             掛載時手上還沒有內容，先自動載第一頁再繼續。
//   search  ：首頁「filters」捷徑進來，空關鍵字＋源給的篩選描述子，分頁同樣走源的 search。
//
// target 進來時上面多一排源宣告的篩選列（`categoryComics.optionList`／`optionLoader`）：
// 列順序就是 `load` 的 options 順序，預設選每列第一項，換選項就從第一頁重載。

import { HStack, ScrollView, VStack, ZStack, useEffect, useState } from "scripting"

import type { ComicListItem, ComicSection, JumpTarget, SectionPage } from "../../engine/adapt"
import { type CategoryOptionRow, type ExploreEntry, type HomeListing } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { ComicGridLayout } from "../../components/ComicGrid"
import { Chip, ChipRow } from "../../design/chip"
import { scrollTopBar } from "../../design/glass"
import { EmptyState, ListFooter, NoticeBanner, PageLoading } from "../../design/status"
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
  /** 探索分類；從分類頁（chips）進來時沒有，翻頁只靠 `section.more`。 */
  entry?: ExploreEntry
  /** 初始區塊；分類頁進來時是空的，掛載後自動載第一頁。 */
  section?: ComicSection
  initialMore?: MoreSource
  /** 首頁元件帶回來的 listing：整頁就是那條 listing 的網格（掛載後自動載第一頁）。 */
  listing?: HomeListing
  /** 首頁篩選捷徑：空關鍵字＋源給的篩選描述子，整頁就是這個搜尋的分頁。 */
  search?: { keyword: string; filters: unknown[] }
  /** 導覽列標題；listing／search 進來時由呼叫端給名稱（同一個目標的元件可能標題不同）。 */
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
  // 畫面自己訂閱語言：導覽列標題與下面的字在 render 時取自 `t()`，換語言要重繪才算數。
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

  /** 篩選列的選項要跟著目標走，不然翻到第 2 頁就會退回源的預設值。 */
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
    // target 的頁碼存在 state 裡：直接回 entryPaging 的話永遠停在同①頁。
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
      // 探索區塊的「查看全部」進來時手上已經有第一頁了，先留著（有篩選列才重載）。
      void openCategory(categoryTarget, section.comics.length > 0)
      return
    }
    // 分類頁進來時手上沒有內容，先自動抓第一頁（entry 型的翻頁不能在這裡起頭）。
    if (section.comics.length === 0 && more.kind === "target") void loadMore()
  }, [])

  /** 進分類頁：先讀篩選列，再帶著預設選項載第一頁。 */
  async function openCategory(base: JumpTarget, keepExisting = false) {
    const loaded = await library.categoryOptionRows(sourceKey, base)
    // 沒有篩選列就一切照舊，不要為了空手重打一次。
    if (keepExisting && loaded.length === 0) return
    const values = initialOptionValues(loaded)
    setRows(loaded)
    setSelected(values)
    await reload(base, values)
  }

  /** 換分類／換篩選：清空後從第一頁重載。 */
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
      // listings／篩選結果失敗就不自動重試（不然捲到底會一直重打）。
      if (listing) setListingPage(-1)
      if (search) setSearchPage(-1)
    } finally {
      setLoadingMore(false)
    }
  }

  /** 收下這一頁，回報下一頁的頁碼（-1＝到底了）：有 maxPage 就信它，沒有就看這頁有沒有新東西。 */
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
        // 篩選列浮在內容上：掛在外層，載入中／0 筆時也還在。
        {...scrollTopBar(filterBar)}
      >
      {status ? (
        <VStack padding={{ horizontal: pageInsets.horizontal, top: 12 }} frame={{ maxWidth: "infinity" }}>
          <NoticeBanner tone="error" text={status} />
        </VStack>
      ) : null}

      {section.comics.length === 0 && loadingMore ? (
        <PageLoading />
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
