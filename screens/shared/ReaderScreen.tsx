import {
  Button,
  Divider,
  GeometryReader,
  HStack,
  Image,
  LazyHStack,
  LazyVStack,
  MagnifyGesture,
  Navigation,
  RoundedRectangle,
  ScrollView,
  ScrollViewReader,
  Spacer,
  Text,
  VStack,
  ZStack,
  useCallback,
  useEffect,
  useMemo,
  useObservable,
  useRef,
  useState,
  type Point,
  type ScrollViewProxy,
} from "scripting"

import type { ChapterRef as LibraryChapterRef, ChapterSession, ReaderChapter } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { describeError } from "../../engine/errors"
import { log } from "../../engine/log"
import { buildChainedSlots, chainSlotId, isWideAspect, rightHalfFirst, type ChainedChapter } from "../../engine/pageslots"
import { hasPro } from "../../engine/pro"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { ChapterImage } from "../../components/ChapterImage"
import { createPageSignal, usePageSignal, type PageSignal } from "../../components/pageSignal"
import { ChapterDrawer } from "../../components/ChapterDrawer"
import { ReaderCornerInfo, ReaderHUD } from "../../components/ReaderHUD"
import { MAX_ZOOM, ZoomableView } from "../../components/ZoomableView"
import { Chip } from "../../design/chip"
import { EmptyState, NoticeBanner, PageLoading } from "../../design/status"
import { fill, neutral, radius, rect } from "../../design/tokens"
import { isFavorite, notifyLibrary, setProgress, toggleFavorite } from "../../library/bookshelf"
import {
  clearPerComicSettings,
  readerAxis,
  resolveReaderSettings,
  savePerComicSettings,
  setReaderSettings,
  type ReaderSettings,
  type SourceViewer,
} from "../../library/readerSettings"
import { isOfflineReadable } from "../../app/offlineReading"
import { groupChapters, resolveInitialGroupName, type ChapterGroup } from "./chapterGrouping"
import { clearUpscaleCache, disposeUpscaleEngine } from "../../engine/upscale"

const TURN_ANIM = Animation.spring({ duration: 0.15, bounce: 0 })
const PREPARE_DELAY = 400

const NEXT_CHAPTER_TRIGGER = 3
const NEXT_CHAPTER_PAGES = 3
const SHORT_CHAPTER_PAGES = 2
const CHAIN_WARM_PAGES = 4
const CHAIN_KEEP_WARM = 2

interface FollowupChapter {
  epId: string
  title: string
  session: ChapterSession
}

function chainKey(epId: string, page: number): string {
  return chainSlotId(epId, String(page))
}

function parseChainKey(id: string): { epId: string; page: number } | null {
  const cut = id.lastIndexOf(":")
  if (cut <= 0) return null
  const page = Number(id.slice(cut + 1))
  if (!Number.isInteger(page) || page < 0) return null
  try {
    return { epId: decodeURIComponent(id.slice(0, cut)), page }
  } catch {
    return null
  }
}

function BoxReporter({
  size,
  onSize,
}: {
  size: { width: number; height: number }
  onSize: (size: { width: number; height: number }) => void
}) {
  useEffect(() => {
    onSize({ width: size.width, height: size.height })
  }, [size.width, size.height])
  return null
}

export type ChapterRef = ReaderChapter

export interface ReaderProps {
  sourceKey: string
  comicId: string
  epId: string
  chapters: ChapterRef[]
  comicTitle: string
  comicCover?: string
  initialPage?: number
  viewer?: SourceViewer
}

type ReaderLayout = {
  viewport: { width: number; height: number }
  safeAreaInsets: { top: number; bottom: number; leading: number; trailing: number }
  hudVisible: ReturnType<typeof useObservable<boolean>>
}

type ReaderStatus =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | null

export function ReaderStatusOverlay({
  status,
  size,
  onRetry,
}: {
  status: ReaderStatus
  size?: { width: number; height: number }
  onRetry?: () => void
}) {
  if (status === null) return null
  const box = size
    ? { width: size.width, height: size.height }
    : { maxWidth: "infinity" as const, maxHeight: "infinity" as const }

  if (status.kind === "loading") {
    return (
      <VStack frame={box}>
        <PageLoading />
      </VStack>
    )
  }

  if (status.kind === "empty") {
    return (
      <VStack frame={box}>
        <EmptyState variant="page" icon="photo.on.rectangle.angled" title={t("reader.noImages")} />
      </VStack>
    )
  }

  return (
    <VStack frame={box}>
      <VStack spacing={10} padding={{ horizontal: 24 }} frame={{ maxWidth: 380 }}>
        <NoticeBanner tone="error" text={t("common.loadFailed", { message: describeError(status.message) })} />
        {onRetry ? <Chip icon="arrow.clockwise" text={t("common.retry")} onTap={onRetry} /> : null}
      </VStack>
    </VStack>
  )
}

function ReaderPageTracker({
  leadingPage,
  session,
  pageCount,
  ready,
  progress,
  nextChapter,
  cornerVisible,
  cornerPage,
  cornerTime,
  safeAreaInsets,
}: {
  leadingPage: PageSignal
  session: ChapterSession | undefined
  pageCount: number
  ready: boolean
  nextChapter?: LibraryChapterRef
  progress: {
    sourceKey: string
    comicId: string
    title: string
    cover?: string
    epId: string
    epTitle: string
  }
  cornerVisible: boolean
  cornerPage: boolean
  cornerTime: boolean
  safeAreaInsets: { top: number; bottom: number; leading: number; trailing: number }
}) {
  const value = usePageSignal(leadingPage)
  const lastPage = Math.max(pageCount - 1, 0)
  const page = Math.min(Math.max(value ?? 0, 0), lastPage)

  useEffect(() => {
    if (!session || pageCount === 0) return
    session.warm(page)
  }, [session, page, pageCount])

  const prefetchedEpId = useRef<string | null>(null)
  useEffect(() => {
    if (!nextChapter || pageCount === 0) return
    if (page < pageCount - NEXT_CHAPTER_TRIGGER) return
    if (prefetchedEpId.current === nextChapter.epId) return
    prefetchedEpId.current = nextChapter.epId
    void comicLibrary().prefetchChapter(nextChapter, NEXT_CHAPTER_PAGES)
  }, [nextChapter, page, pageCount])

  useEffect(() => {
    if (pageCount === 0 || !ready) return
    setProgress({ ...progress, page, pageCount, offline: session?.local ? true : undefined }, { notify: false })
  }, [page, pageCount, ready, progress.sourceKey, progress.comicId, progress.epId, session])

  return (
    <ReaderCornerInfo
      visible={cornerVisible}
      showPage={cornerPage}
      showTime={cornerTime}
      currentPage={Math.min(page + 1, Math.max(pageCount, 1))}
      pageCount={pageCount}
      safeAreaInsets={safeAreaInsets}
    />
  )
}

function ReaderPullTab({
  pull,
  threshold,
  vertical,
  rtl,
}: {
  pull: PageSignal
  threshold: number
  vertical: boolean
  rtl: boolean
}) {
  const overscroll = usePageSignal(pull)
  if (overscroll === null) return null
  const pullProgress = Math.min(1, Math.max(0, (overscroll - 2) / threshold))
  const overscrollPx = Math.min(overscroll, threshold)

  return vertical ? (
    <VStack
      frame={{
        maxWidth: "infinity",
        maxHeight: "infinity",
        alignment: "bottom",
      }}
      allowsHitTesting={false}
      zIndex={50}
    >
      <HStack
        spacing={8}
        padding={{ top: 10, bottom: 10, leading: 16, trailing: 16 }}
        background={{
          style: pullProgress >= 1 ? "thinMaterial" : "ultraThinMaterial",
          shape: {
            type: "capsule",
            style: "continuous",
          },
        }}
        opacity={Math.max(0.15, pullProgress)}
        offset={{
          x: 0,
          y: 45 - overscrollPx,
        }}
      >
        <Image
          systemName="chevron.up"
          font="caption"
          fontWeight={pullProgress >= 1 ? "bold" : "regular"}
          foregroundStyle={pullProgress >= 1 ? "label" : neutral.secondary}
        />
        <Text
          font="caption2"
          fontWeight={pullProgress >= 1 ? "bold" : "medium"}
          foregroundStyle={pullProgress >= 1 ? "label" : neutral.secondary}
        >
          {t("reader.nextChapterShort")}
        </Text>
      </HStack>
    </VStack>
  ) : (
    <HStack
      frame={{
        maxWidth: "infinity",
        maxHeight: "infinity",
        alignment: rtl ? "leading" : "trailing",
      }}
      allowsHitTesting={false}
      zIndex={50}
    >
      <VStack
        alignment="center"
        spacing={8}
        padding={{ top: 18, bottom: 18, leading: 8, trailing: 8 }}
        background={{
          style: pullProgress >= 1 ? "thinMaterial" : "ultraThinMaterial",
          shape: {
            type: "capsule",
            style: "continuous",
          },
        }}
        opacity={Math.max(0.15, pullProgress)}
        offset={{
          x: rtl ? -38 + overscrollPx : 38 - overscrollPx,
          y: 0,
        }}
      >
        <Image
          systemName={rtl ? "chevron.left" : "chevron.right"}
          font="caption"
          fontWeight={pullProgress >= 1 ? "bold" : "regular"}
          foregroundStyle={pullProgress >= 1 ? "label" : neutral.secondary}
        />
        {}
        {t("reader.nextChapterShort")
          .split("")
          .map((char, i) => (
            <Text
              key={String(i)}
              font="caption2"
              fontWeight={pullProgress >= 1 ? "bold" : "medium"}
              foregroundStyle={pullProgress >= 1 ? "label" : neutral.secondary}
            >
              {char}
            </Text>
          ))}
      </VStack>
    </HStack>
  )
}

export function ReaderScreen(props: ReaderProps) {
  const hudVisible = useObservable(false)

  return (
    <GeometryReader
      tabBarVisibility="hidden"
      navigationBarVisibility="hidden"
      statusBarHidden={!hudVisible.value}
    >
      {safeGeometry => (
        <GeometryReader ignoresSafeArea={true}>
          {canvasGeometry => (
            <ReaderContent
              {...props}
              viewport={canvasGeometry.size}
              safeAreaInsets={safeGeometry.safeAreaInsets}
              hudVisible={hudVisible}
            />
          )}
        </GeometryReader>
      )}
    </GeometryReader>
  )
}

function ReaderContent({
  sourceKey,
  comicId,
  epId,
  chapters,
  comicTitle,
  comicCover,
  initialPage,
  viewer,
  viewport,
  safeAreaInsets,
  hudVisible,
}: ReaderProps & ReaderLayout) {
  useSubscription(subscribeLocale)

  const dismiss = Navigation.useDismiss()
  const [session, setSession] = useState<ChapterSession | undefined>(undefined)
  const sessionEpId = useRef<string | null>(null)
  const [followups, setFollowups] = useState<FollowupChapter[]>([])
  const followupsRef = useRef<FollowupChapter[]>([])
  const [focusEpId, setFocusEpId] = useState(epId)
  const focusEpRef = useRef(epId)
  focusEpRef.current = focusEpId
  const loadingNext = useRef<string | null>(null)
  const failedPreload = useRef<Set<string>>(new Set())
  const chainOnRef = useRef(false)
  const [status, setStatus] = useState<ReaderStatus>({ kind: "loading" })
  const [reloadKey, setReloadKey] = useState(0)
  const [currentEpId, setCurrentEpId] = useState(epId)

  const chapterGroups: ChapterGroup<ChapterRef>[] = useMemo(() => groupChapters(chapters), [chapters])
  const isGrouped = chapterGroups.length > 1
  const initialGroupName = useMemo(
    () => resolveInitialGroupName(chapterGroups, currentEpId),
    [chapterGroups, currentEpId]
  )
  const [selectedGroup, setSelectedGroup] = useState<string>("")
  const activeGroup = selectedGroup && chapterGroups.some((g: ChapterGroup<ChapterRef>) => g.name === selectedGroup)
    ? selectedGroup
    : initialGroupName

  const currentGroupChapters: ChapterRef[] = useMemo(() => {
    if (!isGrouped) return chapters
    const currentGroup = chapterGroups.find((g: ChapterGroup<ChapterRef>) => g.chapters.some((c: ChapterRef) => c.id === currentEpId))
    if (currentGroup) return currentGroup.chapters
    const active = chapterGroups.find((g: ChapterGroup<ChapterRef>) => g.name === activeGroup)
    return active ? active.chapters : chapters
  }, [isGrouped, chapterGroups, currentEpId, activeGroup, chapters])

  const [showChapterSheet, setShowChapterSheet] = useState(false)
  const [, bumpFavorite] = useState(0)
  const favorite = isFavorite(sourceKey, comicId)
  const handleToggleFavorite = () => {
    toggleFavorite({ sourceKey, comicId, title: comicTitle, cover: comicCover })
    bumpFavorite(previous => previous + 1)
  }
  const scope = useMemo(() => ({ sourceKey, comicId }), [sourceKey, comicId])
  const [initialSettings] = useState(() => resolveReaderSettings(scope, viewer))
  const [settings, setSettings] = useState<ReaderSettings>(initialSettings.settings)
  const [canUpscale] = useState(() => hasPro())
  const [perComic, setPerComic] = useState(initialSettings.perComic)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const entryEpId = useRef(epId)
  const entryPage = useRef(initialPage)
  const entryRestore = entryPage.current !== undefined && entryPage.current > 0 ? entryPage.current : null
  const entryPending = useRef(true)
  const restoringEntry = entryPending.current && currentEpId === entryEpId.current && entryRestore !== null
  const [leadingPage] = useState(() => createPageSignal(restoringEntry ? entryRestore : null))
  const leadingPageRef = useRef<number | null>(restoringEntry ? entryRestore : null)
  function setLeadingPage(value: number | null) {
    leadingPageRef.current = value
    leadingPage.set(value)
  }
  const restored = useRef(!restoringEntry)
  const scrollProxy = useRef<ScrollViewProxy | null>(null)
  const pendingScroll = useRef<number | null>(null)
  const anchorSlotId = useRef<string | null>(null)
  function scrollToSlot(slot: number) {
    const id = slotsRef.current.slots[slot]?.id
    if (id === undefined) return
    anchorSlotId.current = id
    scrollProxy.current?.scrollTo(id, settings.direction === "ttb" ? "top" : "leading")
  }
  function scrollToPage(page: number) {
    scrollToSlot(focusSlotOf(page))
  }
  function focusSlotOf(page: number): number {
    const slots = slotsRef.current
    const slot = slots.firstSlotOf(focusEpRef.current, page)
    return slot >= 0 ? slot : Math.max(slots.firstSlotOf(currentEpId, page), 0)
  }
  useEffect(() => {
    const page = pendingScroll.current
    if (page === null || !session || status !== null) return
    pendingScroll.current = null
    scrollToPage(page)
  }, [session, status, settings.mode, settings.direction])
  const scrubTarget = useRef<number | null>(null)
  const turnTarget = useRef<number | null>(null)
  const scrollOffset = useRef({ x: 0, y: 0 })
  const pageSizeRef = useRef({ width: 0, height: 0 })
  const restoreTimer = useRef<number | null>(null)
  const scrubTimer = useRef<number | null>(null)
  const turnTimer = useRef<number | null>(null)
  const prepareTimer = useRef<number | null>(null)
  const prepareBase = useRef<number | null>(null)

  const [pullSignal] = useState(() => createPageSignal(null))
  const pullRef = useRef<number | null>(null)
  function setPull(value: number | null) {
    if (value === pullRef.current) return
    pullRef.current = value
    pullSignal.set(value)
  }
  const overscrollRef = useRef(0)
  const isInteractingRef = useRef(false)
  const hasTriggeredFullHapticRef = useRef(false)
  const PULL_THRESHOLD = 65
  const seamlessHold = useRef(0)

  const [zoomed, setZoomed] = useState(false)
  const [zoomEpoch, setZoomEpoch] = useState(0)
  const handleZoomChange = useCallback((value: boolean) => {
    setZoomed(value)
    if (value) {
      turnTarget.current = null
      scrubTarget.current = null
    }
  }, [])
  function releaseZoom() {
    if (!zoomed) return
    setZoomed(false)
    setZoomEpoch(epoch => epoch + 1)
  }

  function clearGate(timer: { current: number | null }) {
    if (timer.current === null) return
    clearTimeout(timer.current)
    timer.current = null
  }

  const index = currentGroupChapters.findIndex(chapter => chapter.id === focusEpId)
  const neighbour = (step: 1 | -1): ChapterRef | undefined => {
    if (index < 0) return undefined
    for (let i = index + step; i >= 0 && i < currentGroupChapters.length; i += step) {
      if (!currentGroupChapters[i].locked) return currentGroupChapters[i]
    }
    return undefined
  }
  const previous = neighbour(-1)
  const next = neighbour(1)
  const title = (index >= 0 ? currentGroupChapters[index]?.title : chapters.find(c => c.id === currentEpId)?.title) || t("reader.chapterFallback", { n: Math.max(1, index + 1) })
  const pageCount = session?.pageCount ?? 0
  const nextRef = useMemo<LibraryChapterRef | undefined>(
    () => (next ? { sourceKey, comicId, epId: next.id } : undefined),
    [next?.id, sourceKey, comicId]
  )

  useEffect(() => {
    let alive = true
    let opened: ChapterSession | undefined
    failedPreload.current.clear()
    setSession(undefined)
    setStatus({ kind: "loading" })
    setLeadingPage(restoringEntry ? entryRestore : null)
    restored.current = !restoringEntry
    void (async () => {
      try {
        const result = await comicLibrary().chapter({ sourceKey, comicId, epId: currentEpId })
        opened = result
        if (!alive) {
          result.dispose()
          return
        }
        sessionEpId.current = currentEpId
        result.warm(restoringEntry && entryPage.current !== undefined ? entryPage.current : 0)
        const wanted = restoringEntry ? entryPage.current : undefined
        const target = wanted !== undefined && wanted > 0 && wanted < result.pageCount ? wanted : null
        pendingScroll.current = target
        anchorSlotId.current = null
        setLeadingPage(target)
        setSession(result)
        result.setHardwareSharpen(settingsRef.current.hardwareSharpen)
        setStatus(result.pageCount === 0 ? { kind: "empty" } : null)
        if (target === null) {
          restored.current = true
        } else {
          clearGate(restoreTimer)
          restoreTimer.current = setTimeout(() => {
            restoreTimer.current = null
            if (alive) restored.current = true
          }, 800)
        }
        setProgress({
          sourceKey,
          comicId,
          title: comicTitle,
          cover: comicCover,
          epId: currentEpId,
          epTitle: title,
          pageCount: result.pageCount,
          offline: result.local ? true : undefined,
        }, { notify: false })
      } catch (error) {
        if (alive) {
          setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) })
        }
      }
    })()
    return () => {
      alive = false
      clearGate(restoreTimer)
      clearGate(scrubTimer)
      clearGate(turnTimer)
      clearGate(prepareTimer)
      prepareBase.current = null
      opened?.dispose()
      const extra = followupsRef.current
      if (extra.length > 0) {
        followupsRef.current = []
        setFollowups([])
        for (const item of extra) item.session.dispose()
      }
    }
  }, [sourceKey, comicId, currentEpId, reloadKey])


  useEffect(() => {
    return () => {
      disposeUpscaleEngine()
      comicLibrary().releasePrefetched()
      notifyLibrary()
    }
  }, [])
  const lastPage = Math.max(pageCount - 1, 0)


  function commitScrub(page: number) {
    if (chainOnRef.current && !paginated) {
      const focused = followupsRef.current.find(item => item.epId === focusEpRef.current)
      const count = focused?.session.pageCount ?? session?.pageCount ?? 0
      const last = Math.max(count - 1, 0)
      const target = Math.min(Math.max(Math.round(page), 0), last)
      if (target === (leadingPageRef.current ?? 0)) return
      releaseZoom()
      setLeadingPage(target)
      const id = chainKey(focusEpRef.current, target)
      void withAnimation(TURN_ANIM, () => {
        scrollProxy.current?.scrollTo(id, settings.direction === "ttb" ? "top" : "leading")
      })
      return
    }
    const focused = chainOnRef.current ? followupsRef.current.find(item => item.epId === focusEpRef.current) : undefined
    const last = Math.max((focused?.session.pageCount ?? pageCount) - 1, 0)
    const clamp = (value: number) => Math.min(Math.max(Math.round(value), 0), last)
    const target = clamp(page)
    if (target === clamp(leadingPageRef.current ?? 0)) return
    releaseZoom()
    const slot = focusSlotOf(target)
    scrubTarget.current = slot
    setLeadingPage(target)
    void withAnimation(TURN_ANIM, () => scrollToSlot(slot))
    clearGate(scrubTimer)
    scrubTimer.current = setTimeout(() => {
      scrubTimer.current = null
      if (scrubTarget.current === slot) scrubTarget.current = null
    }, 600)
  }

  function replaceFollowups(next: FollowupChapter[]) {
    followupsRef.current = next
    setFollowups(next)
  }

  function disposeFollowups() {
    const extra = followupsRef.current
    if (extra.length === 0) return
    replaceFollowups([])
    for (const item of extra) item.session.dispose()
  }

  function selectChapter(id: string) {
    setShowChapterSheet(false)
    if (chapters.find(chapter => chapter.id === id)?.locked) return
    if (chainOnRef.current && (id === currentEpId || followupsRef.current.some(item => item.epId === id))) {
      if (id === focusEpRef.current) return
      focusEpRef.current = id
      setFocusEpId(id)
      setLeadingPage(0)
      const slot = slotsRef.current.firstSlotOf(id, 0)
      if (slot < 0) return
      releaseZoom()
      if (paginated) holdSlot(slot)
      scrollToSlot(slot)
      return
    }
    if (id === currentEpId) return
    disposeFollowups()
    failedPreload.current.clear()
    focusEpRef.current = id
    setFocusEpId(id)
    entryPending.current = false
    setZoomed(false)
    clearGate(restoreTimer)
    clearGate(scrubTimer)
    clearGate(turnTimer)
    scrubTarget.current = null
    turnTarget.current = null

    clearUpscaleCache()
    hasTriggeredFullHapticRef.current = false
    setLeadingPage(0)
    pendingScroll.current = null
    anchorSlotId.current = null
    setSession(undefined)
    setStatus({ kind: "loading" })
    setCurrentEpId(id)
  }

  function goToNext(id: string) {
    if (Date.now() < seamlessHold.current) return
    seamlessHold.current = Date.now() + 900
    selectChapter(id)
  }

  function displayedSlot(): number | null {
    const count = slotsRef.current.slots.length
    if (!paginated || count === 0) return null
    const stride = vertical ? pageSizeRef.current.height : pageSizeRef.current.width
    if (!(stride > 0)) return null
    const offset = vertical ? scrollOffset.current.y : scrollOffset.current.x
    return Math.min(Math.max(Math.round(Math.abs(offset) / stride), 0), count - 1)
  }

  function displayedPage(): number | null {
    const slot = displayedSlot()
    return slot === null ? null : slotsRef.current.locate(slot)?.page ?? null
  }

  function setLeadingSlot(slot: number) {
    const slots = slotsRef.current
    const hit = slots.locate(slot)
    if (!hit) return
    anchorSlotId.current = slots.slots[slot]?.id ?? null
    prepareAfter(slot)
    if (focusEpRef.current !== hit.epId) {
      focusEpRef.current = hit.epId
      setFocusEpId(hit.epId)
    }
    if (leadingPageRef.current !== hit.page) setLeadingPage(hit.page)
  }

  function prepareAfter(slot: number) {
    if (!paginated || prepareBase.current === slot) return
    prepareBase.current = slot
    clearGate(prepareTimer)
    prepareTimer.current = setTimeout(() => {
      prepareTimer.current = null
      const next = slotsRef.current.slots[slot + 1]
      const owner = next ? sessionOfRef.current.get(next.epId) : undefined
      const { width, height } = pageSizeRef.current
      if (!next || !owner || !(width > 0) || !(height > 0)) return
      void owner
        .loadPage(next.page, () => {}, undefined, { width, height, zoom: MAX_ZOOM }, next.half)
        .catch(() => {})
    }, PREPARE_DELAY)
  }

  function turnBase(): number | null {
    const commanded = turnTarget.current ?? scrubTarget.current
    if (commanded !== null) return commanded
    const leading = leadingPageRef.current === null ? null : focusSlotOf(leadingPageRef.current)
    if (!restored.current) return leading
    return displayedSlot() ?? leading
  }

  function holdSlot(slot: number) {
    turnTarget.current = slot
    clearGate(turnTimer)
    turnTimer.current = setTimeout(() => {
      turnTimer.current = null
      if (turnTarget.current === slot) turnTarget.current = null
    }, 600)
  }

  function syncPageFromGeometry() {
    if (!restored.current || turnTarget.current !== null || scrubTarget.current !== null) return
    const slot = displayedSlot()
    if (slot === null) return
    setLeadingSlot(slot)
  }

  function turnPage(delta: 1 | -1) {
    const count = slotsRef.current.slots.length
    if (count === 0) return
    const base = turnBase()
    if (base === null) return
    const target = Math.min(Math.max(base + delta, 0), count - 1)
    if (target === base) return
    releaseZoom()
    holdSlot(target)
    setLeadingSlot(target)
    void withAnimation(TURN_ANIM, () => scrollToSlot(target))
  }

  function handleCanvasTap(location: Point) {
    if (vertical && paginated && settings.tapZones) {
      const vQuarter = pageSize.height / 4
      if (location.y > vQuarter && location.y < vQuarter * 3) {
        toggleHUD()
        return
      }
      turnPage(location.y >= vQuarter * 3 ? 1 : -1)
      return
    }

    if (!settings.tapZones || settings.direction === "ttb") {
      toggleHUD()
      return
    }

    const quarter = pageSize.width / 4
    if (location.x > quarter && location.x < quarter * 3) {
      toggleHUD()
      return
    }
    const forward = rtl ? location.x <= quarter : location.x >= quarter * 3
    turnPage(forward ? 1 : -1)
  }

  const canvasTapRef = useRef(handleCanvasTap)
  canvasTapRef.current = handleCanvasTap
  const onPageTap = useCallback((location: Point) => canvasTapRef.current(location), [])

  const vertical = settings.direction === "ttb"
  const rtl = settings.direction === "rtl"
  const paginated = settings.mode === "gallery"
  const chainOn = settings.seamlessNext
  chainOnRef.current = chainOn
  const focusEntry = chainOn ? followups.find(item => item.epId === focusEpId) : undefined
  const focusSession = focusEntry?.session ?? session
  const focusPageCount = focusEntry ? focusEntry.session.pageCount : pageCount

  useEffect(() => {
    if (!chainOn || !session || status !== null) return
    const anchor = sessionEpId.current
    if (!anchor) return
    const loaded = new Map<string, ChapterSession>()
    if (session) loaded.set(anchor, session)
    for (const item of followupsRef.current) loaded.set(item.epId, item.session)
    const nextUnlocked = (epId: string): ChapterRef | undefined => {
      const start = currentGroupChapters.findIndex(chapter => chapter.id === epId)
      if (start < 0) return undefined
      for (let i = start + 1; i < currentGroupChapters.length; i++) {
        if (!currentGroupChapters[i].locked) return currentGroupChapters[i]
      }
      return undefined
    }
    let cursor = loaded.has(focusEpRef.current) ? focusEpRef.current : anchor
    let nextChapter: ChapterRef | undefined
    for (let guard = 0; guard < 8; guard++) {
      const candidate = nextUnlocked(cursor)
      if (!candidate) return
      const existing = loaded.get(candidate.id)
      if (!existing) {
        nextChapter = candidate
        break
      }
      if (existing.pageCount > SHORT_CHAPTER_PAGES) return
      cursor = candidate.id
    }
    if (!nextChapter) return
    const epIdToLoad = nextChapter.id
    if (failedPreload.current.has(epIdToLoad) || loadingNext.current === epIdToLoad) return
    const epTitle = nextChapter.title ?? ""
    const delay = session.pageCount <= SHORT_CHAPTER_PAGES ? 0 : 700
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled || loadingNext.current === epIdToLoad || failedPreload.current.has(epIdToLoad)) return
      loadingNext.current = epIdToLoad
      void loadFollowup()
    }, delay)
    async function loadFollowup() {
      try {
        const opened = await comicLibrary().chapter({ sourceKey, comicId, epId: epIdToLoad })
        if (cancelled) {
          opened.dispose()
          return
        }
        opened.setHardwareSharpen(settingsRef.current.hardwareSharpen)
        if (cancelled) {
          opened.dispose()
          return
        }
        if (followupsRef.current.some(item => item.epId === epIdToLoad)) {
          opened.dispose()
          return
        }
        followupsRef.current = [...followupsRef.current, { epId: epIdToLoad, title: epTitle, session: opened }]
        replaceFollowups(followupsRef.current)
        const head = Math.min(opened.pageCount, CHAIN_WARM_PAGES)
        if (head > 0) void opened.warmAhead(head)
      } catch (error) {
        failedPreload.current.add(epIdToLoad)
        log("debug", "reader", `${epIdToLoad} 預加載下一集失敗`, error)
      } finally {
        if (loadingNext.current === epIdToLoad) loadingNext.current = null
      }
    }
    return () => {
      cancelled = true
      clearTimeout(timer)
      if (loadingNext.current === epIdToLoad) loadingNext.current = null
    }
  }, [chainOn, session, status, focusEpId, followups.length, currentGroupChapters, sourceKey, comicId])

  useEffect(() => {
    if (!chainOn || settings.hardwareSharpen) return
    const order = [currentEpId, ...followups.map(item => item.epId)]
    const at = order.indexOf(focusEpId)
    if (at < 0) return
    for (let i = 0; i < order.length; i++) {
      if (Math.abs(i - at) <= CHAIN_KEEP_WARM) continue
      if (i === 0) {
        session?.dropCache()
        continue
      }
      followups.find(item => item.epId === order[i])?.session.dropCache()
    }
  }, [chainOn, focusEpId, followups, currentEpId, session, settings.hardwareSharpen])

  useEffect(() => {
    if (chainOn) return
    disposeFollowups()
    if (focusEpRef.current !== currentEpId) {
      focusEpRef.current = currentEpId
      setFocusEpId(currentEpId)
      setLeadingPage(0)
    }
  }, [chainOn, currentEpId])

  const splitActive = paginated && settings.splitWide
  const splitActiveRef = useRef(splitActive)
  splitActiveRef.current = splitActive
  const [wideVersion, setWideVersion] = useState(0)
  useEffect(() => {
    if (!session) return
    const sessions = [session, ...followups.map(item => item.session)]
    const unsubscribes = sessions.map(item =>
      item.subscribeAspects((_, aspect) => {
        if (splitActiveRef.current && isWideAspect(aspect)) setWideVersion(version => version + 1)
      })
    )
    if (splitActiveRef.current) setWideVersion(version => version + 1)
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  }, [session, followups])
  const pageSlots = useMemo(() => {
    const wideOf = (owner: ChapterSession) =>
      splitActive ? (page: number) => isWideAspect(owner.aspectOf(page)) : null
    const list: ChainedChapter[] = [
      { epId: currentEpId, pageCount, isWide: session ? wideOf(session) : null },
    ]
    if (chainOn) {
      for (const item of followups) {
        list.push({ epId: item.epId, pageCount: item.session.pageCount, isWide: wideOf(item.session) })
      }
    }
    return buildChainedSlots(list, rightHalfFirst(settings.direction, settings.splitSwap))
  }, [session, currentEpId, pageCount, chainOn, followups, splitActive, settings.direction, settings.splitSwap, wideVersion])
  const sessionOf = useMemo(() => {
    const map = new Map<string, ChapterSession>()
    if (session) map.set(currentEpId, session)
    for (const item of followups) map.set(item.epId, item.session)
    return map
  }, [session, currentEpId, followups])
  const slotsRef = useRef(pageSlots)
  slotsRef.current = pageSlots
  const sessionOfRef = useRef(sessionOf)
  sessionOfRef.current = sessionOf
  useEffect(() => {
    if (session && status === null) prepareAfter(focusSlotOf(leadingPageRef.current ?? 0))
  }, [session, status, paginated])

  const previousSlots = useRef(pageSlots)
  useEffect(() => {
    const before = previousSlots.current
    previousSlots.current = pageSlots
    const anchor = anchorSlotId.current
    if (before === pageSlots || !paginated || anchor === null) return
    const from = before.indexOf(anchor)
    if (from < 0) return
    let to = pageSlots.indexOf(anchor)
    if (to < 0) {
      const hit = before.locate(from)
      to = hit ? pageSlots.firstSlotOf(hit.epId, hit.page) : -1
    }
    if (to < 0) return
    const id = pageSlots.slots[to]?.id ?? null
    anchorSlotId.current = id
    if (to === from || id === null) return
    holdSlot(to)
    scrollProxy.current?.scrollTo(id, vertical ? "top" : "leading")
  }, [pageSlots])

  const axes = readerAxis(settings.direction)
  const [canvasBox, setCanvasBox] = useState<{ width: number; height: number } | null>(null)
  const pageSize = canvasBox ?? viewport
  pageSizeRef.current = pageSize

  function reportCanvasBox(size: { width: number; height: number }) {
    const next = { width: Math.round(size.width), height: Math.round(size.height) }
    if (next.width <= 0 || next.height <= 0) return
    setCanvasBox(previous =>
      previous && previous.width === next.width && previous.height === next.height ? previous : next
    )
  }

  const [renderGeneration, setRenderGeneration] = useState(0)

  function updateSettings(patch: Partial<ReaderSettings>) {
    const next = { ...settings, ...patch }
    if (next.mode !== settings.mode || next.direction !== settings.direction) {
      const page = displayedPage() ?? leadingPageRef.current ?? 0
      clearGate(turnTimer)
      clearGate(scrubTimer)
      turnTarget.current = null
      scrubTarget.current = null
      setZoomed(false)
      setLeadingPage(page)
      pendingScroll.current = page
      anchorSlotId.current = null
      if (page > 0) {
        restored.current = false
        clearGate(restoreTimer)
        restoreTimer.current = setTimeout(() => {
          restoreTimer.current = null
          restored.current = true
        }, 800)
      }
    }
    setSettings(next)
    if (perComic) savePerComicSettings(scope, next)
    else if (!viewer) setReaderSettings(next)
    if (patch.hardwareSharpen !== undefined && session) {
      session.setHardwareSharpen(patch.hardwareSharpen)
      for (const item of followupsRef.current) item.session.setHardwareSharpen(patch.hardwareSharpen)
      setRenderGeneration(g => g + 1)
    }
  }

  function togglePerComic(on: boolean) {
    if (on) {
      savePerComicSettings(scope, settings)
      setPerComic(true)
      return
    }
    clearPerComicSettings(scope)
    setPerComic(false)
    const fallback = resolveReaderSettings(scope, viewer).settings
    setSettings(fallback)
    if (session) {
      session.setHardwareSharpen(fallback.hardwareSharpen)
      for (const item of followupsRef.current) item.session.setHardwareSharpen(fallback.hardwareSharpen)
    }
    if (fallback.hardwareSharpen !== settings.hardwareSharpen) setRenderGeneration(g => g + 1)
  }

  const pages = useMemo(
    () =>
      session
        ? paginated
          ? pageSlots.slots.map((slot, i) => {
              const owner = sessionOf.get(slot.epId)
              if (!owner) return null
              return (
                <ZStack key={slot.id} tag={i} frame={{ width: pageSize.width, height: pageSize.height }}>
                  <ZoomableView
                    contentSize={pageSize}
                    box={pageSize}
                    resetToken={`${slot.epId}:${zoomEpoch}`}
                    onSingleTap={onPageTap}
                    onZoomChange={handleZoomChange}
                  >
                    <ChapterImage
                      key={`${slot.id}:${renderGeneration}`}
                      session={owner}
                      index={slot.page}
                      half={slot.half}
                      size={{ width: pageSize.width, height: pageSize.height, zoom: MAX_ZOOM }}
                    />
                  </ZoomableView>
                </ZStack>
              )
            })
          : Array.from({ length: pageCount }, (_, i) => {
              const id = chainKey(currentEpId, i)
              if (!vertical) {
                return (
                  <HStack key={id} tag={i} frame={{ height: pageSize.height }} alignment="center">
                    <ChapterImage
                      key={`${id}:${renderGeneration}`}
                      session={session}
                      index={i}
                      size={{ height: pageSize.height }}
                    />
                  </HStack>
                )
              }
              return (
                <VStack key={id} tag={i} frame={{ maxWidth: "infinity" }}>
                  <ChapterImage
                    key={`${id}:${renderGeneration}`}
                    session={session}
                    index={i}
                    size={{ width: pageSize.width }}
                  />
                </VStack>
              )
            })
        : [],
    [session, sessionOf, pageCount, pageSlots, paginated, vertical, currentEpId, pageSize.width, pageSize.height, renderGeneration, zoomEpoch],
  )

  const followupPages = useMemo(
    () =>
      chainOn && !paginated
        ? followups.flatMap(item =>
            Array.from({ length: item.session.pageCount }, (_, i) => {
              const id = chainKey(item.epId, i)
              if (!vertical) {
                return (
                  <HStack key={id} frame={{ height: pageSize.height }} alignment="center">
                    <ChapterImage
                      key={`${id}:${renderGeneration}`}
                      session={item.session}
                      index={i}
                      size={{ height: pageSize.height }}
                    />
                  </HStack>
                )
              }
              return (
                <VStack key={id} frame={{ maxWidth: "infinity" }}>
                  <ChapterImage
                    key={`${id}:${renderGeneration}`}
                    session={item.session}
                    index={i}
                    size={{ width: pageSize.width }}
                  />
                </VStack>
              )
            })
          )
        : [],
    [chainOn, paginated, followups, vertical, pageSize.width, pageSize.height, renderGeneration]
  )

  const endOfBookText = t("reader.endOfBook")
  const slotCount = pageSlots.slots.length
  const endCard = useMemo(
    () =>
      next ? null : paginated || !vertical ? (
        <ZStack
          key="end"
          tag={paginated ? slotCount : pageCount}
          frame={
            paginated
              ? { width: pageSize.width, height: pageSize.height }
              : { height: pageSize.height }
          }
          contentShape={paginated ? "rect" : undefined}
          onTapGesture={paginated ? { count: 1, coordinateSpace: "global", perform: onPageTap } : undefined}
        >
          <HStack spacing={0} padding={{ top: 40, bottom: 100 }}>
            <Spacer />
            <Text font="caption" foregroundStyle="tertiaryLabel">
              {endOfBookText}
            </Text>
            <Spacer />
          </HStack>
        </ZStack>
      ) : (
        <HStack spacing={0} padding={{ top: 40, bottom: 100 }}>
          <Spacer />
          <Text font="caption" foregroundStyle="tertiaryLabel">
            {endOfBookText}
          </Text>
          <Spacer />
        </HStack>
      ),
    [next, paginated, vertical, slotCount, pageCount, pageSize.width, pageSize.height, onPageTap, endOfBookText]
  )


  function toggleHUD() {
    hudVisible.setValue(!hudVisible.value)
  }

  const onSelectChapter = useCallback((id: string) => selectChapter(id), [chapters, currentEpId, settings])
  const onCloseDrawer = useCallback(() => setShowChapterSheet(false), [])
  const isDownloadedChapter = useCallback(
    (epId: string) => isOfflineReadable({ sourceKey, comicId, epId }),
    [sourceKey, comicId]
  )
  const chapterDrawer = useMemo(
    () => (
      <ChapterDrawer
        currentEpId={focusEpId}
        chapters={chapters}
        chapterGroups={chapterGroups}
        isGrouped={isGrouped}
        isDownloaded={isDownloadedChapter}
        onSelectChapter={onSelectChapter}
        onClose={onCloseDrawer}
      />
    ),
    [focusEpId, chapters, chapterGroups, isGrouped, isDownloadedChapter, onSelectChapter, onCloseDrawer]
  )

  return (
    <VStack
      spacing={0}
      tabBarVisibility="hidden"
      navigationBarVisibility="hidden"
      statusBarHidden={!hudVisible.value}
      ignoresSafeArea={true}
      environments={{ colorScheme: "dark" }}
      background={fill.canvas}
      sheet={{
        isPresented: showChapterSheet,
        onChanged: setShowChapterSheet,
        content: chapterDrawer,
      }}
    >
      <ZStack
        alignment="top"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        background={
          <GeometryReader>
            {geometry => (
              <BoxReporter
                size={{ width: geometry.size.width, height: geometry.size.height }}
                onSize={reportCanvasBox}
              />
            )}
          </GeometryReader>
        }
      >

        {}
        <ScrollViewReader>
          {proxy => {
            scrollProxy.current = proxy
            return (
              <ScrollView
                key={`${currentEpId}-${settings.mode}-${settings.direction}`}
                axes={axes}
                scrollDisabled={zoomed}
                scrollIndicator="never"
                scrollTargetBehavior={
                  paginated
                    ? vertical
                      ? "viewAlignedLimitAlwaysByOne"
                      : "paging"
                    : undefined
                }
                onScrollTargetVisibilityChange={{
                  idType: "string",
                  threshold: 0.0,
                  onChanged: ids => {
                    if (!restored.current) return
                    if (chainOn && !paginated) {
                      const visible = (ids as string[])
                        .map(parseChainKey)
                        .filter((item): item is { epId: string; page: number } => item !== null)
                      if (visible.length === 0) return
                      const rank = (ep: string, page: number) => {
                        if (ep === currentEpId) return page
                        let base = pageCount
                        for (const item of followups) {
                          if (item.epId === ep) return base + page
                          base += item.session.pageCount
                        }
                        return Number.MAX_SAFE_INTEGER
                      }
                      let best = visible[0]
                      let bestRank = rank(best.epId, best.page)
                      for (let i = 1; i < visible.length; i++) {
                        const item = visible[i]
                        const value = rank(item.epId, item.page)
                        if (value < bestRank) {
                          best = item
                          bestRank = value
                        }
                      }
                      if (bestRank === Number.MAX_SAFE_INTEGER) return
                      if (focusEpRef.current !== best.epId) {
                        focusEpRef.current = best.epId
                        setFocusEpId(best.epId)
                      }
                      if (leadingPageRef.current !== best.page) setLeadingPage(best.page)
                      return
                    }
                    const indexes = (ids as string[])
                      .map(value => slotsRef.current.indexOf(value))
                      .filter(value => value >= 0)
                    if (indexes.length === 0) return
                    const leading = Math.min(...indexes)
                    const pending = scrubTarget.current ?? turnTarget.current
                    if (pending !== null) {
                      if (leading === pending) {
                        scrubTarget.current = null
                        turnTarget.current = null
                      }
                      return
                    }
                    setLeadingSlot(leading)
                  },
                }}
                environments={rtl ? { layoutDirection: "rightToLeft" } : undefined}
                onTapGesture={
                  !paginated || status !== null
                    ? { count: 1, coordinateSpace: "global", perform: handleCanvasTap }
                    : undefined
                }
                onScrollGeometryChange={{
                  of: "geometry",
                  onChanged: (_, geo) => {
                    scrollOffset.current = { x: geo.contentOffset.x, y: geo.contentOffset.y }
                    syncPageFromGeometry()
                    if (!next) return
                    if (pageCount > 0 && leadingPageRef.current !== null && leadingPageRef.current < lastPage - 1) {
                      if (pullRef.current !== null) {
                        setPull(null)
                        overscrollRef.current = 0
                      }
                      return
                    }

                    let overscroll = 0
                    let maxScroll = 0
                    let offset = 0
                    if (vertical) {
                      maxScroll = Math.max(0, geo.contentSize.height - geo.containerSize.height)
                      offset = geo.contentOffset.y
                      overscroll = offset - maxScroll
                    } else if (rtl) {
                      maxScroll = Math.max(0, geo.contentSize.width - geo.containerSize.width)
                      offset = Math.abs(geo.contentOffset.x)
                      overscroll = offset - maxScroll
                    } else {
                      maxScroll = Math.max(0, geo.contentSize.width - geo.containerSize.width)
                      offset = geo.contentOffset.x
                      overscroll = offset - maxScroll
                    }
                    overscrollRef.current = overscroll

                    if (overscroll > 2) {
                      const p = Math.min(1, Math.max(0, (overscroll - 2) / PULL_THRESHOLD))
                      setPull(overscroll)
                      if (p >= 1 && !chainOn) {
                        if (!hasTriggeredFullHapticRef.current) {
                          hasTriggeredFullHapticRef.current = true
                          HapticFeedback.mediumImpact()
                        }
                      } else {
                        hasTriggeredFullHapticRef.current = false
                      }
                    } else {
                      hasTriggeredFullHapticRef.current = false
                      setPull(null)
                    }
                  },
                }}
                onScrollPhaseChange={(oldPhase, newPhase) => {
                  if (newPhase === "interacting" || newPhase === "tracking") {
                    isInteractingRef.current = true
                  }
                  if (newPhase === "interacting") {
                    turnTarget.current = null
                    scrubTarget.current = null
                  }
                  if (
                    isInteractingRef.current &&
                    (newPhase === "decelerating" || newPhase === "idle")
                  ) {
                    isInteractingRef.current = false
                    hasTriggeredFullHapticRef.current = false
                    const pulled = overscrollRef.current
                    if (!chainOn && next && pulled >= PULL_THRESHOLD) goToNext(next.id)
                    setPull(null)
                    overscrollRef.current = 0
                  }
                }}
              >
                {status !== null ? (
                  <ReaderStatusOverlay status={status} size={pageSize} onRetry={() => setReloadKey(key => key + 1)} />
                ) : vertical ? (
                  <LazyVStack
                    spacing={0}
                    scrollTargetLayout={true}
                    frame={{ maxWidth: "infinity" }}
                  >
                    {pages}
                    {followupPages}
                    {endCard}
                  </LazyVStack>
                ) : (
                  <LazyHStack
                    spacing={0}
                    scrollTargetLayout={true}
                    frame={{ maxHeight: "infinity" }}
                  >
                    {pages}
                    {followupPages}
                    {endCard}
                  </LazyHStack>
                )}
              </ScrollView>
            )
          }}
        </ScrollViewReader>

        {}
        {next && !chainOn ? (
          <ReaderPullTab pull={pullSignal} threshold={PULL_THRESHOLD} vertical={vertical} rtl={rtl} />
        ) : null}

        {}
        {status?.kind === "loading" ? (
          <VStack
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            alignment="center"
            allowsHitTesting={false}
            zIndex={40}
          >
            <PageLoading />
          </VStack>
        ) : null}

        {}
        <ReaderPageTracker
          leadingPage={leadingPage}
          session={focusSession}
          pageCount={focusPageCount}
          ready={focusEntry ? true : sessionEpId.current === currentEpId}
          progress={{
            sourceKey,
            comicId,
            title: comicTitle,
            cover: comicCover,
            epId: focusEpId,
            epTitle: title,
          }}
          cornerVisible={!hudVisible.value && status === null}
          cornerPage={settings.cornerPage}
          cornerTime={settings.cornerTime}
          safeAreaInsets={safeAreaInsets}
          nextChapter={chainOn ? undefined : nextRef}
        />

        {}
        <ReaderHUD
          hudVisible={hudVisible}
          canUpscale={canUpscale}
          safeAreaInsets={safeAreaInsets}
          comicTitle={comicTitle}
          chapterTitle={title}
          settings={settings}
          onUpdateSettings={updateSettings}
          perComic={perComic}
          onTogglePerComic={togglePerComic}
          onDismiss={dismiss}
          onOpenChapterSheet={() => setShowChapterSheet(true)}
          onToggleHUD={toggleHUD}
          favorite={favorite}
          onToggleFavorite={handleToggleFavorite}
          previousChapter={previous}
          nextChapter={next}
          chapterIndex={index + 1}
          totalChapters={currentGroupChapters.length}
          onSelectChapter={selectChapter}
          pageCount={focusPageCount}
          leadingPage={leadingPage}
          onScrubCommit={commitScrub}
        />

      </ZStack>
    </VStack>
  )
}


