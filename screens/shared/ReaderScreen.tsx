// 閱讀器：沉浸式全螢幕漫畫閱讀器。
//
// 架構與手勢約定：
// 1. 純黑畫布（fill.canvas），隱藏 TabBar、NavigationBar 與狀態列。
// 2. 全螢幕 HUD Overlay：以 offset / opacity 屬性動畫收放；目錄走原生 Bottom Sheet，設定走系統 Menu。
// 3. 閱讀模式：畫廊（分頁吸附）與連續（平滑捲動）；方向支援橫向（LTR/RTL）與縱向（TTB）。
// 4. 進度追蹤：以 onScrollTargetVisibilityChange 領先可見頁為準，就地換話不堆疊 route。
// 5. 逐話選來源：開哪一話由 `comicLibrary().chapter()` 決定（本機讀得到就讀本機），這裡沒有離線分支。
// 6. 翻頁分區：橫向模式左右 1/4 翻頁、中間 1/2 切換 HUD（手勢採 global 座標系）。

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
import { buildPageSlots, isWideAspect, rightHalfFirst } from "../../engine/pageslots"
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

/** 單擊翻頁的滑動動畫（需以 withAnimation 包覆捲動指令）。 */
const TURN_ANIM = Animation.spring({ duration: 0.15, bounce: 0 })

/** 距末頁還剩幾頁就開始把下一話前幾頁抓到磁碟（太早會跟當前話的預取搶頻寬、多耗流量）。 */
const NEXT_CHAPTER_TRIGGER = 3
/** 下一話先抓幾頁。 */
const NEXT_CHAPTER_PAGES = 3
/** 少於等於這頁數的章（請假條那種半頁）算短章，後面還要再接一章，不然滑不到底、下一章不會出現。 */
const SHORT_CHAPTER_PAGES = 2
/** 接上的下一章只在背景先備這幾頁，避免整話解碼把滑動卡住。 */
const CHAIN_WARM_PAGES = 4

/** 接在目前這話後面的下一集（同一條捲動，不重開閱讀器）。 */
interface FollowupChapter {
  epId: string
  title: string
  session: ChapterSession
}

/** 連續預加載時的捲動目標：話 id 裡的冒號會被編碼，所以用最後一個冒號切頁碼。 */
function chainKey(epId: string, page: number): string {
  return `${encodeURIComponent(epId)}:${page}`
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

/** 量到就回報（放在 `background` 的 `GeometryReader` 裡，不影響版面）。 */
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

/** 閱讀器的章節項：就是離線層清單快取的形狀（`readerChapters()` 給的清單直接放進來）。 */
export type ChapterRef = ReaderChapter

export interface ReaderProps {
  sourceKey: string
  comicId: string
  epId: string
  /** 顯示用的章節清單（已由 `mergeChapterList` 把下載中的章併進來）；清單換新不會打斷正在讀的那一話。 */
  chapters: ChapterRef[]
  comicTitle: string
  comicCover?: string
  /** 開啟時要跳到的頁碼（0 起算）。只給「繼續閱讀」用；換話不帶，一律從頭。 */
  initialPage?: number
  /** 源宣告的閱讀方式（Aidoku 的 viewer）；沒有就退全域設定。 */
  viewer?: SourceViewer
}

type ReaderLayout = {
  viewport: { width: number; height: number }
  safeAreaInsets: { top: number; bottom: number; leading: number; trailing: number }
  hudVisible: ReturnType<typeof useObservable<boolean>>
}

/**
 * 開章狀態（蓋在畫布上的遮罩）。**不存顯示字串**：載入與空章的句子在 render 時才由字典求值
 * （切語言要跟著換），只有源的錯誤訊息是原樣帶著的字（那不是我們的文案）。
 * `null`＝沒話要說（開好了、有圖）。
 */
type ReaderStatus =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | null

/**
 * 開章狀態（蓋在純黑畫布上）：載入＝`PageLoading`、空章＝`EmptyState`、失敗＝錯誤橫幅＋重試。
 * 跟其他頁同一套狀態語言，就是不出頁面底色。
 */
export function ReaderStatusOverlay({
  status,
  size,
  onRetry,
}: {
  /** 要顯示的狀態；`null` 不畫任何東西。 */
  status: ReaderStatus
  /** 畫布大小（畫廊模式要跟一頁一樣大，不然捲動區會被撐歪）。 */
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

/**
 * 頁碼的葉子：訂閱 `leadingPage` 訊號，翻頁要做的事（預取、寫進度、角落頁碼）都在這裡。
 * 拖曳列跟隨由 HUD 的 ReaderScrubber 自己訂閱。
 */
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
  /** 下一話（跳過鎖定章）；接近末頁時先把它的前幾頁抓到磁碟。 */
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

  // 頁碼落定 → 補預取（以這一頁為中心往前 3）。
  useEffect(() => {
    if (!session || pageCount === 0) return
    session.warm(page)
  }, [session, page, pageCount])

  // 接近末頁 → 下一話前幾頁先下來，換話的第一頁不必等一輪往返。
  // 一話只觸發一次（快取已經在磁碟上，換回來也不用再做）。
  const prefetchedEpId = useRef<string | null>(null)
  useEffect(() => {
    if (!nextChapter || pageCount === 0) return
    if (page < pageCount - NEXT_CHAPTER_TRIGGER) return
    if (prefetchedEpId.current === nextChapter.epId) return
    prefetchedEpId.current = nextChapter.epId
    void comicLibrary().prefetchChapter(nextChapter, NEXT_CHAPTER_PAGES)
  }, [nextChapter, page, pageCount])

  // 進度：還沒回報時當成第 1 頁（單張圖不會有可見集合回呼）。
  useEffect(() => {
    if (pageCount === 0 || !ready) return
    // 不廣播：背景畫面等離開閱讀器時一次更新（見下方 unmount）。
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
  // 語言一換就重繪：這個畫面的字（HUD、目錄、閱讀設定、狀態遮罩）都是 render 時求值的。
  useSubscription(subscribeLocale)

  const dismiss = Navigation.useDismiss()
  // 這一話的取圖 session（頁數、圖片鍵、離線狀態都在裡面）；換話就整個換掉。
  const [session, setSession] = useState<ChapterSession | undefined>(undefined)
  // session 屬於哪一話：換話那一輪 render 還拿著舊 session，進度不能用它的頁數寫新話。
  const sessionEpId = useRef<string | null>(null)
  // 預加載接在後面的下一集。捲動不重建，所以不會閃黑、也不會跳回頂端。
  const [followups, setFollowups] = useState<FollowupChapter[]>([])
  const followupsRef = useRef<FollowupChapter[]>([])
  followupsRef.current = followups
  // 畫面上正在看的那一話。跟 currentEpId（這條捲動的第一話）可以不同。
  const [focusEpId, setFocusEpId] = useState(epId)
  const focusEpRef = useRef(epId)
  focusEpRef.current = focusEpId
  const loadingNext = useRef<string | null>(null)
  const failedPreload = useRef<Set<string>>(new Set())
  const chainOnRef = useRef(false)
  const [status, setStatus] = useState<ReaderStatus>({ kind: "loading" })
  // 重試：把開章流程再跑一次（換 key 讓 effect 重跑，不動翻頁與進度狀態）。
  const [reloadKey, setReloadKey] = useState(0)
  // 目前正在讀的一話。換話只改這個 state、不推新頁（詳見 ChapterLink）。
  const [currentEpId, setCurrentEpId] = useState(epId)

  // 章節分組（支援 MangaDex 等多語言 / 多卷來源）
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

  // 當前話所在的分組章節清單（用來決定上一話/下一話與目錄預設清單，防止上一話/下一話跳去其他語言）
  const currentGroupChapters: ChapterRef[] = useMemo(() => {
    if (!isGrouped) return chapters
    const currentGroup = chapterGroups.find((g: ChapterGroup<ChapterRef>) => g.chapters.some((c: ChapterRef) => c.id === currentEpId))
    if (currentGroup) return currentGroup.chapters
    const active = chapterGroups.find((g: ChapterGroup<ChapterRef>) => g.name === activeGroup)
    return active ? active.chapters : chapters
  }, [isGrouped, chapterGroups, currentEpId, activeGroup, chapters])

  // 目錄抽屜
  const [showChapterSheet, setShowChapterSheet] = useState(false)
  // 收藏狀態：每次 render 重新從書架讀取（不在 useState 裡留副本，否則會與
  // 詳情頁那邊的改動不同步）；bumpFavorite 只負責讓點擊當下立刻重繪。
  const [, bumpFavorite] = useState(0)
  const favorite = isFavorite(sourceKey, comicId)
  const handleToggleFavorite = () => {
    toggleFavorite({ sourceKey, comicId, title: comicTitle, cover: comicCover })
    bumpFavorite(previous => previous + 1)
  }
  // 閱讀設定：這本的獨立設定 → 源的 viewer（只換模式與方向）→ 全域。只算一次。
  const scope = useMemo(() => ({ sourceKey, comicId }), [sourceKey, comicId])
  const [initialSettings] = useState(() => resolveReaderSettings(scope, viewer))
  const [settings, setSettings] = useState<ReaderSettings>(initialSettings.settings)
  // 超分要 Scripting Pro 的本機 HttpServer；沒有 Pro 時開關看得見但按不下去。
  // 只問一次：這是同步原生呼叫，不該跟著每次翻頁跑。
  const [canUpscale] = useState(() => hasPro())
  // 這本有沒有自己的設定（HUD 的 per-comic 開關）。
  const [perComic, setPerComic] = useState(initialSettings.perComic)
  // 開章的非同步流程不能把 settings 放進 deps（會重開章）；用 ref 讀當下的值。
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  // 領先可見頁（0 起算）：畫廊/連續都看 onScrollTargetVisibilityChange 回報的可見集合。
  // 有還原目標時，先用目標頁當初始值，所以一進來頁碼就是對的（不是等回報才更新）。
  // 還原目標只認「開啟這一頁時指定的那一話」（entryEpId）；換話一律從頭。
  const entryEpId = useRef(epId)
  const entryPage = useRef(initialPage)
  const entryRestore = entryPage.current !== undefined && entryPage.current > 0 ? entryPage.current : null
  // 換過一次話就不再還原（換回來也一樣），否則會把後來讀到的位置拉回進入頁。
  const entryPending = useRef(true)
  const restoringEntry = entryPending.current && currentEpId === entryEpId.current && entryRestore !== null
  // 頁碼是純 JS 訊號，只有訂閱的葉子（ReaderPageTracker、ReaderScrubber）重繪。
  // 不用 useObservable：它每次 setValue 都會重繪這整個閱讀器。
  const [leadingPage] = useState(() => createPageSignal(restoringEntry ? entryRestore : null))
  const leadingPageRef = useRef<number | null>(restoringEntry ? entryRestore : null)
  /** 寫頁碼：ref 給手勢／閘門同步讀，訊號給葉子訂閱。 */
  function setLeadingPage(value: number | null) {
    leadingPageRef.current = value
    leadingPage.set(value)
  }
  // 還原捲動完成前忽略可見集合回報，避免頂端初次回報覆蓋進度
  const restored = useRef(!restoringEntry)
  // 跳頁用 ScrollViewReader 下單向指令：不綁 scrollPosition，原生捲動不寫回，閱讀器不跟著重繪。
  const scrollProxy = useRef<ScrollViewProxy | null>(null)
  // ScrollView 重建中（開章還原／換模式）頁面還沒排出來，scrollTo 會落空：先記著，畫好再捲。
  const pendingScroll = useRef<number | null>(null)
  // 目前畫面上那一格的 id：畫廊前面插格（寬圖切開）時用它捲回原位。
  const anchorSlotId = useRef<string | null>(null)
  /** 立刻捲到某一格（翻頁、拖曳列；包在 withAnimation 裡就有動畫）。 */
  function scrollToSlot(slot: number) {
    const id = slotsRef.current.slots[slot]?.id ?? String(slot)
    anchorSlotId.current = id
    scrollProxy.current?.scrollTo(id, settings.direction === "ttb" ? "top" : "leading")
  }
  /** 捲到某一頁的第一格。 */
  function scrollToPage(page: number) {
    scrollToSlot(slotsRef.current.firstSlotOf(page))
  }
  // ScrollView 重建完（開章、換模式／方向）就執行等著的跳頁；頁面排出來（有 session、沒有狀態遮罩）才捲。
  useEffect(() => {
    const page = pendingScroll.current
    if (page === null || !session || status !== null) return
    pendingScroll.current = null
    scrollToPage(page)
  }, [session, status, settings.mode, settings.direction])
  // 非 null 期間忽略可見回報（等候捲動到達目標頁）
  const scrubTarget = useRef<number | null>(null)
  const turnTarget = useRef<number | null>(null)
  // 畫面上的實際位移（點）：畫廊模式的頁碼與翻頁基準看它。
  // 可見集合回報會過期（跳頁後會停在舊的頁、重排後不更新），拿它算目標就會單擊翻兩頁。
  const scrollOffset = useRef({ x: 0, y: 0 })
  // 頁框大小另外留一份（位移換算要用最新值，不能靠回呼當下那個 render 的閉包）
  const pageSizeRef = useRef({ width: 0, height: 0 })
  // 閘門計時器 handle（⚠️ runtime setTimeout 返回值可為 0，比對需為 !== null）
  const restoreTimer = useRef<number | null>(null)
  const scrubTimer = useRef<number | null>(null)
  const turnTimer = useRef<number | null>(null)

  // 末頁拉動進入下一話的 overscroll 進度與門檻（支援畫廊與連續模式）
  const [pullProgress, setPullProgress] = useState(0) // 0 ~ 1
  const [overscrollPx, setOverscrollPx] = useState(0)
  const overscrollRef = useRef(0)
  const isInteractingRef = useRef(false)
  const hasTriggeredFullHapticRef = useRef(false)
  const PULL_THRESHOLD = 65
  /** 無縫換話冷卻，避免同一次手勢連跳好幾話。 */
  const seamlessHold = useRef(0)

  // 畫廊頁放大中：停用外層捲動，否則平移圖片時會順便翻頁。
  // zoomEpoch 一變就把所有頁的縮放歸零（離開放大的頁時用）。
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

  /** 清掉一個閘門計時器（排程前與 effect cleanup 共用）；一律比 `null`。 */
  function clearGate(timer: { current: number | null }) {
    if (timer.current === null) return
    clearTimeout(timer.current)
    timer.current = null
  }

  const index = currentGroupChapters.findIndex(chapter => chapter.id === focusEpId)
  // 上一話／下一話跳過鎖定章（點了也換不過去）。
  const neighbour = (step: 1 | -1): ChapterRef | undefined => {
    if (index < 0) return undefined
    for (let i = index + step; i >= 0 && i < currentGroupChapters.length; i += step) {
      if (!currentGroupChapters[i].locked) return currentGroupChapters[i]
    }
    return undefined
  }
  const previous = neighbour(-1)
  const next = neighbour(1)
  // 章節預設標題在 render 時求值以支援語言切換
  const title = (index >= 0 ? currentGroupChapters[index]?.title : chapters.find(c => c.id === currentEpId)?.title) || t("reader.chapterFallback", { n: Math.max(1, index + 1) })
  const pageCount = session?.pageCount ?? 0
  // 下一話的「資料層」身分（閱讀器自己的 ChapterRef 只有 id／title）。
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
    // 換話就當成新的一話從頭讀；還原只發生在「進來的那一話」。
    setLeadingPage(restoringEntry ? entryRestore : null)
    restored.current = !restoringEntry
    // 開章：來源由 `chapter()` 逐話決定（本機讀得到就讀本機，不然走線上）。
    void (async () => {
      try {
        const result = await comicLibrary().chapter({ sourceKey, comicId, epId: currentEpId })
        opened = result
        if (!alive) {
          // 還沒看到就被換掉了（連按兩話）：放掉自己（佇列＋在飛的請求與自己那一份記憶體快取），
          // 但那一份快取是這一話自己的，怎麼清都碰不到當前那一話用的另一份。
          result.dispose()
          return
        }
        sessionEpId.current = currentEpId
        // 第一幀就有圖：離線 session 在這裡量好開頭幾頁，頁面掛上去不必先轉圈。
        result.warm(restoringEntry && entryPage.current !== undefined ? entryPage.current : 0)
        const wanted = restoringEntry ? entryPage.current : undefined
        const target = wanted !== undefined && wanted > 0 && wanted < result.pageCount ? wanted : null
        // 新的 ScrollView 從頂端開始；要還原才排一個跳頁。
        // 必須在 setSession 前排好：頁面排出來那一輪的 effect 就要看得到。
        pendingScroll.current = target
        anchorSlotId.current = null
        setLeadingPage(target)
        setSession(result)
        // session 自己建的时候讀的是全域；這裡對齊畫面看到的值（per-comic 可能不同）。
        result.setHardwareSharpen(settingsRef.current.hardwareSharpen)
        setStatus(result.pageCount === 0 ? { kind: "empty" } : null)
        if (target === null) {
          restored.current = true
        } else {
          // 排程前先清舊的（換話時上面 cleanup 已清過一次，這裡是防重複排程）。
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
      // 三個兜底閘門計時器都在這裡清：換話或離開閱讀器之後，這一話的閘門不會再有人跑。
      clearGate(restoreTimer)
      clearGate(scrubTimer)
      clearGate(turnTimer)
      // 換話／離開閱讀器：清掉預取佇列 + 中止在飛的請求 + 把正文的記憶體快取放掉。
      opened?.dispose()
      const extra = followupsRef.current
      followupsRef.current = []
      for (const item of extra) item.session.dispose()
    }
  }, [sourceKey, comicId, currentEpId, reloadKey])

  // 頁碼落定 → 補預取、寫進度：在 ReaderPageTracker；拖曳列跟隨：在 ReaderScrubber。

  // 離開閱讀器時釋放 WebGL 銳化引擎資源與臨時 session 快取
  useEffect(() => {
    return () => {
      disposeUpscaleEngine()
      comicLibrary().releasePrefetched()
      // 閱讀中的進度都是靜默寫入，離開時通知一次讓書架／首頁跟上。
      notifyLibrary()
    }
  }, [])
  // 拖曳列的上界＝最後一頁索引（章末提示卡不算一頁）。
  const lastPage = Math.max(pageCount - 1, 0)
  const clampPage = (value: number) => Math.min(Math.max(Math.round(value), 0), lastPage)


  /** 放開拖曳列：捲到目標頁，並擋掉捲動落定前的過期可見集合回報。 */
  function commitScrub(page: number) {
    if (chainOnRef.current) {
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
    const target = clampPage(page)
    if (target === clampPage(leadingPageRef.current ?? 0)) return
    releaseZoom()
    // 閘門記格號（可見回報與位移換算都是格）。
    const slot = slotsRef.current.firstSlotOf(target)
    scrubTarget.current = slot
    setLeadingPage(target)
    void withAnimation(TURN_ANIM, () => scrollToSlot(slot))
    // 兜底：單張圖那種不必捲動的情形不會有回報，別讓閘門永遠關著。
    // 先清上一次的兜底（連續拖放會各排一個，舊的不該留著），再排這次的。
    clearGate(scrubTimer)
    scrubTimer.current = setTimeout(() => {
      scrubTimer.current = null
      if (scrubTarget.current === slot) scrubTarget.current = null
    }, 600)
  }

  /** 丟掉已經接上的下一集。 */
  function disposeFollowups() {
    const extra = followupsRef.current
    if (extra.length === 0) return
    followupsRef.current = []
    for (const item of extra) item.session.dispose()
    setFollowups([])
  }

  /** 換話：只改 state、不推新頁（同一層 route 就地換話）。 */
  function selectChapter(id: string) {
    setShowChapterSheet(false)
    // 鎖定的章節只列在目錄裡，點了不換話（也不提示）。
    if (chapters.find(chapter => chapter.id === id)?.locked) return
    // 下一集已經接在這條捲動裡：只滾過去，不重開（重開會閃一下黑畫面）。
    if (chainOnRef.current && (id === currentEpId || followupsRef.current.some(item => item.epId === id))) {
      if (id === focusEpRef.current) return
      focusEpRef.current = id
      setFocusEpId(id)
      setLeadingPage(0)
      const anchor = settings.direction === "ttb" ? "top" : "leading"
      scrollProxy.current?.scrollTo(chainKey(id, 0), anchor)
      return
    }
    if (id === currentEpId) return
    disposeFollowups()
    failedPreload.current.clear()
    focusEpRef.current = id
    setFocusEpId(id)
    entryPending.current = false
    setZoomed(false)
    // 立即清空過期目標與計時器
    clearGate(restoreTimer)
    clearGate(scrubTimer)
    clearGate(turnTimer)
    scrubTarget.current = null
    turnTarget.current = null

    // 換話立即歸零，避免上一話的頁碼狀態短暫帶到新的一話
    clearUpscaleCache()
    hasTriggeredFullHapticRef.current = false
    setLeadingPage(0)
    // 換話會重建 ScrollView（key 含 epId），自然從頂端開始；舊話還沒執行的跳頁作廢。
    pendingScroll.current = null
    anchorSlotId.current = null
    // 與換 ID 同一輪進入載入中：否則重建後的 ScrollView 會先用舊 session 畫出上一話的第一頁。
    setSession(undefined)
    setStatus({ kind: "loading" })
    setCurrentEpId(id)
  }

  /** 進入下一話。短時間內只接受一次，免得滑到底的回呼連發。 */
  function goToNext(id: string) {
    if (Date.now() < seamlessHold.current) return
    seamlessHold.current = Date.now() + 900
    selectChapter(id)
  }

  /**
   * 畫廊模式下畫面上的格：每格框固定，位移就是格長的整數倍（LTR／RTL／縱向實測都是）。
   * 連續模式沒有固定頁長，回 null 讓呼叫端退回可見集合回報的頁碼。
   */
  function displayedSlot(): number | null {
    const count = slotsRef.current.slots.length
    if (!paginated || count === 0) return null
    const stride = vertical ? pageSizeRef.current.height : pageSizeRef.current.width
    if (!(stride > 0)) return null
    const offset = vertical ? scrollOffset.current.y : scrollOffset.current.x
    return Math.min(Math.max(Math.round(Math.abs(offset) / stride), 0), count - 1)
  }

  /** 畫面上的頁（圖片索引）；連續模式回 null。 */
  function displayedPage(): number | null {
    const slot = displayedSlot()
    return slot === null ? null : slotsRef.current.pageOf(slot)
  }

  /** 寫領先格：記住格 id（插格補位用），頁碼變了才寫訊號。 */
  function setLeadingSlot(slot: number) {
    const slots = slotsRef.current
    anchorSlotId.current = slots.slots[slot]?.id ?? null
    const page = slots.pageOf(slot)
    if (leadingPageRef.current !== page) setLeadingPage(page)
  }

  /** 要看哪一格來算目標：自己剛下的目標（動畫還在飛）／還原中的目標／畫面上的實際位置。 */
  function turnBase(): number | null {
    const commanded = turnTarget.current ?? scrubTarget.current
    if (commanded !== null) return commanded
    const leading = leadingPageRef.current === null ? null : slotsRef.current.firstSlotOf(leadingPageRef.current)
    if (!restored.current) return leading
    return displayedSlot() ?? leading
  }

  /** 關上翻頁閘門直到到達這一格（600ms 兜底：不必捲動的情形不會有回報）。 */
  function holdSlot(slot: number) {
    turnTarget.current = slot
    clearGate(turnTimer)
    turnTimer.current = setTimeout(() => {
      turnTimer.current = null
      if (turnTarget.current === slot) turnTarget.current = null
    }, 600)
  }

  /**
   * 畫廊：把實際位移換算出的頁碼寫回 state（翻頁／拖曳／還原途中不搶）。
   * 回報那一頭照舊當備援：位移取樣沒到時，頁碼還是跟著回報走。
   */
  function syncPageFromGeometry() {
    if (!restored.current || turnTarget.current !== null || scrubTarget.current !== null) return
    const slot = displayedSlot()
    if (slot === null) return
    setLeadingSlot(slot)
  }

  /**
   * 翻一頁（往前後推一格並以捲動位置捲動，翻頁中忽略過期可見回報）。
   */
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

  /**
   * 畫布點擊：三區翻頁與 HUD 切換。
   * 手勢採 global 座標空間，避免 local 座標隨捲動累積漂移。
   */
  function handleCanvasTap(location: Point) {
    // 縱向畫廊模式：支援上 1/4 上一頁、下 1/4 下一頁、中 1/2 切 HUD
    if (vertical && paginated && settings.tapZones) {
      const vQuarter = pageSize.height / 4
      if (location.y > vQuarter && location.y < vQuarter * 3) {
        toggleHUD()
        return
      }
      turnPage(location.y >= vQuarter * 3 ? 1 : -1)
      return
    }

    // 由上到下（ttb）連續條漫模式不做點擊翻頁——那個方向靠滑動，全屏點擊切 HUD。
    if (!settings.tapZones || settings.direction === "ttb") {
      toggleHUD()
      return
    }

    // 橫向分區＝左右各 1/4 翻頁、中間 1/2 切 HUD。
    const quarter = pageSize.width / 4
    if (location.x > quarter && location.x < quarter * 3) {
      toggleHUD()
      return
    }
    // 左到右：右邊＝下一頁；右到左（rtl）鏡像：左邊＝下一頁。
    const forward = rtl ? location.x <= quarter : location.x >= quarter * 3
    turnPage(forward ? 1 : -1)
  }

  // 畫廊頁的單擊由 ZoomableView 接（子層雙擊會擋掉 ScrollView 的單擊）；pages 有記憶化，經 ref 讀最新版。
  const canvasTapRef = useRef(handleCanvasTap)
  canvasTapRef.current = handleCanvasTap
  const onPageTap = useCallback((location: Point) => canvasTapRef.current(location), [])

  const vertical = settings.direction === "ttb"
  const rtl = settings.direction === "rtl"
  const paginated = settings.mode === "gallery"
  // 連續模式才把下一集接在同一條捲動後面。畫廊仍是一頁一頁。
  const chainOn = settings.seamlessNext && !paginated
  chainOnRef.current = chainOn
  const focusEntry = chainOn ? followups.find(item => item.epId === focusEpId) : undefined
  const focusSession = focusEntry?.session ?? session
  const focusPageCount = focusEntry ? focusEntry.session.pageCount : pageCount

  // 看著哪一話，就先把「再下一集」整話載好再接上。不呼叫 selectChapter，所以不會閃黑、不會震動。
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
    // 從正在看的話往後找：短章（半頁請假條）即使已經接上，也要再載它的下一章，
    // 不然內容不到一屏，滑不到底，後面的章永遠不會出現。
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
    // 長章晚一點再抓下一章，把頻寬留給現在這頁，開閱讀器與滑動才不會卡。短章（半頁）馬上接。
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
        // 頁面清單一到就接上，短章底下立刻有下一章，不必等圖。圖在背景少量預熱，避免整話解碼把滑動卡住。
        // 已經接過就不再收：這裡的判斷不放在 setState 的 updater 裡，避免 updater 重入時把 session 誤 dispose。
        if (followupsRef.current.some(item => item.epId === epIdToLoad)) {
          opened.dispose()
          return
        }
        followupsRef.current = [...followupsRef.current, { epId: epIdToLoad, title: epTitle, session: opened }]
        setFollowups(followupsRef.current)
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
    if (chainOn) return
    disposeFollowups()
    if (focusEpRef.current !== currentEpId) {
      focusEpRef.current = currentEpId
      setFocusEpId(currentEpId)
      setLeadingPage(0)
    }
  }, [chainOn, currentEpId])

  // 畫廊切寬圖：格清單（一格一畫面）。沒開或不是畫廊時一張一格，格號＝頁碼。
  const splitActive = paginated && settings.splitWide
  const splitActiveRef = useRef(splitActive)
  splitActiveRef.current = splitActive
  // 量到寬圖才重排（其他比例不影響格清單）。
  const [wideVersion, setWideVersion] = useState(0)
  useEffect(() => {
    if (!session) return
    const unsubscribe = session.subscribeAspects((_, aspect) => {
      if (splitActiveRef.current && isWideAspect(aspect)) setWideVersion(version => version + 1)
    })
    // 掛上訂閱前已經量到的寬圖也要算進來。
    if (splitActiveRef.current) setWideVersion(version => version + 1)
    return unsubscribe
  }, [session])
  const pageSlots = useMemo(
    () =>
      buildPageSlots(
        pageCount,
        splitActive && session ? page => isWideAspect(session.aspectOf(page)) : null,
        rightHalfFirst(settings.direction, settings.splitSwap)
      ),
    [session, pageCount, splitActive, settings.direction, settings.splitSwap, wideVersion]
  )
  const slotsRef = useRef(pageSlots)
  slotsRef.current = pageSlots

  // 前面插了格（或切割開關／順序變了）：畫面還停在舊位移，不帶動畫捲回同一頁。
  const previousSlots = useRef(pageSlots)
  useEffect(() => {
    const before = previousSlots.current
    previousSlots.current = pageSlots
    const anchor = anchorSlotId.current
    if (before === pageSlots || !paginated || anchor === null) return
    const from = before.indexOf(anchor)
    if (from < 0) return
    // 這一頁自己被切開（或取消切割）時 id 會變：退回這一頁的第一格。
    let to = pageSlots.indexOf(anchor)
    if (to < 0) to = pageSlots.firstSlotOf(before.pageOf(from))
    const id = pageSlots.slots[to]?.id ?? null
    anchorSlotId.current = id
    if (to === from || id === null) return
    holdSlot(to)
    scrollProxy.current?.scrollTo(id, vertical ? "top" : "leading")
  }, [pageSlots])

  const axes = readerAxis(settings.direction)
  // 畫布尺寸需量測外框自身尺寸以避免忽略安全區時的高度落差
  const [canvasBox, setCanvasBox] = useState<{ width: number; height: number } | null>(null)
  const pageSize = canvasBox ?? viewport
  pageSizeRef.current = pageSize

  /** 只在真的變了才換 state。取整，避免小數點抖動讓每一頁都拆掉重畫（滑動時閃黑）。 */
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
    // 換模式／方向會重建 ScrollView：先把目前頁寫進捲動位置，並擋住重建後第一個「在頂端」的回報。
    if (next.mode !== settings.mode || next.direction !== settings.direction) {
      const page = displayedPage() ?? leadingPageRef.current ?? 0
      clearGate(turnTimer)
      clearGate(scrubTimer)
      turnTarget.current = null
      scrubTarget.current = null
      setZoomed(false)
      setLeadingPage(page)
      // 換模式／方向會重建 ScrollView：等新的排好再捲回這一頁。
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
    // per-comic 開著就只寫這本；沒開且源沒宣告 viewer 才寫全域。
    // （源宣告了 viewer 時，寫全域下次還是會被 viewer 蓋掉，所以只算這次 session。）
    if (perComic) savePerComicSettings(scope, next)
    else if (!viewer) setReaderSettings(next)
    if (patch.hardwareSharpen !== undefined && session) {
      session.setHardwareSharpen(patch.hardwareSharpen)
      for (const item of followupsRef.current) item.session.setHardwareSharpen(patch.hardwareSharpen)
      // 超分開關切換時推動世代序號，觸發當前畫面上所有 ChapterImage 重跑 loadPage 響應開關
      setRenderGeneration(g => g + 1)
    }
  }

  /** per-comic 開關：打開＝把當下看到的設定存成這本的；關閉＝刪掉並立刻回退 viewer／全域。 */
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

  // 頁面列表記憶化：縮放僅限畫廊模式（單頁錨點明確）；deps 取純值避免因物件重建引發整批元件重算。
  const pages = useMemo(
    () =>
      session
        ? paginated
          ? pageSlots.slots.map((slot, i) => (
              <ZStack key={slot.id} tag={i} frame={{ width: pageSize.width, height: pageSize.height }}>
                <ZoomableView
                  contentSize={pageSize}
                  box={pageSize}
                  resetToken={`${currentEpId}:${zoomEpoch}`}
                  onSingleTap={onPageTap}
                  onZoomChange={handleZoomChange}
                >
                  <ChapterImage
                    key={`${slot.id}:${renderGeneration}`}
                    session={session}
                    index={slot.page}
                    half={slot.half}
                    // 可縮放：超分照放大後的框算，放大時才有細節。
                    size={{ width: pageSize.width, height: pageSize.height, zoom: MAX_ZOOM }}
                  />
                </ZoomableView>
              </ZStack>
            ))
          : Array.from({ length: pageCount }, (_, i) => {
              const id = chainOn ? chainKey(currentEpId, i) : String(i)
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
                    // 條漫以寬為準：高度由比例算出來，所以載入前後佔位一樣高。
                    size={{ width: pageSize.width }}
                  />
                </VStack>
              )
            })
        : [],
    [session, pageCount, pageSlots, paginated, vertical, currentEpId, pageSize.width, pageSize.height, renderGeneration, zoomEpoch, chainOn],
  )

  const followupPages = useMemo(
    () =>
      chainOn
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
    [chainOn, followups, vertical, pageSize.width, pageSize.height, renderGeneration]
  )

  // 章末提示：有下一話時所有模式皆走邊緣 overscroll 拉動進入下一話；僅全書最後一話時保留「已是全書最後一話」
  const endCard = !next ? (
    paginated || !vertical ? (
      <ZStack
        key="end"
        tag={paginated ? pageSlots.slots.length : pageCount}
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
            {t("reader.endOfBook")}
          </Text>
          <Spacer />
        </HStack>
      </ZStack>
    ) : (
      <HStack spacing={0} padding={{ top: 40, bottom: 100 }}>
        <Spacer />
        <Text font="caption" foregroundStyle="tertiaryLabel">
          {t("reader.endOfBook")}
        </Text>
        <Spacer />
      </HStack>
    )
  ) : null

  // 頁碼：所有模式都看 onScrollTargetVisibilityChange 回報的領先可見頁。
  // 頁碼顯示在 ReaderPageTracker 裡（它訂閱 leadingPage）。

  // HUD 的進出場全部走屬性動畫（offset / opacity）+ animation modifier，
  // 不用 transition + withAnimation——那條路徑在這塊 overlay 上會退化成淡入淡出。
  function toggleHUD() {
    hudVisible.setValue(!hudVisible.value)
  }

  // 目錄抽屜：章節清單很長（幾百列），但只有拉開抽屜才看得到。
  // 跨頁只是 leadingPage 變，不該讓它每次重建成千上百個元素——元素與 callback 都記住。
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
        // 量畫布盒子（見 pageSize）。
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

        {/* 1. 漫畫閱讀畫布（依閱讀模式／方向切換排版） */}
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
                      ? "viewAlignedLimitAlwaysByOne" // 縱向畫廊：單頁吸附
                      : "paging"
                    : undefined                       // 連續模式：平滑流動
                }
                onScrollTargetVisibilityChange={{
                  idType: "string",
                  threshold: 0.0,
                  onChanged: ids => {
                    if (!restored.current) return
                    if (chainOn) {
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
                    // id 是格 id（不切時就是頁碼字串）；章末卡找不到格，略過。
                    const indexes = (ids as string[])
                      .map(value => slotsRef.current.indexOf(value))
                      .filter(value => value >= 0)
                    if (indexes.length === 0) return
                    const leading = Math.min(...indexes)
                    // 拖曳跳頁／動畫翻頁途中的過期回報：真的走到目標格才解除。
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
                // 座標系必須宣告為 global，避免 local 包含累計滾動位移導致點擊分區漂移
                // 畫廊模式的頁面與章末卡自己接點擊；這裡只管連續模式與載入／錯誤畫面。
                onTapGesture={
                  !paginated || status !== null
                    ? { count: 1, coordinateSpace: "global", perform: handleCanvasTap }
                    : undefined
                }
                onScrollGeometryChange={{
                  of: "geometry",
                  onChanged: (_, geo) => {
                    // 記下實際位移：畫廊模式的頁碼與翻頁基準都是從這裡換算的
                    scrollOffset.current = { x: geo.contentOffset.x, y: geo.contentOffset.y }
                    syncPageFromGeometry()
                    if (!next) return
                    // 防誤觸守衛：僅在接近章末（最後 1~2 頁或確實滾至末端）時允許觸發 overscroll
                    if (pageCount > 0 && leadingPageRef.current !== null && leadingPageRef.current < lastPage - 1) {
                      if (pullProgress > 0) {
                        setPullProgress(0)
                        setOverscrollPx(0)
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
                      // rightToLeft 下 contentOffset.x 的正負號未實測；取絕對值再扣捲動上界，兩種符號都只在末端拉過頭才為正。
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
                      setPullProgress(p)
                      setOverscrollPx(overscroll)
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
                      setPullProgress(0)
                      setOverscrollPx(0)
                    }
                  },
                }}
                onScrollPhaseChange={(oldPhase, newPhase) => {
                  if (newPhase === "interacting" || newPhase === "tracking") {
                    isInteractingRef.current = true
                  }
                  // 人自己出手＝我們剛下的目標已經不是真相，放掉讓翻頁基準回到畫面上的實際位置
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
                    // 預加載下一集時內容已經接在後面，這裡再換話會閃黑畫面，所以不跳。
                    if (!chainOn && next && pulled >= PULL_THRESHOLD) goToNext(next.id)
                    setPullProgress(0)
                    setOverscrollPx(0)
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

        {/* 1.1 邊緣拉籤（Pull Tab：位於 overScroll 空隙中，支援畫廊與連續模式） */}
        {pullProgress > 0 && next && !chainOn ? (
          vertical ? (
            // 縱向（畫廊 / 連續）：底部向上拉出的橫向膠囊
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
                  // 膠囊高度約 38pt，平常藏在螢幕底部邊緣外，隨 overscrollPx 往上推入
                  y: 45 - Math.min(overscrollPx, PULL_THRESHOLD),
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
            // 橫向畫廊：依閱讀方向（LTR 在右側、RTL 在左側）從邊緣探出的直立拉籤
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
                  // 寬度約 34pt，平常貼在螢幕邊界外（38），隨 overscrollPx 逐步拉進畫面
                  x: rtl
                    ? -38 + Math.min(overscrollPx, PULL_THRESHOLD)
                    : 38 - Math.min(overscrollPx, PULL_THRESHOLD),
                  y: 0,
                }}
              >
                <Image
                  systemName={rtl ? "chevron.left" : "chevron.right"}
                  font="caption"
                  fontWeight={pullProgress >= 1 ? "bold" : "regular"}
                  foregroundStyle={pullProgress >= 1 ? "label" : neutral.secondary}
                />
                {/* 直向文字：固定為下一話，拉滿時由次要灰字變為高亮白字 */}
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
        ) : null}

        {/* 開章時蓋在畫布上。放在捲動外面，第一帧就看得到，不會先黑一整片再出現轉圈。 */}
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

        {/* 1.2 HUD 收起時的頁碼與時間、電量（設定開哪個就顯示哪個）；順便跑頁碼副作用（只有這一小塊隨翻頁重繪） */}
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

        {/* 2. 全螢幕 HUD Overlay */}
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


