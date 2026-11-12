// Scripting 首頁入口（Home Screen Tab UI）：Vesper 的 Mini Hub。
// 長駐於 Scripting 首頁分頁，不可調用 Script.exit()；完整的五分頁殼也不 present 進來（會在分頁裡再疊一層殼）。
//
// 區塊：搜尋、續讀 Hero、最新追更、待讀、閱讀熱力圖（順序與開關見 app/miniHubLayout.ts），
// 加上導覽列的「開啟完整 App」。
// 背景檢查是靜默的：資料載入完成、每次切回首頁各跑一輪，先漫畫源更新再追更；
// TTL 各自把關（見 app/sourceUpdates.ts、app/updates.ts），所以這裡放心呼叫。

import {
  Button,
  Divider,
  Device,
  GeometryReader,
  HStack,
  Image,
  NamespaceReader,
  NavigationLink,
  NavigationStack,
  ProgressView,
  RoundedRectangle,
  Script,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
  useEffect,
  useRef,
  useState,
  type VirtualNode,
} from "scripting"

import { createComicLibrary } from "./app/comic"
import { onBeforeExit } from "./app/lifecycle"
import { installLocaleSetting } from "./app/localeSetting"
import { getMiniHubLayout, type MiniHubSection } from "./app/miniHubLayout"
import { comicLibrary, installComicLibrary } from "./app/services"
import { backlogItems, byLatestUpdate, newChapters, resumeEntry, type ResumeEntry, type ShelfItem } from "./app/shelf"
import { availableSourceUpdates, checkSourceUpdates, subscribeSourceUpdates } from "./app/sourceUpdates"
import { PageBackground, reloadThemeFromStorage, useAppearanceOverride, useTint } from "./app/theme"
import { parseUpdateTime, updatesScheduler } from "./app/updates"
import { useSubscription } from "./app/useSubscription"
import { CoverImage } from "./components/CoverImage"
import { composeImage } from "./components/ModifyImageRenderer"
import { WidthReporter } from "./components/WidthReporter"
import { UnreadBadge } from "./design/CoverBadge"
import { Card, GroupHeader, PageScroll } from "./design/layout"
import { Chevron, IconRow } from "./design/rows"
import { capsule, cardGap, chipPadding, fill, pageInsets, radius, rect, rowPadding } from "./design/tokens"
import { ensureFileAccess, fileAccess } from "./engine/fs"
import { comicGroupKey } from "./engine/offline"
import { setImageCompositor } from "./engine/imagecache"
import { subscribe as subscribeLocale, t } from "./i18n"
import {
  allComicUpdates,
  dayKey,
  flushLibrary,
  getComicUpdate,
  listFavorites,
  listProgress,
  readingActivity,
  reloadLibraryFromDisk,
  subscribeLibrary,
  type ComicUpdateRecord,
  type DayActivity,
  type Favorite,
} from "./library/bookshelf"
import { formatHistoryTime } from "./screens/home/historyTime"
import { ReadingLogScreen } from "./screens/home/ReadingLogScreen"
import { SearchScreen } from "./screens/search/SearchScreen"
import { ComicDetailScreen } from "./screens/shared/ComicDetailScreen"
import { launchResumeReader } from "./screens/shared/ResumeReaderScreen"
import { reloadRegistry } from "./sources/registry"

/** 橫向封面列（追更、待讀）最多幾部。 */
const RAIL_LIMIT = 10

const HERO_COVER = { width: 84, height: 120 }
const RAIL_COVER = { width: 84, height: 118 }
/** 小封面的基準尺寸；實際寬度見 `recentCoverWidth`。 */
const RECENT_COVER = { width: 48, height: 68 }
/** 續讀按鈕上下各多出來的可點範圍：膠囊看起來 36pt，按起來 44pt。 */
const TAP_SLOP = 4
/** Hero 下方最多再放幾部最近在讀。 */
const RECENT_LIMIT = 8
/** 封面與文字之間。 */
const COVER_GAP = 12
const DORMANT_AFTER_DAYS = 90
const SEARCH_FIELD_HEIGHT = 44
const SEARCH_ZOOM_ID = "miniHub:search"
/** 檢查超過這麼久才顯示轉圈：TTL 沒到的那一輪幾乎立刻結束，不該每次切回來都閃一下。 */
const CHECKING_INDICATOR_DELAY = 400
const DAY_MS = 24 * 60 * 60 * 1000

const HEATMAP_COLS = 14
const HEATMAP_ROWS = 5
/** 量到卡片寬度前的暫用格子邊長。 */
const HEATMAP_CELL = 20
const HEATMAP_GAP = 3
/** 第 1–4 階的 tint 不透明度（0 階用中性底色）。 */
const HEATMAP_OPACITY = [0.45, 0.65, 0.85, 1]

let isInitialized = false

function initVesperForHomeScreen() {
  if (isInitialized) return
  isInitialized = true

  // 語言要在 render 期同步注入（讀 KV 是同步的，不需要授權也不用 await）：
  // 這個入口不能 await，第一輪 render 就該是對的語言。
  installLocaleSetting(Device.systemLocales)

  // 註冊退出/銷毀時落盤
  onBeforeExit(() => flushLibrary())

  // 圖片離屏合成器
  setImageCompositor(composeImage)

  // 畫面都透過 ComicLibrary 取資料，這個入口也是 composition root。
  installComicLibrary(createComicLibrary())
}

/**
 * 檔案授權確認後加載本機資料（若尚未授權則退守 KV 備援）。
 */
async function loadVesperData() {
  const granted = await ensureFileAccess()
  // 沒授權時 source 走 KV 備援，仍然是「現在該載的那份」，所以兩種情況都要 reload。
  reloadRegistry()
  if (granted) {
    reloadLibraryFromDisk()
  }
}

/**
 * 查一輪：先漫畫源更新，查完（不論成敗）再查追更，追更跑完才 resolve。
 * 兩邊都自己守 TTL 與去重，這裡不需要再判斷。`force`＝手動下拉：追更無視 TTL、用前台速度。
 */
async function checkQuietly(alive: () => boolean, force: boolean = false) {
  try {
    await checkSourceUpdates()
  } finally {
    if (alive()) await updatesScheduler().checkUpdates(force ? { force: true } : { background: true })
  }
}

/** 背景那一輪，順便回報「檢查中」給看板。 */
async function checkWithIndicator(alive: () => boolean, setChecking: (checking: boolean) => void) {
  const timer = setTimeout(() => {
    if (alive()) setChecking(true)
  }, CHECKING_INDICATOR_DELAY)
  try {
    await checkQuietly(alive)
  } finally {
    clearTimeout(timer)
    if (alive()) setChecking(false)
  }
}

/** 完整 App 走 run URL scheme：首頁分頁不能 present，那會再疊一層殼在分頁裡。
 *  這版 API 沒有 `Script.openUrl`，用 `createRunURLScheme` 組出同一個網址交給系統。 */
function openFullApp() {
  void Safari.openURL(Script.createRunURLScheme("Vesper"))
}

export default function HomeScreenDefaultUI() {
  // 於 render 階段建立服務實例（子畫面在 render 期間即依賴 ComicLibrary）
  initVesperForHomeScreen()

  const [dataReady, setDataReady] = useState(() => fileAccess() !== null)
  const tint = useTint()
  // 這裡是 Scripting 自己的首頁分頁：`preferredColorScheme` 會連宿主 App 一起切，只能用區域覆蓋。
  const scheme = useAppearanceOverride()
  const environments = scheme ? { colorScheme: scheme } : undefined

  // 收藏、已讀、追更快取、離線層與語言一變就重繪：背景檢查寫回 library.json 時看板自己跟上。
  const refresh = useSubscription(subscribeLibrary, comicLibrary().onChange, subscribeLocale, subscribeSourceUpdates)
  const [checking, setChecking] = useState(false)
  const mounted = useRef(true)
  const alive = () => mounted.current

  useEffect(() => {
    const check = () => void checkWithIndicator(alive, setChecking)

    // 授權結算後才載得到源與書架。在載入完成前不渲染看板，
    // 避免續讀卡在源尚未進入記憶體時就判斷成「源失效」。載完就開始背景檢查。
    void loadVesperData().finally(() => {
      setDataReady(true)
      if (mounted.current) check()
    })

    // 監聽 Scripting 首頁分頁事件
    const unsubscribeTab = Script.onHomeTabEvent(event => {
      switch (event) {
        case "selected":
          // 從其他分頁切換回首頁。完整 App 可能同時在寫 library.json（閱讀進度、追更），
          // 先重讀盤上的那一份：不只看板要是新的，接下來的背景檢查也才不會蓋掉完整 App 的寫入。
          reloadRegistry()
          reloadLibraryFromDisk()
          reloadThemeFromStorage()
          refresh()
          check()
          break
        case "deselected":
          // 切換至其他分頁，將資料落盤
          void flushLibrary()
          break
      }
    })

    return () => {
      mounted.current = false
      unsubscribeTab()
      void flushLibrary()
    }
  }, [])

  if (!dataReady) {
    return (
      <ZStack tint={tint.tint} environments={environments} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <PageBackground />
        <ProgressView />
      </ZStack>
    )
  }

  // 順序與開關在完整 App 的設定裡改；切回首頁的 refresh() 會重讀。
  const sections: Record<MiniHubSection, () => VirtualNode | null> = {
    resume: () => {
      const [resume, ...rest] = listProgress()
      // 還沒讀過任何東西：留一列帶去完整 App，頁面不會只剩導覽列。
      if (!resume) return <OpenAppRow key="resume" icon="book" title={t("home.miniHub.openApp")} />
      // 開不起來的（源被移除又沒離線內容）不放：小封面只有「點了續讀」一個動作。
      const recent = rest
        .map(resumeEntry)
        .filter(entry => entry.openable)
        .slice(0, RECENT_LIMIT)
      return <ResumeHero key="resume" entry={resumeEntry(resume)} recent={recent} />
    },
    updates: () => (
      <UpdatesSection
        key="updates"
        items={pendingUpdates()}
        idle={idleUpdatesState()}
        checking={checking}
        checkedAt={updatesCheckedAt()}
      />
    ),
    backlog: () => <BacklogSection key="backlog" items={backlogItems()} />,
    activity: () => <ActivitySection key="activity" activity={readingActivity()} />,
    search: () => <SearchSection key="search" />,
  }

  const sourceUpdates = availableSourceUpdates().length

  return (
    <NavigationStack environments={environments}>
      <ZStack tint={tint.tint} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <PageScroll title="Vesper" trailing={OpenAppButton} onRefresh={() => checkQuietly(alive, true)}>
          {sourceUpdates > 0 ? (
            // 源的更新要在完整 App 的源管理做，這裡只負責帶過去。
            <OpenAppRow
              icon="arrow.up.forward.app"
              title={t("home.miniHub.sourceUpdates", { n: sourceUpdates })}
            />
          ) : null}
          {getMiniHubLayout().enabled.map(section => sections[section]())}
        </PageScroll>
      </ZStack>
    </NavigationStack>
  )
}

/** 導覽列右上：交給完整的五個分頁 App。 */
function OpenAppButton() {
  const tint = useTint()
  return (
    <Button
      action={openFullApp}
      buttonStyle="plain"
      accessibilityLabel={t("home.miniHub.openApp")}
    >
      <Image
        systemName="arrow.up.forward.app"
        font="body"
        fontWeight="semibold"
        foregroundStyle={tint.tint}
      />
    </Button>
  )
}

/** 點了開完整 App 的一列。 */
function OpenAppRow({ icon, title }: { icon: string; title: string }) {
  const tint = useTint()
  return (
    <Card>
      <IconRow icon={icon} iconColor={tint.tint} title={title} onTap={openFullApp} />
    </Card>
  )
}

/**
 * 續讀 Hero：封面、作品名、上次那一話與進度；封面與按鈕以上的整塊資訊推詳情，「繼續閱讀」按鈕直接開閱讀器。
 * 按鈕自己就是標題，所以這一區不另外放分組標題。
 * `recent` 是其餘最近在讀的作品，有才在同一張卡片下方多一排小封面。
 */
function ResumeHero({ entry, recent }: { entry: ResumeEntry; recent: ResumeEntry[] }) {
  const tint = useTint()
  const [opening, setOpening] = useState(false)
  const fraction = entry.readFraction

  return (
    <Card>
      <HStack spacing={COVER_GAP} alignment="top" padding={rowPadding} frame={{ maxWidth: "infinity" }}>
        {/* 點封面進詳情 */}
        <NavigationLink
          destination={<ComicDetailScreen sourceKey={entry.sourceKey} comicId={entry.comicId} title={entry.title} />}
          buttonStyle="plain"
        >
          <CoverImage
            sourceKey={entry.sourceKey}
            url={entry.cover}
            width={HERO_COVER.width}
            height={HERO_COVER.height}
            title={entry.title}
            lifted={true}
          />
        </NavigationLink>

        {/* 右側資訊與操作欄：高度對齊封面，標題貼頂、進度與按鈕貼底 */}
        <VStack
          spacing={8}
          alignment="leading"
          frame={{ maxWidth: "infinity", height: HERO_COVER.height, alignment: "leading" }}
        >
          {/* 標題到進度條是同一個點擊區：中間的留白也推詳情 */}
          <NavigationLink
            destination={<ComicDetailScreen sourceKey={entry.sourceKey} comicId={entry.comicId} title={entry.title} />}
            buttonStyle="plain"
          >
            <VStack
              spacing={3}
              alignment="leading"
              frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
              contentShape="rect"
            >
              <HStack alignment="top" spacing={6} frame={{ maxWidth: "infinity" }}>
                <Text font="headline" fontWeight="bold" lineLimit={2}>
                  {entry.title}
                </Text>
                <Spacer />
                <Chevron />
              </HStack>
              <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={1}>
                {entry.epTitle || t("home.lastRead")}
              </Text>
              <Spacer minLength={0} />
              <ProgressView
                value={fraction ?? 0}
                progressViewStyle="linear"
                frame={{ maxWidth: "infinity" }}
                opacity={fraction === undefined ? 0 : 1}
              />
            </VStack>
          </NavigationLink>

          {/* 底列：左邊主要動作，右邊頁碼 */}
          <HStack spacing={8} alignment="center" frame={{ maxWidth: "infinity" }}>
            {entry.openable ? (
              <Button
                buttonStyle="plain"
                disabled={opening}
                // 可點範圍比膠囊高，負內距讓它不佔版面。
                padding={{ vertical: -TAP_SLOP }}
                action={() => {
                  setOpening(true)
                  void launchResumeReader({ sourceKey: entry.sourceKey, comicId: entry.comicId }).finally(() =>
                    setOpening(false)
                  )
                }}
              >
                <HStack padding={{ vertical: TAP_SLOP }} contentShape="rect">
                  <HStack
                    spacing={6}
                    alignment="center"
                    padding={chipPadding}
                    background={tint.tint}
                    clipShape={capsule()}
                    opacity={opening ? 0.6 : 1}
                  >
                    <Image systemName="play.fill" font="footnote" foregroundStyle={tint.onTint} />
                    <Text font="subheadline" fontWeight="semibold" foregroundStyle={tint.onTint} lineLimit={1}>
                      {t("home.resumeTitle")}
                    </Text>
                  </HStack>
                </HStack>
              </Button>
            ) : (
              <HStack spacing={4} alignment="center">
                <Image systemName="exclamationmark.triangle" font="caption2" foregroundStyle="secondaryLabel" />
                <Text font="caption2" foregroundStyle="secondaryLabel">
                  {t("home.sourceInvalid")}
                </Text>
              </HStack>
            )}
            <Spacer minLength={0} />
            {entry.pageLabel ? (
              <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1}>
                {entry.pageLabel.total
                  ? t("bookshelf.pageOfTotal", { page: entry.pageLabel.page, total: entry.pageLabel.total })
                  : t("bookshelf.pageOf", { page: entry.pageLabel.page })}
              </Text>
            ) : null}
          </HStack>
        </VStack>
      </HStack>
      {recent.length > 0 ? <Divider padding={{ leading: rowPadding.horizontal }} /> : null}
      {recent.length > 0 ? <RecentRail entries={recent} /> : null}
    </Card>
  )
}

/**
 * 小封面的寬度：一列放不下時微調成「整數張加半張」，最後一張露一半才看得出還能捲。
 * 還沒量到列寬、或全部放得下就用基準寬度。
 */
function recentCoverWidth(railWidth: number, count: number): number {
  const base = RECENT_COVER.width
  if (railWidth <= 0) return base
  const inner = railWidth - rowPadding.horizontal
  if (count <= Math.floor((inner + COVER_GAP) / (base + COVER_GAP))) return base
  const whole = Math.max(1, Math.round(inner / (base + COVER_GAP) - 0.5))
  return (inner - COVER_GAP * whole) / (whole + 0.5)
}

/** 其餘最近在讀的作品：一排小封面加進度條，點了直接續讀（詳情從 Hero 或書架去）。 */
function RecentRail({ entries }: { entries: ResumeEntry[] }) {
  const [openingKey, setOpeningKey] = useState<string | null>(null)
  const [railWidth, setRailWidth] = useState(0)
  const width = recentCoverWidth(railWidth, entries.length)
  const cover = { width, height: (width * RECENT_COVER.height) / RECENT_COVER.width }

  return (
    <ScrollView
      axes="horizontal"
      scrollIndicator="hidden"
      background={
        <GeometryReader>
          {geometry => <WidthReporter width={geometry.size.width} onWidth={setRailWidth} />}
        </GeometryReader>
      }
    >
      <HStack spacing={COVER_GAP} padding={rowPadding}>
        {entries.map(entry => {
          const key = comicGroupKey(entry)
          return (
            <Button
              key={key}
              buttonStyle="plain"
              disabled={openingKey !== null}
              accessibilityLabel={entry.title}
              action={() => {
                setOpeningKey(key)
                void launchResumeReader({ sourceKey: entry.sourceKey, comicId: entry.comicId }).finally(() =>
                  setOpeningKey(null)
                )
              }}
            >
              <VStack spacing={6} frame={{ width: cover.width }}>
                <ZStack>
                  <CoverImage
                    sourceKey={entry.sourceKey}
                    url={entry.cover}
                    width={cover.width}
                    height={cover.height}
                    title={entry.title}
                  />
                  {openingKey === key ? (
                    <ZStack
                      frame={cover}
                      background={fill.coverScrim}
                      clipShape={rect(radius.md)}
                      alignment="center"
                    >
                      <ProgressView controlSize="small" />
                    </ZStack>
                  ) : null}
                </ZStack>
                {/* 沒進度的也佔位（透明），整排封面才對得齊。 */}
                <ProgressView
                  value={entry.readFraction ?? 0}
                  progressViewStyle="linear"
                  frame={{ width: cover.width }}
                  opacity={entry.readFraction === undefined ? 0 : 1}
                />
              </VStack>
            </Button>
          )
        })}
      </HStack>
    </ScrollView>
  )
}

interface HeatmapCell {
  day: string
  level: number
}

/** 深淺看讀完的話數；只翻了頁沒讀完也算第 1 階。 */
function heatLevel(activity: DayActivity | undefined): number {
  if (!activity) return 0
  if (activity.chapters >= 5) return 4
  if (activity.chapters >= 3) return 3
  if (activity.chapters >= 2) return 2
  return activity.chapters > 0 || activity.pages > 0 ? 1 : 0
}

/** 最近 `HEATMAP_COLS × HEATMAP_ROWS` 天逐欄由上而下排（5 列），舊→新；今天固定在右下角。 */
function heatmapColumns(activity: Record<string, DayActivity>, now: number): HeatmapCell[][] {
  const totalDays = HEATMAP_COLS * HEATMAP_ROWS
  // 取中午，逐日加減時不會因日光節約時間跳日。
  const start = new Date(now)
  start.setHours(12, 0, 0, 0)
  start.setDate(start.getDate() - (totalDays - 1))

  const cols: HeatmapCell[][] = []
  for (let col = 0; col < HEATMAP_COLS; col++) {
    const cells: HeatmapCell[] = []
    for (let row = 0; row < HEATMAP_ROWS; row++) {
      const date = new Date(start)
      date.setDate(start.getDate() + col * HEATMAP_ROWS + row)
      const day = dayKey(date.getTime())
      cells.push({ day, level: heatLevel(activity[day]) })
    }
    cols.push(cells)
  }
  return cols
}

/** 連續閱讀天數：今天還沒讀就從昨天算起，不讓一大早的紀錄歸零。 */
function readingStreak(activity: Record<string, DayActivity>, now: number): number {
  const cursor = new Date(now)
  cursor.setHours(12, 0, 0, 0)
  if (heatLevel(activity[dayKey(cursor.getTime())]) === 0) cursor.setDate(cursor.getDate() - 1)
  let days = 0
  while (heatLevel(activity[dayKey(cursor.getTime())]) > 0) {
    days++
    cursor.setDate(cursor.getDate() - 1)
  }
  return days
}

/** 最近 7 天（含今天）讀完的話數。 */
function recentChapters(activity: Record<string, DayActivity>, now: number): number {
  const cursor = new Date(now)
  cursor.setHours(12, 0, 0, 0)
  let chapters = 0
  for (let day = 0; day < 7; day++) {
    chapters += activity[dayKey(cursor.getTime())]?.chapters ?? 0
    cursor.setDate(cursor.getDate() - 1)
  }
  return chapters
}

/** 閱讀熱力圖：最近 70 天（14 欄 × 5 列）的每日閱讀量；範圍內完全沒紀錄就整塊不顯示。整塊點下去推閱讀紀錄頁。 */
function ActivitySection({ activity }: { activity: Record<string, DayActivity> }) {
  const tint = useTint()
  const [gridWidth, setGridWidth] = useState(0)
  const now = Date.now()
  const cols = heatmapColumns(activity, now)
  if (!cols.some(col => col.some(cell => cell.level > 0))) return null
  const streak = readingStreak(activity, now)
  const weekChapters = recentChapters(activity, now)
  // 格子平分卡片內的寬度，左右貼齊卡片內距。
  const size = gridWidth > 0 ? (gridWidth - HEATMAP_GAP * (HEATMAP_COLS - 1)) / HEATMAP_COLS : HEATMAP_CELL

  return (
    <NavigationLink destination={<ReadingLogScreen />} buttonStyle="plain">
      <VStack spacing={cardGap} alignment="leading" frame={{ maxWidth: "infinity" }}>
        <HStack spacing={6} alignment="center" padding={{ trailing: 4 }} frame={{ maxWidth: "infinity" }}>
          <GroupHeader title={t("home.miniHub.activityTitle")} />
          <Spacer />
          {weekChapters > 0 ? (
            <Text font="footnote" foregroundStyle="secondaryLabel">
              {t("home.miniHub.weekChapters", { n: weekChapters })}
            </Text>
          ) : null}
          {streak >= 2 ? (
            <Text font="footnote" fontWeight="medium" foregroundStyle={tint.tint}>
              {t("home.miniHub.streak", { days: streak })}
            </Text>
          ) : null}
          <Chevron />
        </HStack>
        <Card>
          <VStack padding={rowPadding} frame={{ maxWidth: "infinity" }}>
            <HStack
              spacing={HEATMAP_GAP}
              frame={{ maxWidth: "infinity" }}
              background={
                <GeometryReader>
                  {geometry => <WidthReporter width={geometry.size.width} onWidth={setGridWidth} />}
                </GeometryReader>
              }
            >
              {cols.map(col => (
                <VStack key={col[0].day} spacing={HEATMAP_GAP}>
                  {col.map(cell => (
                    <RoundedRectangle
                      key={cell.day}
                      cornerRadius={4}
                      fill={cell.level > 0 ? tint.tint : fill.tag}
                      opacity={cell.level > 0 ? HEATMAP_OPACITY[cell.level - 1] : 1}
                      frame={{ width: size, height: size }}
                    />
                  ))}
                </VStack>
              ))}
            </HStack>
          </VStack>
        </Card>
      </VStack>
    </NavigationLink>
  )
}

/** 看板的一列：收藏接上追更紀錄與新話數。 */
interface UpdateItem {
  favorite: Favorite
  record: ComicUpdateRecord
  newCount: number
}

/** 還在更新的作品（完結或超過 90 天未更的不算）。 */
function isRecentUpdate(record: ComicUpdateRecord, now: number): boolean {
  if (record.status === "completed") return false
  if (record.updateTime) {
    const time = parseUpdateTime(record.updateTime)
    if (time !== undefined && now - time > DORMANT_AFTER_DAYS * DAY_MS) {
      return false
    }
  }
  return true
}

/** 有新話的收藏（上次碰它之後多出來的），最近更新的在前。 */
function pendingUpdates(): UpdateItem[] {
  const favorites = new Map(listFavorites().map(favorite => [comicGroupKey(favorite), favorite]))
  const items: UpdateItem[] = []
  for (const record of Object.values(allComicUpdates())) {
    const favorite = favorites.get(comicGroupKey(record))
    if (!favorite) continue
    const newCount = newChapters(record)
    if (newCount > 0) items.push({ favorite, record, newCount })
  }
  return items.sort((a, b) => byLatestUpdate(a.record, b.record))
}

/**
 * 看板有多新：還在更新的收藏裡，最久沒查的那一部的檢查時間（「這之後的更新都看得到」）。
 * 源被移除的查不了，不算；一部都沒查過就沒有。
 */
function updatesCheckedAt(): number | undefined {
  const favorites = new Set(listFavorites().map(favorite => comicGroupKey(favorite)))
  const now = Date.now()
  let oldest: number | undefined
  for (const record of Object.values(allComicUpdates())) {
    if (record.checkedAt <= 0 || !favorites.has(comicGroupKey(record))) continue
    if (!isRecentUpdate(record, now)) continue
    if (comicLibrary().source(record.sourceKey) === undefined) continue
    if (oldest === undefined || record.checkedAt < oldest) oldest = record.checkedAt
  }
  return oldest
}

/** 沒有新話時追更區該說什麼：沒收藏、收藏還沒查過、或真的都是最新。 */
type IdleUpdatesState = "shelfEmpty" | "unchecked" | "upToDate"

function idleUpdatesState(): IdleUpdatesState {
  const favorites = listFavorites()
  if (favorites.length === 0) return "shelfEmpty"
  const checked = favorites.some(
    favorite => (getComicUpdate(favorite.sourceKey, favorite.comicId)?.checkedAt ?? 0) > 0
  )
  return checked ? "upToDate" : "unchecked"
}

const IDLE_UPDATES: Record<IdleUpdatesState, { icon: string; text: () => string }> = {
  shelfEmpty: { icon: "books.vertical", text: () => t("bookshelf.emptyFavoritesDetail") },
  unchecked: { icon: "arrow.triangle.2.circlepath", text: () => t("home.miniHub.notChecked") },
  upToDate: { icon: "checkmark.circle.fill", text: () => t("home.miniHub.allUpToDate") },
}

/** `items` 是全部有更新的作品：標題的數字是總數，橫列只放前 `RAIL_LIMIT` 部。標題右邊是檢查中的轉圈，否則是上次檢查的時間。 */
function UpdatesSection({
  items,
  idle,
  checking,
  checkedAt,
}: {
  items: UpdateItem[]
  idle: IdleUpdatesState
  checking: boolean
  checkedAt?: number
}) {
  const tint = useTint()

  return (
    <VStack spacing={cardGap} alignment="leading" frame={{ maxWidth: "infinity" }}>
      <HStack spacing={6} alignment="center" padding={{ trailing: 4 }} frame={{ maxWidth: "infinity" }}>
        <GroupHeader
          title={items.length > 0 ? `${t("home.miniHub.updatesTitle")} (${items.length})` : t("home.miniHub.updatesTitle")}
        />
        <Spacer />
        {checking ? (
          <ProgressView controlSize="small" />
        ) : checkedAt !== undefined ? (
          <Text font="footnote" foregroundStyle="tertiaryLabel">
            {formatHistoryTime(checkedAt)}
          </Text>
        ) : null}
      </HStack>
      {items.length === 0 ? (
        <Card>
          <HStack spacing={10} alignment="center" padding={rowPadding} frame={{ maxWidth: "infinity" }}>
            <Image
              systemName={IDLE_UPDATES[idle].icon}
              font="body"
              foregroundStyle={idle === "upToDate" ? tint.tint : "secondaryLabel"}
            />
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              {IDLE_UPDATES[idle].text()}
            </Text>
          </HStack>
        </Card>
      ) : (
        <CoverRail
          items={items.slice(0, RAIL_LIMIT).map(item => ({
            favorite: item.favorite,
            count: item.newCount,
            prefix: "+",
            badgeLabel: t("home.miniHub.newChapters", { n: item.newCount }),
            subtitle: item.record.latestEpTitle,
          }))}
        />
      )}
    </VStack>
  )
}

/** 待讀：`items` 是全部的待讀作品，標題的數字是總數，橫列只放前 `RAIL_LIMIT` 部；沒有就整塊不顯示。 */
function BacklogSection({ items }: { items: ShelfItem[] }) {
  if (items.length === 0) return null

  return (
    <VStack spacing={cardGap} alignment="leading" frame={{ maxWidth: "infinity" }}>
      <GroupHeader title={`${t("home.miniHub.backlogTitle")} (${items.length})`} />
      <CoverRail
        items={items.slice(0, RAIL_LIMIT).map(item => ({
          favorite: item.favorite,
          count: item.unreadCount,
          badgeLabel: t("bookshelf.unreadBadge", { n: item.unreadCount }),
          subtitle: item.progress?.epTitle,
        }))}
      />
    </VStack>
  )
}

/** 搜尋：長得像搜尋框的一顆膠囊，點了從膠囊 zoom 進聚合搜尋頁，進去就展開輸入框。 */
function SearchSection() {
  return (
    <NamespaceReader>
      {searchNs => (
        <NavigationLink
          destination={<SearchScreen autoFocus={true} zoomFrom={{ sourceID: SEARCH_ZOOM_ID, namespace: searchNs }} />}
          buttonStyle="plain"
        >
          <HStack
            spacing={8}
            alignment="center"
            padding={{ horizontal: 14 }}
            frame={{ maxWidth: "infinity", height: SEARCH_FIELD_HEIGHT }}
            background={{ style: fill.chip, shape: capsule() }}
            contentShape="rect"
            matchedTransitionSource={{ id: SEARCH_ZOOM_ID, namespace: searchNs }}
          >
            <Image systemName="magnifyingglass" font="subheadline" foregroundStyle="secondaryLabel" />
            <Text font="body" foregroundStyle="secondaryLabel" lineLimit={1}>
              {t("home.miniHub.searchPrompt")}
            </Text>
            <Spacer />
          </HStack>
        </NavigationLink>
      )}
    </NamespaceReader>
  )
}

/** 橫向封面列的一格：封面角標、作品名與一行副標。 */
interface RailItem {
  favorite: Favorite
  count: number
  /** 角標數字前的符號（追更是 `+`）。 */
  prefix?: string
  /** 角標的讀屏說法。 */
  badgeLabel: string
  subtitle?: string
}

/** 橫向封面列（左右出血到頁面邊界）：每一格點了推詳情。 */
function CoverRail({ items }: { items: RailItem[] }) {
  return (
    <ScrollView axes="horizontal" scrollIndicator="hidden" padding={{ horizontal: -pageInsets.horizontal }}>
      {/* 沒副標的格子比較矮：靠上對齊，封面才在同一條線上。 */}
      <HStack spacing={12} alignment="top" padding={{ horizontal: pageInsets.horizontal, top: 4, bottom: 18 }}>
        {items.map(item => (
          <NavigationLink
            key={comicGroupKey(item.favorite)}
            destination={
              <ComicDetailScreen
                sourceKey={item.favorite.sourceKey}
                comicId={item.favorite.comicId}
                title={item.favorite.title}
              />
            }
            buttonStyle="plain"
          >
            <VStack spacing={6} alignment="leading" frame={{ width: RAIL_COVER.width }}>
              <ZStack alignment="topTrailing">
                <CoverImage
                  sourceKey={item.favorite.sourceKey}
                  url={item.favorite.cover}
                  width={RAIL_COVER.width}
                  height={RAIL_COVER.height}
                  title={item.favorite.title}
                  lifted={true}
                />
                <HStack padding={6}>
                  <UnreadBadge count={item.count} prefix={item.prefix} accessibilityLabel={item.badgeLabel} />
                </HStack>
              </ZStack>

              {/* 作品名稱（一行截斷） */}
              <Text
                font="caption"
                fontWeight="semibold"
                lineLimit={1}
                frame={{ width: RAIL_COVER.width, alignment: "leading" }}
              >
                {item.favorite.title}
              </Text>

              {/* 副標（一行截斷） */}
              {item.subtitle ? (
                <Text
                  font="caption2"
                  foregroundStyle="secondaryLabel"
                  lineLimit={1}
                  frame={{ width: RAIL_COVER.width, alignment: "leading" }}
                >
                  {item.subtitle}
                </Text>
              ) : null}
            </VStack>
          </NavigationLink>
        ))}
      </HStack>
    </ScrollView>
  )
}
