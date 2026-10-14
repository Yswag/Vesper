// 閱讀器：沉浸式全螢幕漫畫閱讀器（精準還原專用漫畫 App UI）。
//
// 1. 滿版全螢幕純黑畫布（fill.canvas），隱藏 TabBar、NavigationBar 與狀態列（全程隱藏，避免開關推擠）。
// 2. 全螢幕 HUD Overlay：
//    - 上／下工具列與遮罩都**恆在**，用 `offset` / `opacity` 收放。
//    - 動畫靠 `animation={{animation, value: hudVisible.value}}`（屬性動畫），
//      不用 `Transition` + `withAnimation`——那條路徑在這塊 overlay 上實測會退化成淡入淡出。
//    - 隱藏時靠 `allowsHitTesting` 擋觸控（`opacity=0` 不會停掉命中測試）。
//    - 目錄＝原生 iOS 半屏 Bottom Sheet（presentationDetents）；閱讀設定＝右上角齒輪的系統 `Menu`。
//      両者都不自刻浮層：外觀、開關、點外面收起全交給系統。
//
// 閱讀模式（齒輪的閱讀設定可切，存於 `library/readerSettings.ts`）：
//   - 畫廊：一張圖一頁，撐滿畫布，翻頁吸附（scrollTargetBehavior="paging"）。
//   - 連續：沿著軸向平滑流動（縱向＝webtoon 寬度撐滿；橫向＝以畫布高度為準）。
//   方向：左到右／右到左（橫向，RTL 用 layoutDirection 鏡像）／上到下（縱向）。
//   兩種模式都以 `onScrollTargetVisibilityChange` 取「領先可見頁」寫回閱讀進度；
//   `initialPage` 用 `scrollPosition`（綁 `useObservable`）還原到該頁。
//
// 換話是**就地換**（只改 `currentEpId`，不推新 route）：推新頁的話每換一話就多疊一層，
// 一次看很多話之後返回要連點很多次才回得到詳情頁。
//
// 離線模式（`offlineMode`）：整條路只讀離線 manifest（`createOfflineSession`），不碰源也不發請求；
// 目錄只列「下載完」的章。離線書架與下載頁的閱讀入口走這條。
// 閱讀進度會一併記下 `offline` 旗標，續讀（歷史卡／首頁續讀卡）才知道要走離線（見 ResumeReaderScreen）。
//
// 翻頁手勢（閱讀設定可關，**只作用在橫向閱讀方向**）：畫布分三區——左右各 1/4＝上一頁／下一頁、中間 1/2＝HUD；
// 翻頁是滑過去的（`withAnimation` + `scrollPos`，見 TURN_ANIM）。
// 由右到左（rtl）時左右鏡像（下一頁在左邊）；由上到下（ttb）不做點擊翻頁，整頁點擊＝切 HUD。
// 「頁」＝圖片索引，跟底欄頁碼同一個口徑。
//
// 底欄另有頁碼拖曳列（Slider）：拖曳中只動頁碼、放開才跳頁；逐格拉會連續觸發圖片載入。
// 頁碼列的右緣是收藏（與詳情頁同一顆愛心，寫的是本地書架）。
// 跳頁後到捲動落定前要擋掉可見集合回報，否則舊回報會把頁碼彈回去（`scrubTarget`）。

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
  getReaderSettings,
  readerAxis,
  setReaderSettings,
  type ReaderSettings,
} from "../../library/readerSettings"
import { createOfflineSession, isOfflineReadable } from "./offlineSession"
import { groupChapters, resolveInitialGroupName, type ChapterGroup } from "./chapterGrouping"
import { clearUpscaleCache, disposeUpscaleEngine } from "../../engine/upscale"

/**
 * 單擊翻頁的滑動動畫。
 *
 * 只有「`withAnimation` 包住 `scrollPos.setValue`」這條路會有動畫；
 * 直接 setValue 是瞬間跳頁，而 `ScrollViewReader` 的 `proxy.scrollTo` 在這塊
 * lazy 內容上會捲不動（實測卡在同一頁），所以不走它。
 * 曲線試過 spring 0.3／0.22／0.15 與 easeOut 0.2，最後留短彈實 0.15（翻起來比較有「翻頁」感）。
 */
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
  // 閱讀模式／方向（持久化，換話或重開都沿用）
  const [settings, setSettings] = useState<ReaderSettings>(getReaderSettings())
  // 領先可見頁（0 起算）：畫廊/連續都看 onScrollTargetVisibilityChange 回報的可見集合。
  // 有還原目標時，先用目標頁當初始值，所以一進來頁碼就是對的（不是等回報才更新）。
  // 還原目標只認「開啟這一頁時指定的那一話」（entryEpId）；換話一律從頭。
  const entryEpId = useRef(epId)
  const entryPage = useRef(initialPage)
  const entryRestore = entryPage.current !== undefined && entryPage.current > 0 ? entryPage.current : null
  const restoringEntry = currentEpId === entryEpId.current && entryRestore !== null
  const [leadingPage, setLeadingPage] = useState<number | null>(restoringEntry ? entryRestore : null)
  // 還原捲動完成前忽略可見集合回報：第一次排版會先落在頂端並回報第 1 頁，
  // 那個過期值會把存好的頁碼蓋掉。
  const restored = useRef(!restoringEntry)
  // 還原用：可程式化捲動的雙向綁定。設值可重複生效（{value,onChanged} 那個寫法只喫第一次、且 onChanged 不回報）。
  const scrollPos = useObservable("0")
  // 頁碼拖曳列：綁 Observable（{value,onChanged} 那個寫法會多繞一次 React 更新，拖起來會頓）。
  // 拖曳中是唯一值來源；沒拖曳時由 effect 同步成實際閱讀位置。
  const scrubValue = useObservable(0)
  const [scrubbing, setScrubbing] = useState(false)
  // 非 null＝正在等捲動走到該頁，期間忽略可見集合回報。
  const scrubTarget = useRef<number | null>(null)
  // 動畫翻頁的目標頁（語意同 scrubTarget）：動畫途中會經過中間頁，
  // 那些回報會把頁碼往回拉一格再跳回來，所以先擋掉。
  const turnTarget = useRef<number | null>(null)
  // 三個兜底閘門的計時器 handle（還原 800ms、拖曳與翻頁各 600ms）。
  // 這三個都要能被清掉：換話是同一層 route 就地換、離開閱讀器也只是這個畫面消失，
  // 計時器不會自己停——不收回來就會跑過這一話，後人也不該以為這種寫法可以照抄。
  // ⚠️ 比 `null`，不能寫 `if (timer)`：這個 runtime 的 setTimeout 回傳 number，
  // 而且**第一個一定是 0**（falsy），那一個用真假值判斷會清不掉。
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
  // 章節連標題都沒有時的替代字是**我們的文案**（會出現在 HUD 與章末卡片），所以進字典；
  // 在 render 時求值，換語言下一次 render 就跟著換。
  const title = (index >= 0 ? currentGroupChapters[index]?.title : chapters.find(c => c.id === currentEpId)?.title) || t("reader.chapterFallback", { n: Math.max(1, index + 1) })
  // 「頁」＝圖片索引；頁數由 session 給（下載過的章就是離線 manifest 的張數）。
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
   * 翻一頁（頁＝圖片索引，跟底欄頁碼同口徑）：把領先可見頁往前／後推一格，
   * 用 `scrollPos` 捲過去。畫廊與連續都一樣——連續模式就是「跳到上／下一張圖的頂端」。
   * 順手樂觀更新 `leadingPage`，連點時下一擊才是從新位置算；`turnTarget` 則擋掉
   * 動畫途中那些過期的可見集合回報。
   */
  function turnPage(delta: 1 | -1) {
    if (pageCount === 0 || leadingPage === null) return
    const target = Math.min(Math.max(leadingPage + delta, 0), pageCount - 1)
    if (target === leadingPage) return
    turnTarget.current = target
    setLeadingPage(target)
    void withAnimation(TURN_ANIM, () => scrollPos.setValue(String(target)))
    // 兜底：單張圖那種不必捲動的情形不會有回報，別讓閘門永遠關著。
    // 先清上一次的兜底（連點翻頁會各排一個，舊的不該留著），再排這次的。
    clearGate(turnTimer)
    turnTimer.current = setTimeout(() => {
      turnTimer.current = null
      if (turnTarget.current === target) turnTarget.current = null
    }, 600)
  }

  /**
   * 畫布點擊：三區翻頁（左／中／右）；沒開分區、或閱讀方向是上到下連續模式時，整頁點擊＝切 HUD。
   *
   * 座標空間契約：手勢必須宣告為 `coordinateSpace: "global"`（見 ScrollView:onTapGesture）。
   * 原因是若宣告為 "local"，ScrollView 回傳的是內容絕對座標（Content Offset），橫向或縱向
   * 捲動過第 1 頁後 location 會累計位移達數百至數千點，導致判定永遠漂出中間區。
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
  // 畫布尺寸要量「盒子自己」：`GeometryReader(ignoresSafeArea:)` 的 `size` 是安全區盒（少上下安全區），
  // 拿它當頁面框會讓每頁短一節（縱向畫廊的最後一頁還因此被壓在底部）。差異見 dev/probe-canvas-box.tsx。
  const [canvasBox, setCanvasBox] = useState<{ width: number; height: number } | null>(null)
  const pageSize = canvasBox ?? viewport

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
    setReaderSettings(next)
    if (patch.hardwareSharpen !== undefined && session) {
      session.setHardwareSharpen(patch.hardwareSharpen)
      // 超分開關切換時推動世代序號，觸發當前畫面上所有 ChapterImage 重跑 loadPage 響應開關
      setRenderGeneration(g => g + 1)
    }
  }

  // 每一頁的排版：畫廊＝一張圖一頁、撐滿螢幕；橫向連續＝以畫布高度為準；縱向連續＝寬度撐滿。
  // 縮放只做在**畫廊模式**（單頁、錨點算得準）。
  // 連續模式不做：畫布在 ScrollView 裡拿不到捲動位移（`ScrollProps` 沒有 scroll offset API），
  // 手勢座標是畫布座標 → 算不出「點在畫布的哪裡」→ 錨點一定偏；試過的替代寫法也都會
  // 踩到引擎的手勢仲裁限制（見 components/ZoomableView 檔頭）。
  // 這一疊頁面只在「這一話、頁數、版面形狀、畫布尺寸」真的變了才重建。
  // （左到右／右到左的鏡像是 ScrollView 的 environment，不在頁面本身，所以 rtl 不是 dep。）
  // 不包起來的話，每一次重繪都會重建 N 個 element——捲動時 `leadingPage` 一直變，
  // 目錄／HUD 開關、收藏也都會讓這個元件重繪（200 頁的章節＝200 個，畫廊模式還各多一層 ZoomableView）。
  // deps 只放純值：`pageSize`（＝`canvasBox ?? viewport`）這個物件每次 render 都是新的，包了等於沒包，
  // 所以拆成 width／height；`session` 是 state（一話一份），只會在換話／重開時變。
  // 換話要整棵重建是刻意的：`currentEpId` 同時是 ScrollView 的 key 與縮放的 resetToken（換話＝從頭讀）。
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
                ? "viewAlignedLimitAlwaysByOne" // 縱向畫廊：iOS 原生嚴格單頁吸附，一次手勢只翻一頁，絕不停在半中間！
                : "paging"                      // 橫向畫廊：標準 paging
              : undefined                       // 連續模式：自由平滑流動
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
          // ⚠️ 必須為 global：若為 local，ScrollView 翻過第 1 頁後 location 會包含累計滾動位移，導致點擊區域判定完全漂移
          onTapGesture={{ count: 1, coordinateSpace: "global", perform: handleCanvasTap }}
          onScrollGeometryChange={{
            of: "geometry",
            onChanged: (_, geo) => {
              if (!next) return
              // 防誤觸守衛：必須已滾動或閱讀至章節末尾附近，才允許觸發 overscroll
              // 1. 若內容長度不足一屏（短章節或單圖），必須確實滾動過末端；
              // 2. 畫廊或連續模式下，可見頁碼必須在最後 1~2 頁之內（避免開頭或中間大幅彈動誤觸）
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


