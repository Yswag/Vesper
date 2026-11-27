import {
  Button,
  GeometryReader,
  Group,
  HStack,
  Image,
  LazyVStack,
  LazyHStack,
  Menu,
  NamespaceReader,
  Navigation,
  NavigationLink,
  ScrollView,
  Section,
  Spacer,
  Text,
  Toolbar,  ToolbarItem,
  ToolbarSpacer,
  VStack,
  ZStack,
  useEffect,
  useMemo,
  useState,
  type Color,
  type VirtualNode,
} from "scripting"

import { CoverBadge } from "../../design/CoverBadge"
import { CoverImage } from "../../components/CoverImage"
import { WidthReporter } from "../../components/WidthReporter"
import { CoverViewerScreen } from "./CoverViewerScreen"
import { isActive, type ChapterDownloadState, type ComicLibrary, type ComicPage, type ComicRef } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { comicUpdateRecord, pauseUpdates, resumeUpdates } from "../../app/updates"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import {
  getProgress,
  isFavorite,
  markAllChaptersRead,
  markChapterRead,
  readChapterIds,
  setComicUpdate,
  toggleFavorite,
} from "../../library/bookshelf"
import { formatStars } from "../../design/rating"
import { sourcesRevision } from "../../sources/registry"
import { CommentScreen } from "./CommentScreen"
import { SourceSwitchSheet } from "./SourceSwitchSheet"
import {
  ChapterListHeader,
  ChapterSelectionBar,
  selectionAnimation,
  selectionBarClearance,
  SelectionTabBarHider,
} from "./ChapterSelection"
import { heroCoverSize, recommendCardSize } from "./comicMetrics"
import { presentReader } from "./ResumeReaderScreen"
import { type ChapterRef } from "./ReaderScreen"
import { groupChapters, resolveInitialGroupName, type ChapterGroup } from "./chapterGrouping"
import { PageBackground, ThemedNavigationStack, useResolvedColorScheme, useTint } from "../../app/theme"
import { cardBackground, cardShape, capsule, fill, pageInsets, pageSpacing, palette, radius, rect, rowPadding } from "../../design/tokens"
import { Card } from "../../design/layout"
import { Tag } from "../../design/Tag"
import { Chip } from "../../design/chip"
import { NoticeBanner } from "../../design/status"
import { SkeletonBlock, SkeletonText } from "../../design/skeleton"
import { GlassSurface } from "../../design/GlassSurface"
import { liquidGlass, scrollTopBar } from "../../design/glass"

export function chapterDownloadStates(
  library: Pick<ComicLibrary, "downloadState">,
  ref: ComicRef,
  epIds: string[]
): Record<string, ChapterDownloadState> {
  const states = new Map<string, ChapterDownloadState>()
  for (const epId of epIds) {
    if (!states.has(epId)) states.set(epId, library.downloadState({ ...ref, epId }))
  }
  return Object.fromEntries(states)
}

export function readableChapters<T extends { locked?: boolean }>(chapters: readonly T[]): T[] {
  return chapters.filter(chapter => chapter.locked !== true)
}

export function pendingChapterIds<T extends { locked?: boolean }>(
  chaptersById: Map<string, T>,
  epIds: readonly string[],
  states: Record<string, ChapterDownloadState>
): string[] {
  const pending: string[] = []
  for (const epId of epIds) {
    if (chaptersById.get(epId)?.locked === true) continue
    if (states[epId]?.state === "done") continue
    pending.push(epId)
  }
  return pending
}

function statusText(status: NonNullable<ComicPage["status"]>): string {
  switch (status) {
    case "ongoing":
      return t("detail.statusOngoing")
    case "completed":
      return t("detail.statusCompleted")
    case "cancelled":
      return t("detail.statusCancelled")
    case "hiatus":
      return t("detail.statusHiatus")
    case "notPublished":
      return t("detail.statusNotPublished")
  }
}

const markSlotWidth = 28

function ratingText(rating: NonNullable<ComicPage["contentRating"]>): string {
  return rating === "nsfw" ? t("detail.ratingNsfw") : t("detail.ratingSuggestive")
}

export type ComicHeroData = Pick<
  ComicPage,
  | "title"
  | "sourceName"
  | "uploader"
  | "artists"
  | "status"
  | "contentRating"
  | "stars"
  | "likesCount"
  | "updateTime"
  | "uploadTime"
>

export function ComicRatingBadge({ rating }: { rating?: ComicPage["contentRating"] }) {
  if (!rating || rating === "safe") return null
  return (
    <HStack offset={{ x: -6, y: 6 }}>
      <CoverBadge
        text={ratingText(rating)}
        icon={rating === "nsfw" ? "exclamationmark.triangle.fill" : "info.circle"}
        tone={rating === "nsfw" ? "danger" : "default"}
      />
    </HStack>
  )
}

export function ComicHeroMeta({
  meta,
  onSwitchSource,
}: {
  meta: ComicHeroData
  onSwitchSource: () => void
}) {
  const rating = formatStars(meta.stars)

  return (
    <VStack
      alignment="leading"
      spacing={8}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      fixedSize={{ horizontal: false, vertical: true }}
    >
      <Text
        font="title3"
        fontWeight="bold"
        lineLimit={3}
        multilineTextAlignment="leading"
        fixedSize={{ horizontal: false, vertical: true }}
      >
        {meta.title}
      </Text>

      {}
      <Chip
        compact
        text={meta.sourceName}
        chevron
        onTap={onSwitchSource}
        accessibilityLabel={t("detail.switchSource")}
      />

      {}
      {rating || (meta.likesCount != null && meta.likesCount > 0) ? (
        <HStack spacing={8} alignment="center">
          {rating ? <Tag text={`${rating.glyphs} ${rating.score}`} tone="warning" /> : null}

          {meta.likesCount != null && meta.likesCount > 0 ? (
            <Tag
              icon="heart.fill"
              tone="love"
              accessibilityLabel={t("detail.likesCount", { n: meta.likesCount })}
              text={
                meta.likesCount >= 10000
                  ? `${(meta.likesCount / 10000).toFixed(1)}w`
                  : meta.likesCount >= 1000
                  ? `${(meta.likesCount / 1000).toFixed(1)}k`
                  : String(meta.likesCount)
              }
            />
          ) : null}
        </HStack>
      ) : null}

      {}
      {meta.status ? <Tag text={statusText(meta.status)} /> : null}

      {meta.uploader ? (
        <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={2}>
          {t("detail.author", { name: meta.uploader })}
        </Text>
      ) : null}

      {meta.artists ? (
        <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={2}>
          {t("detail.artist", { name: meta.artists })}
        </Text>
      ) : null}

      {meta.updateTime || meta.uploadTime ? (
        <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1}>
          {meta.updateTime
            ? t("detail.updatedAt", { time: meta.updateTime })
            : t("detail.uploadedAt", { time: meta.uploadTime! })}
        </Text>
      ) : null}
    </VStack>
  )
}

const DETAIL_CACHE_LIMIT = 8
const detailCache = new Map<string, ComicPage>()

function detailCacheKey(sourceKey: string, comicId: string): string {
  return `${sourcesRevision()}\n${sourceKey}\n${comicId}`
}

function readDetailCache(sourceKey: string, comicId: string): ComicPage | undefined {
  return detailCache.get(detailCacheKey(sourceKey, comicId))
}

function writeDetailCache(sourceKey: string, comicId: string, page: ComicPage): void {
  const key = detailCacheKey(sourceKey, comicId)
  detailCache.delete(key)
  detailCache.set(key, page)
  while (detailCache.size > DETAIL_CACHE_LIMIT) {
    const oldest = detailCache.keys().next().value
    if (oldest === undefined) break
    detailCache.delete(oldest)
  }
}

export function ComicDetailScreen({
  sourceKey: initialSourceKey,
  comicId: initialComicId,
  title: initialTitle,
  zoomTransition,
}: {
  sourceKey: string
  comicId: string
  title: string
  zoomTransition?: {
    sourceID: string | number
    namespace: NamespaceID
  }
}) {
  const library = comicLibrary()
  const [active, setActive] = useState<ComicRef>({ sourceKey: initialSourceKey, comicId: initialComicId })
  const sourceKey = active.sourceKey
  const comicId = active.comicId
  const [pendingTitle, setPendingTitle] = useState(initialTitle)
  const tint = useTint()
  const tintColor = String(tint.tint[useResolvedColorScheme()]) as Color
  const [detail, setDetail] = useState<ComicPage | null>(() => readDetailCache(initialSourceKey, initialComicId) ?? null)
  const [status, setStatus] = useState<string | null>(null)
  const [reverseOrder, setReverseOrder] = useState(false)
  const [descExpanded, setDescExpanded] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [heroContainerWidth, setHeroContainerWidth] = useState(0)
  const [ambientImage, setAmbientImage] = useState<UIImage | null>(null)
  const [showNavTitle, setShowNavTitle] = useState(false)

  const refresh = useSubscription(library.onChange, subscribeLocale)

  const favorite = isFavorite(sourceKey, comicId)

  useEffect(() => {
    pauseUpdates()
    return () => resumeUpdates()
  }, [])

  useEffect(() => {
    let alive = true
    setDetail(readDetailCache(sourceKey, comicId) ?? null)
    setStatus(null)
    library
      .comic({ sourceKey, comicId })
      .then(
        result => {
          if (!alive) return
          setDetail(result)
          setStatus(null)
          writeDetailCache(sourceKey, comicId, result)
          if (result.chapters.length > 0) setComicUpdate(comicUpdateRecord(result))
        },
        error => {
          if (alive) setStatus(error instanceof Error ? error.message : String(error))
        }
      )
    return () => {
      alive = false
    }
  }, [sourceKey, comicId])

  const chapters: ChapterRef[] = useMemo(
    () => (detail ? library.readerChapters(detail) : []),
    [detail, library]
  )

  const chaptersById = useMemo(() => {
    const index = new Map<string, ChapterRef>()
    for (const chapter of chapters) if (!index.has(chapter.id)) index.set(chapter.id, chapter)
    return index
  }, [chapters])

  const resumed = library.resume({ sourceKey, comicId })
  const comicTitle = detail?.title ?? pendingTitle
  const comicCover = detail?.cover

  const chapterGroups: ChapterGroup<ChapterRef>[] = useMemo(() => groupChapters(chapters), [chapters])
  const isGrouped = chapterGroups.length > 1
  const initialGroupName = useMemo(
    () => resolveInitialGroupName(chapterGroups, resumed?.chapter.epId),
    [chapterGroups, resumed?.chapter.epId]
  )
  const [selectedGroup, setSelectedGroup] = useState<string>("")
  const activeGroup = selectedGroup && chapterGroups.some((g: ChapterGroup<ChapterRef>) => g.name === selectedGroup)
    ? selectedGroup
    : initialGroupName

  const currentGroupChapters: ChapterRef[] = useMemo(() => {
    if (!isGrouped) return chapters
    const matched = chapterGroups.find((g: ChapterGroup<ChapterRef>) => g.name === activeGroup)
    return matched ? matched.chapters : chapters
  }, [isGrouped, chapterGroups, activeGroup, chapters])

  const readEpIds = getProgress(sourceKey, comicId)?.readEpIds
  const readIds = useMemo(() => readChapterIds(sourceKey, comicId), [sourceKey, comicId, readEpIds])

  useEffect(() => {
    if (!comicCover) {
      setAmbientImage(null)
      return
    }
    let alive = true
    void comicLibrary()
      .thumbnailPath(sourceKey, comicCover)
      .then(path => {
        if (!alive) return
        const img = UIImage.fromFile(path)
        if (img) setAmbientImage(img)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [sourceKey, comicCover])

  const readerProps = {
    sourceKey,
    comicId,
    chapters,
    comicTitle,
    comicCover,
    viewer: detail?.viewer,
  }

  const firstReadable = chapters.find(chapter => !chapter.locked)
  const resumedReadable =
    resumed && chapters.some(c => c.id === resumed.chapter.epId && !c.locked) ? resumed.chapter.epId : undefined
  const targetEpId = resumedReadable ?? firstReadable?.id

  const targetEpTitle = chapters.find(chapter => chapter.id === targetEpId)?.title

  const resumePage = resumed && resumed.chapter.epId === targetEpId ? resumed.page : undefined

  const allTags = (detail?.tags ?? []).flatMap(g => g.values)

  const cleanDescription = (detail?.description ?? "")
    .replace(/\\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  const isLongDescription = cleanDescription.length > 60 || cleanDescription.split("\n").length > 2

  const displayChapters = useMemo(
    () => (reverseOrder ? [...currentGroupChapters].reverse() : currentGroupChapters),
    [currentGroupChapters, reverseOrder]
  )

  const chapterStates = chapterDownloadStates(library, { sourceKey, comicId }, [
    ...currentGroupChapters.map(chapter => chapter.id),
    ...selectedIds,
  ])

  const pendingAll = pendingChapterIds(
    chaptersById,
    currentGroupChapters.map(chapter => chapter.id),
    chapterStates
  )
  const pendingSelected = pendingChapterIds(chaptersById, selectedIds, chapterStates)

  const readable = useMemo(() => readableChapters(currentGroupChapters), [currentGroupChapters])
  const unreadCount = useMemo(
    () => readable.filter(chapter => !readIds.has(chapter.id)).length,
    [readable, readIds]
  )
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const allSelected = useMemo(
    () => readable.length > 0 && readable.every(chapter => selectedSet.has(chapter.id)),
    [readable, selectedSet]
  )

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds([])
    } else {
      setSelectedIds(readable.map(chapter => chapter.id))
    }
  }

  const downloadMeta = detail ? { comicTitle: detail.title, cover: detail.cover } : undefined

  async function openSwitch() {
    await Navigation.present({
      element: (
        <ThemedNavigationStack>
          <SourceSwitchSheet
            sourceKey={sourceKey}
            title={comicTitle}
            onPick={(ref, nextTitle) => {
              setPendingTitle(nextTitle)
              setSelecting(false)
              setSelectedIds([])
              setActive(ref)
            }}
          />
        </ThemedNavigationStack>
      ),
      modalPresentationStyle: "pageSheet",
    })
  }

  function toggleSelected(epId: string) {
    if (chaptersById.get(epId)?.locked) return
    setSelectedIds(previous => {
      const next = new Set(previous)
      if (next.has(epId)) next.delete(epId)
      else next.add(epId)
      return [...next]
    })
  }

  function downloadSelected() {
    const requests = pendingSelected.map(epId => ({
      sourceKey,
      comicId,
      epId,
      title: chapters.find(chapter => chapter.id === epId)?.title,
    }))
    if (requests.length > 0) void library.download(requests, downloadMeta)
    setSelectionMode(false)
  }

  function downloadAll() {
    const requests = currentGroupChapters.map(chapter => ({ sourceKey, comicId, epId: chapter.id, title: chapter.title }))
    if (requests.length > 0) void library.download(requests, downloadMeta)
  }

  function downloadChapter(chapter: ChapterRef) {
    void library.download(
      [{ sourceKey, comicId, epId: chapter.id, title: chapter.title }],
      downloadMeta
    )
  }

  function toggleRead(chapter: ChapterRef) {
    markChapterRead(sourceKey, comicId, [chapter.id], !readIds.has(chapter.id))
  }

  function chaptersBefore(chapter: ChapterRef): ChapterRef[] {
    const index = currentGroupChapters.findIndex(item => item.id === chapter.id)
    return index > 0 ? readableChapters(currentGroupChapters.slice(0, index)) : []
  }

  function markChaptersBefore(chapter: ChapterRef, read: boolean) {
    const ids = chaptersBefore(chapter).map(item => item.id)
    if (ids.length > 0) markChapterRead(sourceKey, comicId, ids, read)
  }

  function cancelChapterDownload(chapter: ChapterRef) {
    library.cancelDownload({ sourceKey, comicId, epId: chapter.id })
  }

  function removeChapterDownload(chapter: ChapterRef) {
    void library.offline.deleteChapter({ sourceKey, comicId, epId: chapter.id })
  }

  function markGroupRead() {
    markAllChaptersRead(
      sourceKey,
      comicId,
      readable.map(chapter => chapter.id)
    )
  }

  function markSelectedRead() {
    if (selectedIds.length === 0) return
    markChapterRead(sourceKey, comicId, selectedIds, true)
    setSelectionMode(false)
  }

  function setSelectionMode(on: boolean) {
    void withAnimation(selectionAnimation, () => {
      setSelecting(on)
      setSelectedIds([])
    })
  }

  const hero = heroCoverSize(heroContainerWidth)

  return (
    <ZStack
      navigationTransition={
        zoomTransition
          ? {
              type: "zoom",
              sourceID: zoomTransition.sourceID,
              namespace: zoomTransition.namespace,
            }
          : undefined
      }
      onAppear={() => refresh()}
    >
      <PageBackground />

      {}
      {ambientImage ? (
        <GeometryReader>
          {geometry => (
            <VStack
              frame={{ width: geometry.size.width, height: 380, alignment: "top" }}
              offset={{ x: 0, y: -60 }}
              allowsHitTesting={false}
            >
              <Image
                image={ambientImage}
                resizable={true}
                scaleToFill={true}
                frame={{ width: geometry.size.width, height: 380 }}
                blur={70}
                opacity={0.35}
              />
            </VStack>
          )}
        </GeometryReader>
      ) : null}

      <VStack
        spacing={0}
        navigationTitle={showNavTitle ? comicTitle : ""}
        navigationBarTitleDisplayMode="inline"
        toolbar={
          <Toolbar>
            {detail?.url ? (
              <ToolbarItem placement="topBarTrailing">
                <Button
                  buttonStyle="plain"
                  accessibilityLabel={t("detail.openInBrowser")}
                  action={() => {
                    void Safari.openURL(detail.url!)
                  }}
                >
                  <Image
                    systemName="safari"
                    font="body"
                    fontWeight="medium"
                    foregroundStyle="label"
                  />
                </Button>
              </ToolbarItem>
            ) : null}
            {detail?.url && liquidGlass ? (
              <ToolbarSpacer sizing="fixed" placement="topBarTrailing" />
            ) : null}
            <ToolbarItem placement="topBarTrailing">
              <Button
                buttonStyle="plain"
                accessibilityLabel={favorite ? t("detail.unfavorite") : t("detail.favorite")}
                action={() => {
                  toggleFavorite({
                    sourceKey,
                    comicId,
                    title: comicTitle,
                    cover: comicCover,
                  })
                }}
              >
                <Image
                  systemName={favorite ? "heart.fill" : "heart"}
                  font="body"
                  fontWeight="medium"
                  foregroundStyle={favorite ? "systemRed" : "label"}
                />
              </Button>
            </ToolbarItem>
          </Toolbar>
        }
    >
      <SelectionTabBarHider selecting={selecting} />

      {}
      {!detail && status ? (
        <VStack padding={pageInsets} frame={{ maxWidth: "infinity" }}>
          <NoticeBanner tone="error" text={status} />
        </VStack>
      ) : null}
      {!detail && !status ? <DetailSkeleton cover={heroCoverSize(heroContainerWidth)} /> : null}

      {detail ? (
        <ScrollView
          scrollContentBackground="hidden"
          frame={{ maxWidth: "infinity" }}
          {...scrollTopBar(null)}
          overlay={{
            alignment: "bottom",
            content: (
              <ChapterSelectionBar
                visible={selecting}
                allSelected={allSelected}
                downloadCount={pendingSelected.length}
                readCount={selectedIds.length}
                onToggleAll={toggleSelectAll}
                onDownload={downloadSelected}
                onMarkRead={markSelectedRead}
              />
            ),
          }}
          onScrollTargetVisibilityChange={{
            idType: "string",
            threshold: 0.1,
            onChanged: ids => {
              setShowNavTitle(!(ids as string[]).includes("hero-title"))
            },
          }}
          background={
            <GeometryReader>
              {geometry => (
                <WidthReporter
                  width={geometry.size.width}
                  onWidth={width => setHeroContainerWidth(Math.round(width))}
                />
              )}
            </GeometryReader>
          }
        >
          <VStack
            spacing={pageSpacing}
            padding={pageInsets}
            scrollTargetLayout={true}
            frame={{ maxWidth: "infinity" }}
          >

            {}
            <HStack
              key="hero-title"
              spacing={16}
              alignment="top"
              frame={{ maxWidth: "infinity" }}
            >
            <NamespaceReader>
              {heroNs => (
                <NavigationLink
                  destination={
                    <CoverViewerScreen
                      sourceKey={sourceKey}
                      url={comicCover}
                      title={comicTitle}
                      zoomTransition={{ sourceID: `detail-hero:${sourceKey}:${comicId}`, namespace: heroNs }}
                    />
                  }
                  buttonStyle="plain"
                >
                  <ZStack
                    alignment="topTrailing"
                    matchedTransitionSource={{ id: `detail-hero:${sourceKey}:${comicId}`, namespace: heroNs }}
                  >
                    <CoverImage
                      sourceKey={sourceKey}
                      url={comicCover}
                      width={hero.width}
                      height={hero.height}
                      cornerRadius={radius.md}
                      title={comicTitle}
                      lifted={true}
                    />
                    <ComicRatingBadge rating={detail.contentRating} />
                  </ZStack>
                </NavigationLink>
              )}
            </NamespaceReader>

              <ComicHeroMeta meta={detail} onSwitchSource={() => void openSwitch()} />
            </HStack>

            {}
            <HStack spacing={10} alignment="center" frame={{ maxWidth: "infinity" }}>
              {targetEpId ? (
                <Button
                  action={() => void presentReader({ ...readerProps, epId: targetEpId, initialPage: resumePage })}
                  buttonStyle="plain"
                >
                  <GlassSurface shape={rect(radius.lg)} tint={tintColor} interactive={true}>
                    <HStack
                      spacing={10}
                      alignment="center"
                      padding={{ horizontal: 16, vertical: 0 }}
                      frame={{ maxWidth: "infinity", height: 64 }}
                    >
                      <Spacer />
                      <Image
                        systemName="book.fill"
                        font="title3"
                        foregroundStyle={tint.onTint}
                      />
                      <VStack alignment="leading" spacing={2}>
                        <Text font="headline" fontWeight="bold" foregroundStyle={tint.onTint}>
                          {resumed ? t("detail.resumeReading") : t("detail.startReading")}
                        </Text>
                        <Text font="caption2" fontWeight="medium" foregroundStyle={tint.onTint} opacity={0.75} lineLimit={1}>
                          {targetEpTitle
                            ? resumePage !== undefined
                              ? t("detail.chapterAtPage", { chapter: targetEpTitle, n: resumePage + 1 })
                              : targetEpTitle
                            : t("detail.firstChapter")}
                        </Text>
                      </VStack>
                      <Spacer />
                    </HStack>
                  </GlassSurface>
                </Button>
              ) : chapters.length > 0 ? (
                <GlassSurface shape={rect(radius.lg)}>
                  <HStack
                    spacing={10}
                    alignment="center"
                    padding={{ horizontal: 16, vertical: 0 }}
                    frame={{ maxWidth: "infinity", height: 64 }}
                  >
                    <Spacer />
                    <Image systemName="lock.fill" font="title3" foregroundStyle="secondaryLabel" />
                    <Text font="headline" fontWeight="semibold" foregroundStyle="secondaryLabel">
                      {t("detail.allChaptersLocked")}
                    </Text>
                    <Spacer />
                  </HStack>
                </GlassSurface>
              ) : null}

              {}
              <Button
                buttonStyle="plain"
                accessibilityLabel={favorite ? t("detail.unfavorite") : t("detail.favorite")}
                action={() => {
                  toggleFavorite({
                    sourceKey,
                    comicId,
                    title: comicTitle,
                    cover: comicCover,
                  })
                }}
              >
                <GlassSurface shape={rect(radius.lg)} interactive={true}>
                  <VStack alignment="center" spacing={4} frame={{ width: 54, height: 64 }}>
                    <Image
                      systemName={favorite ? "heart.fill" : "heart"}
                      font="title3"
                      foregroundStyle={favorite ? "systemRed" : "label"}
                    />
                    <Text
                      font="caption2"
                      fontWeight="medium"
                      foregroundStyle={favorite ? "systemRed" : "secondaryLabel"}
                    >
                      {favorite ? t("detail.favorited") : t("detail.favorite")}
                    </Text>
                  </VStack>
                </GlassSurface>
              </Button>

              {}
              {detail.comments ? (
                <NavigationLink
                  destination={
                    <CommentScreen sourceKey={sourceKey} comicId={comicId} subId={detail.subId} />
                  }
                  buttonStyle="plain"
                  accessibilityLabel={t("comments.title")}
                >
                  <GlassSurface shape={rect(radius.lg)} interactive={true}>
                    <VStack alignment="center" spacing={4} frame={{ width: 54, height: 64 }}>
                      <Image
                        systemName="bubble.left.and.bubble.right"
                        font="title3"
                        foregroundStyle="label"
                      />
                      <Text font="caption2" fontWeight="medium" foregroundStyle="secondaryLabel">
                        {t("comments.title")}
                      </Text>
                    </VStack>
                  </GlassSurface>
                </NavigationLink>
              ) : null}
            </HStack>

            {}
            {allTags.length > 0 ? (
              <ScrollView axes="horizontal" scrollIndicator="hidden" frame={{ maxWidth: "infinity" }}>
                <HStack spacing={8}>
                  {allTags.map((tag, i) => (
                    <Tag key={`tag:${i}:${tag}`} text={tag} />
                  ))}
                </HStack>
              </ScrollView>
            ) : null}

            {}
            {cleanDescription ? (
              <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <HStack>
                  <Text font="headline" fontWeight="bold">
                    {t("detail.summary")}
                  </Text>
                  <Spacer />
                  {isLongDescription ? (
                    <Button
                      buttonStyle="plain"
                      action={() => setDescExpanded(!descExpanded)}
                    >
                      <HStack spacing={2} alignment="center">
                        <Text font="caption2" foregroundStyle={tint.tint} fontWeight="medium">
                          {descExpanded ? t("detail.collapse") : t("detail.expand")}
                        </Text>
                        <Image
                          systemName={descExpanded ? "chevron.up" : "chevron.down"}
                          font="caption2"
                          foregroundStyle={tint.tint}
                        />
                      </HStack>
                    </Button>
                  ) : null}
                </HStack>
                <Text
                  font="footnote"
                  foregroundStyle={
                    !isLongDescription || descExpanded
                      ? "secondaryLabel"
                      : {
                          colors: ["secondaryLabel", "secondaryLabel", fill.fade],
                          startPoint: "top",
                          endPoint: "bottom",
                        }
                  }
                  lineLimit={!isLongDescription || descExpanded ? undefined : 3}
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                  multilineTextAlignment="leading"
                  onTapGesture={isLongDescription ? () => setDescExpanded(!descExpanded) : undefined}
                >
                  {cleanDescription}
                </Text>
              </VStack>
            ) : null}

            {}
            {detail.recommend && detail.recommend.length > 0 ? (
              <VStack spacing={10} alignment="leading" frame={{ maxWidth: "infinity" }}>
                <HStack alignment="firstTextBaseline" spacing={6}>
                  <Text font="headline" fontWeight="bold">
                    {t("detail.recommendTitle")}
                  </Text>
                  <Text font="caption" fontWeight="medium" foregroundStyle="tertiaryLabel">
                    {detail.recommend.length}
                  </Text>
                  <Spacer />
                </HStack>

                <ScrollView axes="horizontal" scrollIndicator="hidden" padding={{ horizontal: -pageInsets.horizontal }}>
                  <LazyHStack spacing={10} padding={{ horizontal: pageInsets.horizontal, vertical: 8 }}>
                    {detail.recommend.map((item, idx) => {
                      const recCard = recommendCardSize(heroContainerWidth)
                      return (
                        <NavigationLink
                          key={item.id ?? idx}
                          buttonStyle="plain"
                          destination={
                            <ComicDetailScreen
                              sourceKey={sourceKey}
                              comicId={item.id}
                              title={item.title}
                            />
                          }
                        >
                          <VStack alignment="center" spacing={5} frame={{ width: recCard.width }}>
                            <CoverImage
                              sourceKey={sourceKey}
                              url={item.cover}
                              width={recCard.width}
                              height={recCard.height}
                              cornerRadius={radius.md}
                              title={item.title}
                              lifted={true}
                            />
                            <Text
                              font="caption"
                              fontWeight="medium"
                              foregroundStyle="label"
                              lineLimit={1}
                              frame={{ width: recCard.width, alignment: "center" }}
                            >
                              {item.title}
                            </Text>
                          </VStack>
                        </NavigationLink>
                      )
                    })}
                  </LazyHStack>
                </ScrollView>
              </VStack>
            ) : null}

            {}
            <VStack spacing={12}>
              <ChapterListHeader
                selecting={selecting}
                selectedCount={selectedIds.length}
                countText={isGrouped ? `${currentGroupChapters.length} / ${chapters.length}` : String(chapters.length)}
                reverseOrder={reverseOrder}
                canMarkAllRead={unreadCount > 0}
                canDownloadAll={pendingAll.length > 0}
                onToggleSort={() => setReverseOrder(!reverseOrder)}
                onToggleSelecting={() => setSelectionMode(!selecting)}
                onMarkAllRead={markGroupRead}
                onDownloadAll={downloadAll}
              />

              {}
              {isGrouped ? (
                <ScrollView axes="horizontal" scrollIndicator="hidden">
                  <HStack spacing={8} padding={{ vertical: 2 }}>
                    {chapterGroups.map((group: ChapterGroup<ChapterRef>) => {
                      const isCurrentGroup = group.name === activeGroup
                      return (
                        <Chip
                          key={group.name}
                          compact
                          text={group.name}
                          detail={String(group.chapters.length)}
                          selected={isCurrentGroup}
                          onTap={() => {
                            setSelectedGroup(group.name)
                            setSelectedIds([])
                          }}
                        />
                      )
                    })}
                  </HStack>
                </ScrollView>
              ) : null}

              {}
              <LazyVStack spacing={8} swipeActionsContainer={true}>
                {displayChapters.map(chapter => {
                  const isCurrent = resumed?.chapter.epId === chapter.id
                  const locked = chapter.locked === true
                  const read = readIds.has(chapter.id)
                  const download = chapterStates[chapter.id]
                  const settled = isActive(download.state) || download.state === "done"
                  const checked = selectedSet.has(chapter.id)
                  const highlight = selecting ? checked : isCurrent
                  const markVisible = selecting && !locked

                  const body = (
                    <Card background={highlight ? tint.selectedRow : cardBackground}>
                      <HStack
                        spacing={0}
                        padding={rowPadding}
                        frame={{ maxWidth: "infinity" }}
                        contentShape="rect"
                      >
                        {}
                        <ZStack frame={{ width: markVisible ? markSlotWidth : 0, alignment: "leading" }}>
                          <Image
                            systemName={checked ? "checkmark.circle.fill" : "circle"}
                            font="subheadline"
                            fontWeight="medium"
                            foregroundStyle={checked ? tint.tint : "tertiaryLabel"}
                            offset={{ x: markVisible ? 0 : -markSlotWidth - rowPadding.horizontal, y: 0 }}
                            opacity={markVisible ? 1 : 0}
                          />
                        </ZStack>
                        <HStack>
                          {locked ? (
                            <Image systemName="lock.fill" font="caption2" foregroundStyle="tertiaryLabel" />
                          ) : null}
                          <Text
                            font="subheadline"
                            fontWeight={isCurrent ? "bold" : "regular"}
                            foregroundStyle={isCurrent ? tint.tint : read ? "secondaryLabel" : "label"}
                            lineLimit={1}
                          >
                            {chapter.title}
                          </Text>
                          <Spacer />
                          <DownloadStateText state={download} />
                          {isCurrent ? (
                            <HStack
                              spacing={3}
                              padding={{ horizontal: 8, vertical: 3 }}
                              background={tint.tint}
                              clipShape={capsule()}
                            >
                              <Image
                                systemName="clock.arrow.circlepath"
                                font="caption2"
                                foregroundStyle={tint.onTint}
                              />
                              <Text font="caption2" foregroundStyle={tint.onTint} fontWeight="semibold">
                                {resumed ? t("detail.lastReadAtPage", { n: resumed.page + 1 }) : t("detail.lastRead")}
                              </Text>
                            </HStack>
                          ) : selecting || locked ? null : (
                            <Image
                              systemName="chevron.right"
                              font="caption2"
                              foregroundStyle="tertiaryLabel"
                              transition={Transition.opacity()}
                            />
                          )}
                        </HStack>
                      </HStack>
                    </Card>
                  )

                  const row = locked ? (
                    body
                  ) : (
                    <Button
                      buttonStyle="plain"
                      frame={{ maxWidth: "infinity" }}
                      action={() => {
                        if (selecting) {
                          toggleSelected(chapter.id)
                        } else {
                          void presentReader({
                            ...readerProps,
                            epId: chapter.id,
                            initialPage: isCurrent ? resumed?.page : undefined,
                          })
                        }
                      }}
                    >
                      {body}
                    </Button>
                  )

                  const actions: VirtualNode[] = [
                    <Button
                      key="read"
                      title={read ? t("detail.markUnread") : t("detail.markRead")}
                      systemImage={read ? "arrow.uturn.backward.circle" : "checkmark.circle"}
                      action={() => toggleRead(chapter)}
                    />,
                  ]
                  if (!settled) {
                    actions.push(
                      <Button
                        key="download"
                        title={download.state === "none" ? t("detail.download") : t("detail.resumeDownload")}
                        systemImage="arrow.down.circle"
                        action={() => downloadChapter(chapter)}
                      />
                    )
                  }

                  const before = chaptersBefore(chapter)
                  const removable = download.state === "done" || download.state === "partial" || download.state === "failed"
                  const menuItems = selecting ? (
                    <Group />
                  ) : (
                    <Group>
                      <Section>
                        {isActive(download.state) ? (
                          <Button
                            title={t("detail.cancelDownload")}
                            systemImage="xmark.circle"
                            action={() => cancelChapterDownload(chapter)}
                          />
                        ) : download.state !== "done" ? (
                          <Button
                            title={download.state === "none" ? t("detail.download") : t("detail.resumeDownload")}
                            systemImage="arrow.down.circle"
                            action={() => downloadChapter(chapter)}
                          />
                        ) : null}
                      </Section>
                      <Section>
                        <Button
                          title={read ? t("detail.markUnread") : t("detail.markRead")}
                          systemImage={read ? "arrow.uturn.backward.circle" : "checkmark.circle"}
                          action={() => toggleRead(chapter)}
                        />
                        {before.length > 0 ? (
                          <Menu title={t("detail.previousChapters")} systemImage="text.line.first.and.arrowtriangle.forward">
                            <Button
                              title={t("detail.markRead")}
                              systemImage="checkmark.circle"
                              action={() => markChaptersBefore(chapter, true)}
                            />
                            <Button
                              title={t("detail.markUnread")}
                              systemImage="arrow.uturn.backward.circle"
                              action={() => markChaptersBefore(chapter, false)}
                            />
                          </Menu>
                        ) : null}
                      </Section>
                      {removable ? (
                        <Section>
                          <Button
                            title={t("detail.removeDownload")}
                            systemImage="trash"
                            role="destructive"
                            action={() => removeChapterDownload(chapter)}
                          />
                        </Section>
                      ) : null}
                    </Group>
                  )

                  return locked ? (
                    <VStack key={chapter.id} spacing={0} clipShape={cardShape}>
                      {row}
                    </VStack>
                  ) : (
                    <VStack
                      key={chapter.id}
                      spacing={0}
                      clipShape={cardShape}
                      trailingSwipeActions={{ allowsFullSwipe: !selecting, actions: selecting ? [] : actions }}
                      contextMenu={{ menuItems }}
                    >
                      {row}
                    </VStack>
                  )
                })}
              </LazyVStack>
              {}
              <VStack frame={{ height: selecting ? selectionBarClearance : 0 }} />
            </VStack>

          </VStack>
        </ScrollView>
      ) : null}
    </VStack>
  </ZStack>
  )
}

const ACTION_BUTTON = 54
const ACTION_HEIGHT = 64
const ACTION_GAP = 10
export function DetailSkeleton({ cover }: { cover: { width: number; height: number } }) {
  return (
    <ScrollView scrollDisabled={true} scrollContentBackground="hidden">
      <VStack spacing={pageSpacing} padding={pageInsets} frame={{ maxWidth: "infinity" }} accessibilityLabel={t("common.loading")}>
        <HStack spacing={16} alignment="top" frame={{ maxWidth: "infinity" }}>
          <SkeletonBlock width={cover.width} height={cover.height} />
          <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <SkeletonText font="title3" fontWeight="bold" lineLimit={2} length={6} />
            {}
            <SkeletonBlock width={78} height={24} shape="capsule" />
            {}
            <HStack spacing={8}>
              <SkeletonBlock width={46} height={21} />
              <SkeletonBlock width={54} height={21} />
            </HStack>
            {}
            <SkeletonBlock width={52} height={21} />
            <SkeletonText font="footnote" length={2} />
            <SkeletonText font="caption2" length={3} />
          </VStack>
        </HStack>

        {}
        <HStack spacing={ACTION_GAP} alignment="center" frame={{ maxWidth: "infinity" }}>
          <SkeletonBlock height={ACTION_HEIGHT} />
          <SkeletonBlock width={ACTION_BUTTON} height={ACTION_HEIGHT} />
          <SkeletonBlock width={ACTION_BUTTON} height={ACTION_HEIGHT} />
        </HStack>

        {}
        <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <SkeletonBlock width={52} height={21} shape="capsule" />
          <SkeletonBlock width={68} height={21} shape="capsule" />
          <SkeletonBlock width={60} height={21} shape="capsule" />
        </HStack>

        {}
        <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <SkeletonText font="headline" fontWeight="bold" length={2} />
          <SkeletonText font="footnote" lineLimit={3} length={14} />
        </VStack>

        {}
        <VStack spacing={12} frame={{ maxWidth: "infinity" }}>
          <HStack spacing={6} alignment="center" frame={{ maxWidth: "infinity" }}>
            <SkeletonText font="title3" fontWeight="bold" length={2} />
            <SkeletonText font="subheadline" length={1} />
            <Spacer />
            <SkeletonBlock width={28} height={28} shape="capsule" />
            <SkeletonBlock width={28} height={28} shape="capsule" />
          </HStack>
          <VStack spacing={8} frame={{ maxWidth: "infinity" }}>
            {Array.from({ length: 6 }, (_, index) => (
              <VStack key={index} spacing={0} clipShape={cardShape}>
                <Card background={cardBackground}>
                  <HStack padding={rowPadding} frame={{ maxWidth: "infinity" }}>
                    <SkeletonText font="subheadline" length={3} />
                    <Spacer />
                  </HStack>
                </Card>
              </VStack>
            ))}
          </VStack>
        </VStack>
      </VStack>
    </ScrollView>
  )
}

function DownloadStateText({ state }: { state: ChapterDownloadState }) {
  const tint = useTint()
  if (state.state === "queued") {
    return (
      <Text font="caption2" foregroundStyle={tint.tint}>
        {t("detail.downloadQueued")}
      </Text>
    )
  }
  if (state.state === "running") {
    return (
      <Text font="caption2" foregroundStyle={tint.tint}>
        {t("detail.downloadRunning", { done: state.completed, total: state.total })}
      </Text>
    )
  }
  if (state.state === "done") {
    return (
      <Text font="caption2" foregroundStyle={palette.green}>
        {t("detail.downloaded")}
      </Text>
    )
  }
  if (state.state === "partial" || state.state === "failed") {
    return (
      <Text font="caption2" foregroundStyle={palette.orange}>
        {state.total > 0
          ? t("detail.incompleteProgress", { done: state.completed, total: state.total })
          : t("detail.incomplete")}
      </Text>
    )
  }
  return null
}
