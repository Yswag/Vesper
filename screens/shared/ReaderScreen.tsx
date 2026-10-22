// 閱讀器：沉浸式全螢幕漫畫閱讀器。
//
// 架構與手勢約定：
// 1. 純黑畫布（fill.canvas），隱藏 TabBar、NavigationBar 與狀態列。
// 2. 全螢幕 HUD Overlay：以 offset / opacity 屬性動畫收放；目錄走原生 Bottom Sheet，設定走系統 Menu。
// 3. 閱讀模式：畫廊（分頁吸附）與連續（平滑捲動）；方向支援橫向（LTR/RTL）與縱向（TTB）。
// 4. 進度追蹤：以 onScrollTargetVisibilityChange 領先可見頁為準，就地換話不堆疊 route。
// 5. 離線模式：讀離線 manifest 與本地檔，不發起網路請求。
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
  ProgressView,
  RoundedRectangle,
  ScrollView,
  ScrollViewReader,
  Spacer,
  Text,
  VStack,
  ZStack,
  useEffect,
  useMemo,
  useObservable,
  useRef,
  useState,
  type Point,
} from "scripting"

import type { ChapterSession } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { ChapterImage } from "../../components/ChapterImage"
import { ChapterDrawer } from "../../components/ChapterDrawer"
import { ReaderHUD } from "../../components/ReaderHUD"
import { ZoomableView } from "../../components/ZoomableView"
import { fill, neutral, radius, rect } from "../../design/tokens"
import { isFavorite, setProgress, toggleFavorite } from "../../library/bookshelf"
import {
  clearPerComicSettings,
  readerAxis,
  resolveReaderSettings,
  savePerComicSettings,
  setReaderSettings,
  type ReaderSettings,
  type SourceViewer,
} from "../../library/readerSettings"
import { createOfflineSession, isOfflineReadable } from "./offlineSession"
import { groupChapters, resolveInitialGroupName, type ChapterGroup } from "./chapterGrouping"
import { clearUpscaleCache, disposeUpscaleEngine } from "../../engine/upscale"

/** 單擊翻頁的滑動動畫（需以 withAnimation 包覆 scrollPos.setValue）。 */
const TURN_ANIM = Animation.spring({ duration: 0.15, bounce: 0 })

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

export interface ChapterRef {
  id: string
  title: string
  group?: string
}

export interface ReaderProps {
  sourceKey: string
  comicId: string
  epId: string
  chapters: ChapterRef[]
  comicTitle: string
  comicCover?: string
  /** 開啟時要跳到的頁碼（0 起算）。只給「繼續閱讀」用；換話不帶，一律從頭。 */
  initialPage?: number
  /** 源宣告的閱讀方式（Aidoku 的 viewer）；沒有就退全域設定。 */
  viewer?: SourceViewer
  /**
   * 離線模式：這一話只從離線 manifest 與本機檔案讀，不問源、不發任何請求。
   * `chapters` 只是「這部有哪些話」的線索，實際能不能讀由離線狀態決定（只列得出下載完的）。
   */
  offlineMode?: boolean
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
  chapters: allChapters,
  comicTitle,
  comicCover,
  initialPage,
  viewer,
  offlineMode = false,
  viewport,
  safeAreaInsets,
  hudVisible,
}: ReaderProps & ReaderLayout) {
  // 語言一換就重繪：這個畫面的字（HUD、目錄、閱讀設定、狀態遮罩）都是 render 時求值的。
  useSubscription(subscribeLocale)

  // 離線模式只列「下載完」的章：沒下載完的進來也是壞的，不該出現在目錄裡。
  const chapters = offlineMode
    ? allChapters.filter(chapter => isOfflineReadable({ sourceKey, comicId, epId: chapter.id }))
    : allChapters
  const hiddenChapters = allChapters.length - chapters.length
  const dismiss = Navigation.useDismiss()
  // 這一話的取圖 session（頁數、圖片鍵、離線狀態都在裡面）；換話就整個換掉。
  const [session, setSession] = useState<ChapterSession | undefined>(undefined)
  const [status, setStatus] = useState<ReaderStatus>({ kind: "loading" })
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
  const restoringEntry = currentEpId === entryEpId.current && entryRestore !== null
  const [leadingPage, setLeadingPage] = useState<number | null>(restoringEntry ? entryRestore : null)
  // 還原捲動完成前忽略可見集合回報，避免頂端初次回報覆蓋進度
  const restored = useRef(!restoringEntry)
  const scrollPos = useObservable("0")
  const scrubValue = useObservable(0)
  const [scrubbing, setScrubbing] = useState(false)
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

  /** 清掉一個閘門計時器（排程前與 effect cleanup 共用）；一律比 `null`。 */
  function clearGate(timer: { current: number | null }) {
    if (timer.current === null) return
    clearTimeout(timer.current)
    timer.current = null
  }

  const index = currentGroupChapters.findIndex(chapter => chapter.id === currentEpId)
  const previous = index > 0 ? currentGroupChapters[index - 1] : undefined
  const next = index >= 0 && index < currentGroupChapters.length - 1 ? currentGroupChapters[index + 1] : undefined
  // 章節預設標題在 render 時求值以支援語言切換
  const title = (index >= 0 ? currentGroupChapters[index]?.title : chapters.find(c => c.id === currentEpId)?.title) || t("reader.chapterFallback", { n: Math.max(1, index + 1) })
  const pageCount = session?.pageCount ?? 0

  useEffect(() => {
    let alive = true
    let opened: ChapterSession | undefined
    setSession(undefined)
    setStatus({ kind: "loading" })
    // 換話就當成新的一話從頭讀；還原只發生在「進來的那一話」。
    setLeadingPage(restoringEntry ? entryRestore : null)
    restored.current = !restoringEntry
    // 開章：離線模式只讀離線 manifest（整條路不碰源）；平常走 ComicLibrary，
    // 已下載的章在那裡也是直接吃離線層記下的頁面清單（飛航模式照樣讀）。
    void (async () => {
      try {
        const result = offlineMode
          ? createOfflineSession({ sourceKey, comicId, epId: currentEpId })
          : await comicLibrary().chapter({ sourceKey, comicId, epId: currentEpId })
        opened = result
        if (!alive) {
          // 還沒看到就被換掉了（連按兩話）：放掉自己（佇列＋在飛的請求與自己那一份記憶體快取），
          // 但那一份快取是這一話自己的，怎麼清都碰不到當前那一話用的另一份。
          result.dispose()
          return
        }
        setSession(result)
        // session 自己建的时候讀的是全域；這裡對齊畫面看到的值（per-comic 可能不同）。
        result.setHardwareSharpen(settingsRef.current.hardwareSharpen)
        setStatus(result.pageCount === 0 ? { kind: "empty" } : null)
        const wanted = restoringEntry ? entryPage.current : undefined
        const target = wanted !== undefined && wanted > 0 && wanted < result.pageCount ? wanted : null
        setLeadingPage(target)
        scrollPos.setValue(target !== null ? String(target) : "0")
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
          offline: offlineMode ? true : undefined,
        })
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
    }
  }, [sourceKey, comicId, currentEpId, offlineMode])

  // 頁碼落定 → 補預取（以這一頁為中心往前 3）。兩種閱讀模式都吃這一條（leadingPage 是共用的）。
  // 拖曳頁碼列時只動 scrubValue，leadingPage 要放開（commitScrub）才會變 → 拖曳中不會重排。
  useEffect(() => {
    if (!session || pageCount === 0) return
    session.warm(Math.min(Math.max(leadingPage ?? 0, 0), pageCount - 1))
  }, [session, leadingPage, pageCount])

  // 離開閱讀器時釋放 WebGL 銳化引擎資源與臨時 session 快取
  useEffect(() => {
    return () => {
      disposeUpscaleEngine()
    }
  }, [])
  // leadingPage 還沒回報時當成第 1 頁：新開一話若內容不需捲動（例如單張圖），
  // 可見集合永遠不會回呼，不補這一下就會整話都沒有頁碼可用。
  useEffect(() => {
    if (pageCount === 0) return
    const page = Math.min(Math.max(leadingPage ?? 0, 0), pageCount - 1)
    setProgress({
      sourceKey,
      comicId,
      title: comicTitle,
      cover: comicCover,
      epId: currentEpId,
      epTitle: title,
      page,
      pageCount,
      offline: offlineMode ? true : undefined,
    })
  }, [leadingPage, pageCount, currentEpId, sourceKey, comicId])

  // 拖曳列的上界＝最後一頁索引（章末提示卡不算一頁）。
  const lastPage = Math.max(pageCount - 1, 0)
  const clampPage = (value: number) => Math.min(Math.max(Math.round(value), 0), lastPage)

  // 沒在拖曳時讓拖曳列跟著實際閱讀位置走；拖曳中不搶，否則手指會被回報彈走。
  useEffect(() => {
    if (scrubbing) return
    scrubValue.setValue(clampPage(leadingPage ?? 0))
  }, [leadingPage, scrubbing, pageCount])

  /** 放開拖曳列：捲到目標頁，並擋掉捲動落定前的過期可見集合回報。 */
  function commitScrub() {
    const target = clampPage(scrubValue.value)
    setScrubbing(false)
    if (target === clampPage(leadingPage ?? 0)) return
    scrubTarget.current = target
    setLeadingPage(target)
    void withAnimation(TURN_ANIM, () => scrollPos.setValue(String(target)))
    // 兜底：單張圖那種不必捲動的情形不會有回報，別讓閘門永遠關著。
    // 先清上一次的兜底（連續拖放會各排一個，舊的不該留著），再排這次的。
    clearGate(scrubTimer)
    scrubTimer.current = setTimeout(() => {
      scrubTimer.current = null
      if (scrubTarget.current === target) scrubTarget.current = null
    }, 600)
  }

  /** 換話：只改 state、不推新頁（同一層 route 就地換話）。 */
  function selectChapter(id: string) {
    setShowChapterSheet(false)
    if (id === currentEpId) return
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
    scrubValue.setValue(0)
    scrollPos.setValue("0")
    setCurrentEpId(id)
  }

  /**
   * 畫廊模式下畫面上的頁：每頁框固定，位移就是頁長的整數倍（LTR／RTL／縱向實測都是）。
   * 連續模式沒有固定頁長，回 null 讓呼叫端退回可見集合回報的頁碼。
   */
  function displayedPage(): number | null {
    if (!paginated || pageCount === 0) return null
    const stride = vertical ? pageSizeRef.current.height : pageSizeRef.current.width
    if (!(stride > 0)) return null
    const offset = vertical ? scrollOffset.current.y : scrollOffset.current.x
    return Math.min(Math.max(Math.round(Math.abs(offset) / stride), 0), pageCount - 1)
  }

  /** 要看哪一頁來算目標：自己剛下的目標（動畫還在飛）／還原中的目標／畫面上的實際位置。 */
  function turnBase(): number | null {
    const commanded = turnTarget.current ?? scrubTarget.current
    if (commanded !== null) return commanded
    if (!restored.current) return leadingPage
    return displayedPage() ?? leadingPage
  }

  /**
   * 畫廊：把實際位移換算出的頁碼寫回 state（翻頁／拖曳／還原途中不搶）。
   * 回報那一頭照舊當備援：位移取樣沒到時，頁碼還是跟著回報走。
   */
  function syncPageFromGeometry() {
    if (!restored.current || turnTarget.current !== null || scrubTarget.current !== null) return
    const page = displayedPage()
    if (page === null) return
    setLeadingPage(previous => (previous === page ? previous : page))
  }

  /**
   * 翻一頁（往前後推一格並以 scrollPos 捲動，翻頁中忽略過期可見回報）。
   */
  function turnPage(delta: 1 | -1) {
    if (pageCount === 0) return
    const base = turnBase()
    if (base === null) return
    const target = Math.min(Math.max(base + delta, 0), pageCount - 1)
    if (target === base) return
    turnTarget.current = target
    setLeadingPage(target)
    void withAnimation(TURN_ANIM, () => scrollPos.setValue(String(target)))
    // 兜底計時器：防範無位移時回報中斷導致閘門常閉
    clearGate(turnTimer)
    turnTimer.current = setTimeout(() => {
      turnTimer.current = null
      if (turnTarget.current === target) turnTarget.current = null
    }, 600)
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

  const vertical = settings.direction === "ttb"
  const rtl = settings.direction === "rtl"
  const paginated = settings.mode === "gallery"

  const axes = readerAxis(settings.direction)
  // 畫布尺寸需量測外框自身尺寸以避免忽略安全區時的高度落差
  const [canvasBox, setCanvasBox] = useState<{ width: number; height: number } | null>(null)
  const pageSize = canvasBox ?? viewport
  pageSizeRef.current = pageSize

  /** 只在真的變了才換 state（背景的 GeometryReader 每次 render 都會回報）。 */
  function reportCanvasBox(size: { width: number; height: number }) {
    setCanvasBox(previous =>
      previous && previous.width === size.width && previous.height === size.height ? previous : size
    )
  }

  const [renderGeneration, setRenderGeneration] = useState(0)

  function updateSettings(patch: Partial<ReaderSettings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    // per-comic 開著就只寫這本；沒開且源沒宣告 viewer 才寫全域。
    // （源宣告了 viewer 時，寫全域下次還是會被 viewer 蓋掉，所以只算這次 session。）
    if (perComic) savePerComicSettings(scope, next)
    else if (!viewer) setReaderSettings(next)
    if (patch.hardwareSharpen !== undefined && session) {
      session.setHardwareSharpen(patch.hardwareSharpen)
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
    if (session) session.setHardwareSharpen(fallback.hardwareSharpen)
    if (fallback.hardwareSharpen !== settings.hardwareSharpen) setRenderGeneration(g => g + 1)
  }

  // 頁面列表記憶化：縮放僅限畫廊模式（單頁錨點明確）；deps 取純值避免因物件重建引發整批元件重算。
  const pages = useMemo(
    () =>
      session
        ? Array.from({ length: pageCount }, (_, i) => {
            const id = String(i)
            if (paginated) {
              return (
                <ZStack key={id} tag={i} frame={{ width: pageSize.width, height: pageSize.height }}>
                  <ZoomableView
                    contentSize={pageSize}
                    box={pageSize}
                    resetToken={currentEpId}
                  >
                    <ChapterImage
                      key={`${id}:${renderGeneration}`}
                      session={session}
                      index={i}
                      size={pageSize}
                    />
                  </ZoomableView>
                </ZStack>
              )
            }
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
                />
              </VStack>
            )
          })
        : [],
    [session, pageCount, paginated, vertical, currentEpId, pageSize.width, pageSize.height, renderGeneration],
  )

  // 章末提示：有下一話時所有模式皆走邊緣 overscroll 拉動進入下一話；僅全書最後一話時保留「已是全書最後一話」
  const endCard = !next ? (
    paginated || !vertical ? (
      <ZStack
        key="end"
        tag={pageCount}
        frame={
          paginated
            ? { width: pageSize.width, height: pageSize.height }
            : { height: pageSize.height }
        }
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
  const currentPage =
    leadingPage !== null
      ? Math.min(Math.max(leadingPage + 1, 1), Math.max(pageCount, 1))
      : 1

  // 遮罩上那句話：載入與空章的文案在 render 時求值（切語言要跟著換）；
  // 錯誤訊息是源自己的字，原樣顯示。
  const statusText =
    status === null
      ? ""
      : status.kind === "loading"
        ? t("common.loading")
        : status.kind === "empty"
          ? t("reader.noImages")
          : status.message

  // HUD 的進出場全部走屬性動畫（offset / opacity）+ animation modifier，
  // 不用 transition + withAnimation——那條路徑在這塊 overlay 上會退化成淡入淡出。
  function toggleHUD() {
    hudVisible.setValue(!hudVisible.value)
  }

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
        content: (
          <ChapterDrawer
            currentEpId={currentEpId}
            chapters={chapters}
            chapterGroups={chapterGroups}
            isGrouped={isGrouped}
            offlineMode={offlineMode}
            hiddenChapters={hiddenChapters}
            onSelectChapter={selectChapter}
            onClose={() => setShowChapterSheet(false)}
          />
        ),
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
        <ScrollView
          key={`${currentEpId}-${settings.mode}-${settings.direction}`}
          axes={axes}
          scrollIndicator="never"
          scrollTargetBehavior={
            paginated
              ? vertical
                ? "viewAlignedLimitAlwaysByOne" // 縱向畫廊：單頁吸附
                : "paging"
              : undefined                       // 連續模式：平滑流動
          }
          scrollPosition={{ value: scrollPos, anchor: "topLeading" }}
          onScrollTargetVisibilityChange={{
            idType: "string",
            threshold: 0.0,
            onChanged: ids => {
              if (!restored.current) return
              const indexes = (ids as string[])
                .map(value => Number(value))
                .filter(value => Number.isFinite(value))
              if (indexes.length === 0) return
              const leading = Math.min(...indexes)
              // 拖曳跳頁／動畫翻頁途中的過期回報：真的走到目標頁才解除。
              const pending = scrubTarget.current ?? turnTarget.current
              if (pending !== null) {
                if (leading === pending) {
                  scrubTarget.current = null
                  turnTarget.current = null
                }
                return
              }
              setLeadingPage(leading)
            },
          }}
          environments={rtl ? { layoutDirection: "rightToLeft" } : undefined}
          // 座標系必須宣告為 global，避免 local 包含累計滾動位移導致點擊分區漂移
          onTapGesture={{ count: 1, coordinateSpace: "global", perform: handleCanvasTap }}
          onScrollGeometryChange={{
            of: "geometry",
            onChanged: (_, geo) => {
              // 記下實際位移：畫廊模式的頁碼與翻頁基準都是從這裡換算的
              scrollOffset.current = { x: geo.contentOffset.x, y: geo.contentOffset.y }
              syncPageFromGeometry()
              if (!next) return
              // 防誤觸守衛：僅在接近章末（最後 1~2 頁或確實滾至末端）時允許觸發 overscroll
              if (pageCount > 0 && leadingPage !== null && leadingPage < lastPage - 1) {
                if (pullProgress > 0) {
                  setPullProgress(0)
                  setOverscrollPx(0)
                  overscrollRef.current = 0
                }
                return
              }

              let overscroll = 0
              if (vertical) {
                const maxScrollY = Math.max(0, geo.contentSize.height - geo.containerSize.height)
                overscroll = geo.contentOffset.y - maxScrollY
              } else if (rtl) {
                // 在 rightToLeft layoutDirection 下，SwiftUI contentOffset.x 為負數或反向
                // 當滑到最後一張向左滑動時，取超出量
                const maxScrollX = Math.max(0, geo.contentSize.width - geo.containerSize.width)
                overscroll = geo.contentOffset.x < 0
                  ? -geo.contentOffset.x
                  : geo.contentOffset.x - maxScrollX
              } else {
                const maxScrollX = Math.max(0, geo.contentSize.width - geo.containerSize.width)
                overscroll = geo.contentOffset.x - maxScrollX
              }
              overscrollRef.current = overscroll

              if (overscroll > 2) {
                const p = Math.min(1, Math.max(0, (overscroll - 2) / PULL_THRESHOLD))
                setPullProgress(p)
                setOverscrollPx(overscroll)
                if (p >= 1) {
                  if (!hasTriggeredFullHapticRef.current) {
                    hasTriggeredFullHapticRef.current = true
                    HapticFeedback.mediumImpact()
                  }
                } else {
                  hasTriggeredFullHapticRef.current = false
                }
              } else if (overscrollRef.current <= 0) {
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
              if (overscrollRef.current >= PULL_THRESHOLD && next) {
                selectChapter(next.id)
              }
              setPullProgress(0)
              setOverscrollPx(0)
              overscrollRef.current = 0
            }
          }}
        >
          {status !== null ? (
            <VStack
              alignment="center"
              spacing={14}
              frame={{ width: pageSize.width, height: pageSize.height }}
            >
              <ProgressView />
              <Text foregroundStyle="secondaryLabel" font="subheadline">
                {statusText}
              </Text>
            </VStack>
          ) : vertical ? (
            <LazyVStack
              spacing={0}
              scrollTargetLayout={true}
              frame={{ maxWidth: "infinity" }}
            >
              {pages}
              {endCard}
            </LazyVStack>
          ) : (
            <LazyHStack
              spacing={0}
              scrollTargetLayout={true}
              frame={{ maxHeight: "infinity" }}
            >
              {pages}
              {endCard}
            </LazyHStack>
          )}
        </ScrollView>

        {/* 1.1 邊緣拉籤（Pull Tab：位於 overScroll 空隙中，支援畫廊與連續模式） */}
        {pullProgress > 0 && next ? (
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

        {/* 2. 全螢幕 HUD Overlay */}
        <ReaderHUD
          hudVisible={hudVisible}
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
          totalChapters={chapters.length}
          onSelectChapter={selectChapter}
          pageCount={pageCount}
          currentPage={currentPage}
          leadingPage={leadingPage}
          scrubbing={scrubbing}
          scrubValue={scrubValue}
          onScrubStart={() => setScrubbing(true)}
          onScrubCommit={commitScrub}
        />

      </ZStack>
    </VStack>
  )
}


