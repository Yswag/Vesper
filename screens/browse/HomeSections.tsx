// Aidoku 源首頁的元件版面：橫向捲動列（scroller）、大卡輪播（bigScroller）、漫畫列表／排行（mangaList）。
//
// 版面數字照原版 `Home/HomeComponents/*.swift`（出處寫在票 02 的 Comments）：
// 封面高度、ranking 編號、pageSize 分欄、看更多只出現在「有 listing」的元件。
// 顏色、圓角、字級、間距走 `design/`；imageScroller／links／filters／mangaChapterList 留給 03、04。

import {
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
  TabView,
  Text,
  VStack,
  ZStack,
  useEffect,
  useState,
  type VirtualNode,
} from "scripting"

import type { ComicListItem } from "../../engine/adapt"
import type { HomeComponent, HomeLink, HomeListing } from "../../app/comic"
import { useTint } from "../../app/theme"
import { Card } from "../../design/layout"
import { Chevron } from "../../design/rows"
import { Chip, ChipRow } from "../../design/chip"
import { Tag } from "../../design/Tag"
import { capsule, fill, pageInsets, pageSpacing, radius, rect, rowPadding } from "../../design/tokens"
import { CoverImage } from "../../components/CoverImage"
import { WidthReporter } from "../../components/WidthReporter"
import { ComicDetailScreen } from "../shared/ComicDetailScreen"
import { formatCommentTime } from "../shared/commentTime"
import { FilteredListScreen } from "./FilteredListScreen"
import { SectionGridScreen } from "./SectionGridScreen"

/** 原版 `HomeScrollerView.coverHeight`：180 高、2:3 封面。 */
const SCROLLER_COVER = { width: 120, height: 180 }
/** 原版 `HomeBigScrollerView.coverHeight`：170 高、2:3 封面；有標籤時整條再加 40。 */
const BIG_COVER = { width: 113, height: 170 }
const BIG_TAG_STRIP = 40
/** 原版 `HomeListView` 一列：100 高的 2:3 封面；`CollectionView.mangaListLayout` 的列高與列距。 */
const LIST_COVER = { width: 67, height: 100 }
const LIST_ROW_HEIGHT = 100
const LIST_ROW_GAP = 10
/** 原版 `mangaListLayout`：一頁要幾欄由容器寬除以 340 決定，每頁寬度是容器的 0.9。 */
const PAGE_COLUMN_BASIS = 340
const PAGE_WIDTH_RATIO = 0.9

/** 這一版畫得出來的全部元件。 */
export function visibleHomeComponents(components: HomeComponent[]): HomeComponent[] {
  return components.filter(component => {
    switch (component.type) {
      case "scroller":
      case "bigScroller":
      case "mangaList":
      case "mangaChapterList":
        return component.entries.length > 0
      case "imageScroller":
      case "links":
        return component.links.length > 0
      case "filters":
        return component.items.length > 0
      default:
        return false
    }
  })
}

export function HomeSections({ sourceKey, components }: { sourceKey: string; components: HomeComponent[] }) {
  return (
    <VStack spacing={pageSpacing} frame={{ maxWidth: "infinity" }} padding={{ top: 10, bottom: pageInsets.bottom }}>
      {visibleHomeComponents(components).map((component, index) => (
        <HomeSection key={`${component.type}:${index}`} sourceKey={sourceKey} component={component} />
      ))}
    </VStack>
  )
}

function HomeSection({ sourceKey, component }: { sourceKey: string; component: HomeComponent }) {
  switch (component.type) {
    case "imageScroller":
      return <ImageScrollerSection sourceKey={sourceKey} component={component} />
    case "bigScroller":
      return <BigScrollerSection sourceKey={sourceKey} component={component} />
    case "scroller":
      return <ScrollerSection sourceKey={sourceKey} component={component} />
    case "mangaList":
      return <MangaListSection sourceKey={sourceKey} component={component} />
    case "mangaChapterList":
      return <MangaChapterListSection sourceKey={sourceKey} component={component} />
    case "filters":
      return <FiltersSection sourceKey={sourceKey} component={component} />
    case "links":
      return <LinksSection sourceKey={sourceKey} component={component} />
    default:
      return null
  }
}

/**
 * 區塊標題：原版 `TitleView`——標題 `title3` 半粗、副標一行次要色；
 * 有 listing 才是「看更多」（右側箭頭＋整列可點，推 listing 的網格頁）。
 */
function SectionHeader({
  sourceKey,
  title,
  subtitle,
  listing,
}: {
  sourceKey: string
  title?: string
  subtitle?: string
  listing?: HomeListing
}) {
  if (!title) return null

  const head = (
    <HStack alignment="center" padding={{ horizontal: pageInsets.horizontal }} contentShape="rect">
      <VStack alignment="leading" spacing={2}>
        <Text font="title3" fontWeight="semibold" foregroundStyle="label" lineLimit={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={1}>
            {subtitle}
          </Text>
        ) : null}
      </VStack>
      <Spacer />
      {listing ? <Chevron /> : null}
    </HStack>
  )

  if (!listing) return head

  return (
    <NavigationLink
      destination={<SectionGridScreen sourceKey={sourceKey} listing={listing} title={title} />}
      buttonStyle="plain"
    >
      {head}
    </NavigationLink>
  )
}

/**
 * 首頁每一種元件（scroller／bigScroller／imageScroller／mangaList／links）的連結都走這裡：
 * 漫畫推詳情、listing 推該 listing 的網格、外部網址交給系統瀏覽器；沒有目標就不當按鈕（沒有按下回饋）。
 * 網址照原版只放行 http／https（`HomeScrollerView.swift:125-131`、`HomeLinksView.swift:51-56`）。
 */
function LinkTarget({ sourceKey, link, children }: { sourceKey: string; link: HomeLink; children: VirtualNode }) {
  const target = link.target
  if (!target) return <>{children}</>

  if (target.type === "url") {
    if (!isExternalUrl(target.url)) return <>{children}</>
    return (
      <Button buttonStyle="plain" action={() => void Safari.openURL(target.url)}>
        {children}
      </Button>
    )
  }

  if (target.type === "listing") {
    return (
      <NavigationLink
        destination={<SectionGridScreen sourceKey={sourceKey} listing={target.listing} title={link.title} />}
        buttonStyle="plain"
      >
        {children}
      </NavigationLink>
    )
  }

  return (
    <NavigationLink
      destination={<ComicDetailScreen sourceKey={sourceKey} comicId={target.manga.id} title={target.manga.title} />}
      buttonStyle="plain"
    >
      {children}
    </NavigationLink>
  )
}

/** 原版的守門：只放行 http／https，其他 scheme 一律不開。 */
function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** 這條連結真的按得下去嗎（沒有目標、或 url scheme 不支援都不算）。 */
function isActionable(link: HomeLink): boolean {
  const target = link.target
  if (!target) return false
  return target.type === "url" ? isExternalUrl(target.url) : true
}

/** 一條連結的封面網址：源給的橫幅圖優先，沒有就用漫畫自己的封面。 */
function coverOf(link: HomeLink): string | undefined {
  if (link.imageUrl) return link.imageUrl
  return link.target?.type === "manga" ? link.target.manga.cover : undefined
}

/**
 * 首頁輪播共用元件（bigScroller 與 imageScroller）：跟 `screens/home/HomeScreen.tsx` 的 hero 同一套——
 * TabView 綁 `tabIndex` 換頁、一次只排一個 setTimeout（handle 0 也要清）、離屏暫停、
 * 圓點底色不動只有一顆用 offset 滑動。`interval` 沒給就不自動播；手動換頁時 index 變了，
 * 下面的 effect 會重新起算間隔。
 */
function HomeCarousel({
  count,
  interval,
  height,
  renderPage,
}: {
  count: number
  interval?: number
  /** 一頁的高度（含內距）。 */
  height: number
  /** 第 `index` 頁的內容（頁面外框由這裡包）。 */
  renderPage: (index: number) => VirtualNode
}) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const current = Math.min(index, Math.max(0, count - 1))

  useEffect(() => {
    if (!interval || paused || count <= 1) return
    const timer = setTimeout(() => setIndex(previous => (previous + 1) % count), interval * 1000)
    return () => {
      if (timer !== null) clearTimeout(timer)
    }
  }, [current, paused, count, interval])

  return (
    <VStack spacing={4} frame={{ maxWidth: "infinity" }}>
      <TabView
        tabViewStyle="pageNeverDisplayIndex"
        tabIndex={current}
        onTabIndexChanged={setIndex}
        frame={{ height }}
        animation={{ animation: Animation.smooth({ duration: 0.4 }), value: current }}
        onAppear={() => setPaused(false)}
        onDisappear={() => setPaused(true)}
      >
        {Array.from({ length: count }, (_, page) => (
          <VStack key={String(page)} tag={page} spacing={0} frame={{ maxWidth: "infinity", height }}>
            {renderPage(page)}
          </VStack>
        ))}
      </TabView>

      {count > 1 ? <PageDots count={count} current={current} /> : null}
    </VStack>
  )
}

// ---------------------------------------------------------------- scroller

function ScrollerSection({ sourceKey, component }: { sourceKey: string; component: HomeComponent }) {
  if (component.type !== "scroller") return null
  // 原版：任何一條有副標就整排留副標的位置，卡片高度才會一致。
  const hasSubtitles = component.entries.some(entry => entry.subtitle !== undefined)

  return (
    <VStack spacing={6} frame={{ maxWidth: "infinity" }}>
      <SectionHeader sourceKey={sourceKey} title={component.title} subtitle={component.subtitle} listing={component.listing} />

      <ScrollView axes="horizontal" scrollIndicator="hidden">
        {/* LazyHStack：原版同樣用 lazy 的橫向堆疊，1245 筆的清單只建畫面上的那幾張。 */}
        <LazyHStack alignment="top" spacing={12} padding={{ horizontal: pageInsets.horizontal, vertical: 8 }}>
          {component.entries.map((entry, index) => (
            <LinkTarget key={`scroller:${index}:${entry.title}`} sourceKey={sourceKey} link={entry}>
              <VStack alignment="leading" spacing={6} frame={{ width: SCROLLER_COVER.width }}>
                <CoverImage
                  sourceKey={sourceKey}
                  url={coverOf(entry)}
                  title={entry.title}
                  width={SCROLLER_COVER.width}
                  height={SCROLLER_COVER.height}
                  lifted
                />
                <VStack alignment="leading" spacing={1} frame={{ width: SCROLLER_COVER.width, alignment: "leading" }}>
                  <Text
                    font="footnote"
                    fontWeight="medium"
                    foregroundStyle="label"
                    lineLimit={1}
                    multilineTextAlignment="leading"
                    frame={{ width: SCROLLER_COVER.width, alignment: "leading" }}
                  >
                    {entry.title}
                  </Text>
                  {entry.subtitle || hasSubtitles ? (
                    <Text
                      font="caption2"
                      foregroundStyle="secondaryLabel"
                      lineLimit={1}
                      frame={{ width: SCROLLER_COVER.width, alignment: "leading" }}
                    >
                      {entry.subtitle ?? ""}
                    </Text>
                  ) : null}
                </VStack>
              </VStack>
            </LinkTarget>
          ))}
        </LazyHStack>
      </ScrollView>
    </VStack>
  )
}

// ---------------------------------------------------------------- bigScroller

function BigScrollerSection({ sourceKey, component }: { sourceKey: string; component: HomeComponent }) {
  if (component.type !== "bigScroller") return null
  const entries = component.entries
  const hasTags = entries.some(entry => entry.tags.length > 0)
  // 原版：carouselHeight = coverHeight 170 ＋（有標籤 ? 40 : 0）。
  const height = BIG_COVER.height + (hasTags ? BIG_TAG_STRIP : 0)

  return (
    <VStack spacing={8} frame={{ maxWidth: "infinity" }}>
      <SectionHeader sourceKey={sourceKey} title={component.title} subtitle={component.subtitle} />
      <HomeCarousel
        count={entries.length}
        interval={component.autoScrollInterval}
        height={height}
        renderPage={page => (
          <BigScrollerPage sourceKey={sourceKey} entry={entries[page]} height={height} hasTags={hasTags} />
        )}
      />
    </VStack>
  )
}

/** 大卡的一頁：滿寬、固定高（170 ＋ 有標籤時 40）。 */
function BigScrollerPage({
  sourceKey,
  entry,
  height,
  hasTags,
}: {
  sourceKey: string
  entry: ComicListItem
  height: number
  hasTags: boolean
}) {
  return (
    <NavigationLink
      destination={<ComicDetailScreen sourceKey={sourceKey} comicId={entry.id} title={entry.title} />}
      buttonStyle="plain"
    >
      <VStack spacing={0} frame={{ maxWidth: "infinity", height }} dynamicTypeSize={{ to: "xxxLarge" }}>
        <HStack
          spacing={12}
          alignment="top"
          frame={{ maxWidth: "infinity", height: BIG_COVER.height }}
          padding={{ horizontal: pageInsets.horizontal }}
        >
          <CoverImage
            sourceKey={sourceKey}
            url={entry.cover}
            title={entry.title}
            width={BIG_COVER.width}
            height={BIG_COVER.height}
            lifted
          />
          <VStack alignment="leading" spacing={6} padding={{ vertical: 8 }} frame={{ maxWidth: "infinity" }}>
            <Text font="title3" fontWeight="semibold" foregroundStyle="label" lineLimit={3} multilineTextAlignment="leading">
              {entry.title}
            </Text>
            {entry.subtitle ? (
              <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={1}>
                {entry.subtitle}
              </Text>
            ) : null}
            {entry.description ? (
              <Text font="callout" foregroundStyle="secondaryLabel" lineLimit={3} multilineTextAlignment="leading">
                {entry.description}
              </Text>
            ) : null}
          </VStack>
        </HStack>

        {hasTags ? (
          <HStack spacing={6} padding={{ horizontal: pageInsets.horizontal }} frame={{ height: BIG_TAG_STRIP }}>
            {entry.tags.slice(0, 3).map(tag => (
              <Tag key={`tag:${tag}`} text={tag} />
            ))}
            <Spacer />
          </HStack>
        ) : null}
      </VStack>
    </NavigationLink>
  )
}

/** 大卡輪播的分頁點：6pt 圓點，目前那顆是強調色（跟首頁 hero 同一個寫法：底色不動，滑動的是那一顆）。 */
function PageDots({ count, current }: { count: number; current: number }) {
  const tint = useTint()
  const pitch = 16
  return (
    <HStack frame={{ maxWidth: "infinity" }}>
      <Spacer />
      <ZStack alignment="leading" frame={{ width: (count - 1) * pitch + 6, height: 6 }}>
        <HStack spacing={10} alignment="center" frame={{ height: 6 }}>
          {Array.from({ length: count }, (_, index) => (
            <VStack
              key={`dot:${index}`}
              frame={{ width: 6, height: 6 }}
              background={fill.glassNeutral}
              clipShape={capsule("circular")}
            />
          ))}
        </HStack>
        <VStack
          frame={{ width: 6, height: 6 }}
          background={tint.tint}
          clipShape={capsule("circular")}
          offset={{ x: current * pitch, y: 0 }}
          animation={{ animation: Animation.smooth({ duration: 0.3 }), value: current }}
        />
      </ZStack>
      <Spacer />
    </HStack>
  )
}

// ---------------------------------------------------------------- imageScroller

/**
 * 原版 `HomeImageScrollerView.swift:75`：高度沒給就是 140。
 * `width`／`height` 只當**比例**用（不當 pt）：顯示寬度固定是頁內可用寬度，高依比例算。
 */
const BANNER_HEIGHT = 140
/** 橫幅頁的上下內距（圓點與圖片之間留一點呼吸）。 */
const BANNER_PAGE_PADDING = 8
/** 還沒量到寬度時的退路（iPhone 寬）。 */
const BANNER_FALLBACK_WIDTH = 402

/** 只放橫幅圖的輪播（標題在區塊上方，圖上沒有文字）。 */
function ImageScrollerSection({ sourceKey, component }: { sourceKey: string; component: HomeComponent }) {
  if (component.type !== "imageScroller") return null
  const links = component.links
  const [viewport, setViewport] = useState(0)

  // 源給的 width／height 只拿來算比例；顯示寬度一律是頁內可用寬度（左右各扣 pageInsets）。
  const available = (viewport > 0 ? viewport : BANNER_FALLBACK_WIDTH) - pageInsets.horizontal * 2
  const ratio = component.width && component.height ? component.height / component.width : undefined
  const height = ratio !== undefined ? Math.round(available * ratio) : BANNER_HEIGHT

  return (
    <VStack
      spacing={6}
      frame={{ maxWidth: "infinity" }}
      background={
        <GeometryReader>
          {geometry => <WidthReporter width={geometry.size.width} onWidth={value => setViewport(Math.round(value))} />}
        </GeometryReader>
      }
    >
      <SectionHeader sourceKey={sourceKey} title={component.title} subtitle={component.subtitle} />
      <HomeCarousel
        count={links.length}
        interval={component.autoScrollInterval}
        height={height + BANNER_PAGE_PADDING * 2}
        renderPage={page => (
          <VStack
            alignment="leading"
            frame={{ maxWidth: "infinity" }}
            padding={{ horizontal: pageInsets.horizontal, vertical: BANNER_PAGE_PADDING }}
          >
            <LinkTarget sourceKey={sourceKey} link={links[page]}>
              <CoverImage
                sourceKey={sourceKey}
                url={links[page].imageUrl}
                title={links[page].title}
                width={available}
                height={height}
                // 整張圖完整顯示（比例已經對好，不用裁切）。
                mode="fit"
              />
            </LinkTarget>
          </VStack>
        )}
      />
    </VStack>
  )
}

// ---------------------------------------------------------------- links

/** 原版 `HomeLinksView.swift:36-72`：標題＋一疊連結列（每列只顯示標題）。 */
function LinksSection({ sourceKey, component }: { sourceKey: string; component: HomeComponent }) {
  if (component.type !== "links") return null
  return (
    <VStack spacing={6} frame={{ maxWidth: "infinity" }}>
      <SectionHeader sourceKey={sourceKey} title={component.title} subtitle={component.subtitle} />
      <VStack padding={{ horizontal: pageInsets.horizontal }} frame={{ maxWidth: "infinity" }}>
        <Card>
          {component.links.map((link, index) => (
            <VStack key={`link:${index}:${link.title}`} spacing={0} frame={{ maxWidth: "infinity" }}>
              {index > 0 ? <Divider padding={{ horizontal: pageInsets.horizontal }} /> : null}
              <LinkTarget sourceKey={sourceKey} link={link}>
                <HStack spacing={8} padding={rowPadding} frame={{ maxWidth: "infinity" }} contentShape="rect">
                  <Text
                    font="body"
                    foregroundStyle="label"
                    lineLimit={1}
                    frame={{ maxWidth: "infinity", alignment: "leading" }}
                  >
                    {link.title}
                  </Text>
                  {isActionable(link) ? <Chevron /> : null}
                </HStack>
              </LinkTarget>
            </VStack>
          ))}
        </Card>
      </VStack>
    </VStack>
  )
}

// ---------------------------------------------------------------- filters

/**
 * 篩選捷徑（原版 `HomeFiltersView.swift:99-116`）：點下去開一個帶著該篩選的漫畫列表頁；
 * 原版把 `item.values`（沒有就用同名的 genre 篩選）儭給 `getSearchMangaList(query: nil, page:, filters:)`。
 * 這裡的 `values` 已經就是描述子（`{type, name, value}`），直接給現有的 `searchSource`；沒 values 就空篩選。
 */
function FiltersSection({ sourceKey, component }: { sourceKey: string; component: HomeComponent }) {
  if (component.type !== "filters") return null
  return (
    <VStack spacing={6} frame={{ maxWidth: "infinity" }}>
      <SectionHeader sourceKey={sourceKey} title={component.title} subtitle={component.subtitle} />
      <ChipRow>
        {component.items.map((item, index) => (
          <NavigationLink
            key={`filter:${index}:${item.title}`}
            destination={
              <FilteredListScreen sourceKey={sourceKey} title={item.title} filters={item.values ?? []} />
            }
            buttonStyle="plain"
          >
            <Chip text={item.title} />
          </NavigationLink>
        ))}
      </ChipRow>
    </VStack>
  )
}

// ---------------------------------------------------------------- mangaList

function MangaListSection({ sourceKey, component }: { sourceKey: string; component: HomeComponent }) {
  if (component.type !== "mangaList") return null
  const pageSize = component.pageSize && component.pageSize > 0 ? component.pageSize : undefined
  return (
    <HomeRowsSection
      sourceKey={sourceKey}
      title={component.title}
      subtitle={component.subtitle}
      listing={component.listing}
      rows={component.entries.map(link => ({ link }))}
      ranking={component.ranking}
      pageSize={pageSize}
    />
  )
}

/**
 * 首頁的「漫畫＋最新一話」（原版 `HomeChapterListView`）：
 * 版面就是 `MangaListRow`（封面、標題兩行），第二行是章節標題，有上架時間就再加一行時鐘小字；
 * 點下去照原版是**進詳情**（`HomeChapterListView.swift:107-109`），不是直接開那一話。
 */
function MangaChapterListSection({ sourceKey, component }: { sourceKey: string; component: HomeComponent }) {
  if (component.type !== "mangaChapterList") return null
  const pageSize = component.pageSize && component.pageSize > 0 ? component.pageSize : undefined
  return (
    <HomeRowsSection
      sourceKey={sourceKey}
      title={component.title}
      subtitle={component.subtitle}
      listing={component.listing}
      rows={component.entries.map(entry => ({
        link: {
          title: entry.manga.title,
          subtitle: entry.chapter?.title,
          target: { type: "manga", manga: entry.manga },
        },
        footnote: entry.chapter?.uploadedAt ? formatCommentTime(new Date(entry.chapter.uploadedAt).toISOString()) : undefined,
      }))}
      ranking={false}
      pageSize={pageSize}
    />
  )
}

/** mangaList 與 mangaChapterList 共用的版面：同一份 `MangaListRow`，有 pageSize 就用分頁版。 */
function HomeRowsSection({
  sourceKey,
  title,
  subtitle,
  listing,
  rows,
  ranking,
  pageSize,
}: {
  sourceKey: string
  title?: string
  subtitle?: string
  listing?: HomeListing
  rows: HomeRow[]
  ranking: boolean
  pageSize?: number
}) {
  return (
    <VStack spacing={6} frame={{ maxWidth: "infinity" }}>
      <SectionHeader sourceKey={sourceKey} title={title} subtitle={subtitle} listing={listing} />
      {pageSize ? (
        <MangaListPages sourceKey={sourceKey} rows={rows} ranking={ranking} pageSize={pageSize} />
      ) : (
        <LazyVStack spacing={LIST_ROW_GAP}>
          {rows.map((row, index) => (
            <MangaListRow
              key={`list:${index}:${row.link.title}`}
              sourceKey={sourceKey}
              row={row}
              rank={index}
              ranking={ranking}
            />
          ))}
        </LazyVStack>
      )}
    </VStack>
  )
}

/**
 * 有 pageSize 的 mangaList（原版 `CollectionView.mangaListLayout`）：
 * 一頁是 `pageSize` 列組成的一欄、寬度是容器的 0.9，往右翻頁；
 * 容器夠寬（÷340）時一頁並排多欄，跟原版一樣。
 */
function MangaListPages({
  sourceKey,
  rows,
  ranking,
  pageSize,
}: {
  sourceKey: string
  rows: HomeRow[]
  ranking: boolean
  pageSize: number
}) {
  // 一頁的列數（原版：min(pageSize, 總數)），高度先算好給 GeometryReader。
  const rowsPerPage = Math.max(1, Math.min(pageSize, rows.length))
  const pageHeight = rowsPerPage * LIST_ROW_HEIGHT + (rowsPerPage - 1) * LIST_ROW_GAP

  return (
    <VStack spacing={0} frame={{ height: pageHeight }}>
      <GeometryReader>
        {geometry => {
          const container = Math.round(geometry.size.width)
          const columns = Math.max(1, Math.floor(container / PAGE_COLUMN_BASIS))
          const perPage = rowsPerPage * columns
          const pageWidth = Math.round(container * PAGE_WIDTH_RATIO)
          const pages: HomeRow[][] = []
          for (let start = 0; start < rows.length; start += perPage) {
            pages.push(rows.slice(start, start + perPage))
          }
          // 原版：`totalItems > itemsPerPage` 才 `groupPaging`，否則 `.none`（一頁就翻不動）。
          const paged = rows.length > perPage

          return (
            <ScrollView
              axes="horizontal"
              scrollIndicator="hidden"
              scrollDisabled={!paged}
              scrollTargetBehavior={paged ? "viewAlignedLimitAlwaysByOne" : undefined}
            >
              {/* 原版 section 的 contentInsets 是 leading 0、trailing 40：左邊的 16 只來自行自己的 padding，
                  這裡不能再加左 inset，不然會跟排行版／非分頁列表差一個內距。 */}
              <LazyHStack alignment="top" spacing={LIST_ROW_GAP} padding={{ trailing: 40 }}>
                {pages.map((page, pageIndex) => (
                  <HStack key={`page:${pageIndex}`} alignment="top" spacing={LIST_ROW_GAP} frame={{ width: pageWidth }}>
                    {splitColumns(page, rowsPerPage).map((column, columnIndex) => (
                      <VStack key={`column:${columnIndex}`} spacing={LIST_ROW_GAP} frame={{ maxWidth: "infinity" }}>
                        {column.map((row, rowIndex) => (
                          <MangaListRow
                            key={`row:${columnIndex}:${rowIndex}:${row.link.title}`}
                            sourceKey={sourceKey}
                            row={row}
                            rank={pageIndex * perPage + columnIndex * rowsPerPage + rowIndex}
                            ranking={ranking}
                            dense
                          />
                        ))}
                      </VStack>
                    ))}
                  </HStack>
                ))}
              </LazyHStack>
            </ScrollView>
          )
        }}
      </GeometryReader>
    </VStack>
  )
}

/** 一頁切成 `columns` 份，每份 `rowsPerPage` 列（最後一份可能不滿）。 */
function splitColumns(page: HomeRow[], rowsPerPage: number): HomeRow[][] {
  const columns: HomeRow[][] = []
  for (let start = 0; start < page.length; start += rowsPerPage) columns.push(page.slice(start, start + rowsPerPage))
  return columns
}

/** 一列要畫的資料：首頁連結，加上可選的第三行（章節列的上架時間）。 */
interface HomeRow {
  link: HomeLink
  /** 第三行的小字（前面帶時鐘）；沒給就不佔位。 */
  footnote?: string
}

/**
 * 一列漫畫（原版 `HomeListView.view(for:position:)`）：
 * 100 高封面、標題兩行、副標一行、標籤；ranking 時標題左邊是粗體的編號（位置照整份清單，不從每頁重數）。
 * `footnote` 是章節列表的第三行（原版 `HomeChapterListView.swift:129-133` 的時間）。
 */
function MangaListRow({
  sourceKey,
  row,
  rank,
  ranking,
  dense = false,
}: {
  sourceKey: string
  row: HomeRow
  rank: number
  ranking: boolean
  dense?: boolean
}) {
  const link = row.link
  const tags = link.target?.type === "manga" ? link.target.manga.tags.slice(0, dense ? 2 : 3) : []

  return (
    <LinkTarget sourceKey={sourceKey} link={link}>
      <HStack
        spacing={12}
        alignment="top"
        padding={{ horizontal: pageInsets.horizontal, vertical: 0 }}
        frame={{ maxWidth: "infinity", height: LIST_ROW_HEIGHT, alignment: "top" }}
        contentShape="rect"
      >
        <CoverImage
          sourceKey={sourceKey}
          url={coverOf(link)}
          title={link.title}
          width={LIST_COVER.width}
          height={LIST_COVER.height}
        />

        {ranking ? (
          <Text font="subheadline" fontWeight="bold" foregroundStyle="label" padding={{ trailing: 2 }}>
            {rank + 1}
          </Text>
        ) : null}

        <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Text font="subheadline" foregroundStyle="label" lineLimit={2} multilineTextAlignment="leading">
            {link.title}
          </Text>
          {link.subtitle ? (
            <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={1}>
              {link.subtitle}
            </Text>
          ) : null}
          {row.footnote ? (
            <HStack spacing={3} alignment="center">
              <Image systemName="clock" font="caption2" foregroundStyle="secondaryLabel" />
              <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                {row.footnote}
              </Text>
            </HStack>
          ) : null}
          {tags.length > 0 ? (
            <HStack spacing={4}>
              {tags.map(tag => (
                <Tag key={`row-tag:${tag}`} text={tag} />
              ))}
            </HStack>
          ) : null}
        </VStack>
      </HStack>
    </LinkTarget>
  )
}

// ---------------------------------------------------------------- 載入中的骨架

const SKELETON_TEXT = "XXXXXXXXXXXX"

/** 首頁載入中：兩段橫向卡片排 ＋ 一段列表，尺寸跟真的元件一樣，資料來了版面不跳。 */
export function HomeSkeleton() {
  return (
    <VStack spacing={pageSpacing} frame={{ maxWidth: "infinity" }} padding={{ top: 10, bottom: pageInsets.bottom }}>
      {[0, 1].map(row => (
        <VStack key={`skeleton-row:${row}`} spacing={6} frame={{ maxWidth: "infinity" }}>
          <HStack padding={{ horizontal: pageInsets.horizontal }}>
            <Text font="title3" fontWeight="semibold" lineLimit={1} redacted="placeholder">
              {SKELETON_TEXT}
            </Text>
            <Spacer />
          </HStack>
          <ScrollView axes="horizontal" scrollDisabled={true} scrollIndicator="hidden">
            <HStack spacing={12} padding={{ horizontal: pageInsets.horizontal, vertical: 8 }}>
              {[0, 1, 2, 3].map(card => (
                <VStack key={`skeleton-card:${card}`} alignment="leading" spacing={6} frame={{ width: SCROLLER_COVER.width }}>
                  <VStack
                    frame={{ width: SCROLLER_COVER.width, height: SCROLLER_COVER.height }}
                    background={fill.surface}
                    clipShape={rect(radius.md)}
                  />
                  <Text font="footnote" fontWeight="medium" lineLimit={1} redacted="placeholder">
                    {SKELETON_TEXT}
                  </Text>
                </VStack>
              ))}
            </HStack>
          </ScrollView>
        </VStack>
      ))}

      <VStack spacing={LIST_ROW_GAP} frame={{ maxWidth: "infinity" }}>
        {[0, 1, 2].map(row => (
          <HStack
            key={`skeleton-list:${row}`}
            spacing={12}
            alignment="top"
            padding={{ horizontal: pageInsets.horizontal }}
            frame={{ maxWidth: "infinity", height: LIST_ROW_HEIGHT, alignment: "top" }}
          >
            <VStack frame={{ width: LIST_COVER.width, height: LIST_COVER.height }} background={fill.surface} clipShape={rect(radius.md)} />
            <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }} redacted="placeholder">
              <Text font="subheadline" lineLimit={1}>
                {SKELETON_TEXT}
              </Text>
              <Text font="footnote" lineLimit={1}>
                {SKELETON_TEXT}
              </Text>
            </VStack>
          </HStack>
        ))}
      </VStack>
    </VStack>
  )
}
