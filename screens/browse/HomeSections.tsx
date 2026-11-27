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
import { capsule, fill, pageInsets, pageSpacing, rect, rowPadding } from "../../design/tokens"
import { SkeletonCardRow, SkeletonListRow, SkeletonText } from "../../design/skeleton"
import { CoverImage } from "../../components/CoverImage"
import { WidthReporter } from "../../components/WidthReporter"
import { ComicDetailScreen } from "../shared/ComicDetailScreen"
import { formatCommentTime } from "../shared/commentTime"
import { SectionGridScreen } from "./SectionGridScreen"

const SCROLLER_COVER = { width: 120, height: 180 }
const BIG_COVER = { width: 113, height: 170 }
const BIG_TAG_STRIP = 40
const LIST_COVER = { width: 67, height: 100 }
const LIST_ROW_HEIGHT = 100
const LIST_ROW_GAP = 10
const PAGE_COLUMN_BASIS = 340
const PAGE_WIDTH_RATIO = 0.9

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

function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function isActionable(link: HomeLink): boolean {
  const target = link.target
  if (!target) return false
  return target.type === "url" ? isExternalUrl(target.url) : true
}

function coverOf(link: HomeLink): string | undefined {
  if (link.imageUrl) return link.imageUrl
  return link.target?.type === "manga" ? link.target.manga.cover : undefined
}

function HomeCarousel({
  count,
  interval,
  height,
  renderPage,
}: {
  count: number
  interval?: number
  height: number
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


function ScrollerSection({ sourceKey, component }: { sourceKey: string; component: HomeComponent }) {
  if (component.type !== "scroller") return null
  const hasSubtitles = component.entries.some(entry => entry.subtitle !== undefined)

  return (
    <VStack spacing={6} frame={{ maxWidth: "infinity" }}>
      <SectionHeader sourceKey={sourceKey} title={component.title} subtitle={component.subtitle} listing={component.listing} />

      <ScrollView axes="horizontal" scrollIndicator="hidden">
        {}
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


function BigScrollerSection({ sourceKey, component }: { sourceKey: string; component: HomeComponent }) {
  if (component.type !== "bigScroller") return null
  const entries = component.entries
  const hasTags = entries.some(entry => entry.tags.length > 0)
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


const BANNER_HEIGHT = 140
const BANNER_PAGE_PADDING = 8
const BANNER_FALLBACK_WIDTH = 402

function ImageScrollerSection({ sourceKey, component }: { sourceKey: string; component: HomeComponent }) {
  if (component.type !== "imageScroller") return null
  const links = component.links
  const [viewport, setViewport] = useState(0)

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
                mode="fit"
              />
            </LinkTarget>
          </VStack>
        )}
      />
    </VStack>
  )
}


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
              <SectionGridScreen sourceKey={sourceKey} title={item.title} search={{ keyword: "", filters: item.values ?? [] }} />
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
          const paged = rows.length > perPage

          return (
            <ScrollView
              axes="horizontal"
              scrollIndicator="hidden"
              scrollDisabled={!paged}
              scrollTargetBehavior={paged ? "viewAlignedLimitAlwaysByOne" : undefined}
            >
              {}
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

function splitColumns(page: HomeRow[], rowsPerPage: number): HomeRow[][] {
  const columns: HomeRow[][] = []
  for (let start = 0; start < page.length; start += rowsPerPage) columns.push(page.slice(start, start + rowsPerPage))
  return columns
}

interface HomeRow {
  link: HomeLink
  footnote?: string
}

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


export function HomeSkeleton() {
  return (
    <VStack spacing={pageSpacing} frame={{ maxWidth: "infinity" }} padding={{ top: 10, bottom: pageInsets.bottom }}>
      {[0, 1].map(row => (
        <VStack key={`skeleton-row:${row}`} spacing={6} frame={{ maxWidth: "infinity" }}>
          <HStack padding={{ horizontal: pageInsets.horizontal }}>
            <SkeletonText font="title3" fontWeight="semibold" />
            <Spacer />
          </HStack>
          <SkeletonCardRow size={SCROLLER_COVER} lines={["footnote", "caption2"]} />
        </VStack>
      ))}

      <VStack spacing={LIST_ROW_GAP} frame={{ maxWidth: "infinity" }}>
        {[0, 1, 2].map(row => (
          <SkeletonListRow key={`skeleton-list:${row}`} cover={LIST_COVER} lines={["subheadline", "footnote"]} height={LIST_ROW_HEIGHT} />
        ))}
      </VStack>
    </VStack>
  )
}
