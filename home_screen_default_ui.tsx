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

const RAIL_LIMIT = 10

const HERO_COVER = { width: 84, height: 120 }
const RAIL_COVER = { width: 84, height: 118 }
const RECENT_COVER = { width: 48, height: 68 }
const TAP_SLOP = 4
const RECENT_LIMIT = 8
const COVER_GAP = 12
const DORMANT_AFTER_DAYS = 90
const SEARCH_FIELD_HEIGHT = 44
const SEARCH_ZOOM_ID = "miniHub:search"
const CHECKING_INDICATOR_DELAY = 400
const DAY_MS = 24 * 60 * 60 * 1000

const HEATMAP_COLS = 14
const HEATMAP_ROWS = 5
const HEATMAP_CELL = 20
const HEATMAP_GAP = 3
const HEATMAP_OPACITY = [0.45, 0.65, 0.85, 1]

let isInitialized = false

function initVesperForHomeScreen() {
  if (isInitialized) return
  isInitialized = true

  installLocaleSetting(Device.systemLocales)

  onBeforeExit(() => flushLibrary())

  setImageCompositor(composeImage)

  installComicLibrary(createComicLibrary())
}

async function loadVesperData() {
  const granted = await ensureFileAccess()
  reloadRegistry()
  if (granted) {
    reloadLibraryFromDisk()
  }
}

async function checkQuietly(alive: () => boolean, force: boolean = false) {
  try {
    await checkSourceUpdates()
  } finally {
    if (alive()) await updatesScheduler().checkUpdates(force ? { force: true } : { background: true })
  }
}

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

function openFullApp() {
  void Safari.openURL(Script.createRunURLScheme("Vesper"))
}

export default function HomeScreenDefaultUI() {
  initVesperForHomeScreen()

  const [dataReady, setDataReady] = useState(() => fileAccess() !== null)
  const tint = useTint()
  const scheme = useAppearanceOverride()
  const environments = scheme ? { colorScheme: scheme } : undefined

  const refresh = useSubscription(subscribeLibrary, comicLibrary().onChange, subscribeLocale, subscribeSourceUpdates)
  const [checking, setChecking] = useState(false)
  const mounted = useRef(true)
  const alive = () => mounted.current

  useEffect(() => {
    const check = () => void checkWithIndicator(alive, setChecking)

    void loadVesperData().finally(() => {
      setDataReady(true)
      if (mounted.current) check()
    })

    const unsubscribeTab = Script.onHomeTabEvent(event => {
      switch (event) {
        case "selected":
          reloadRegistry()
          reloadLibraryFromDisk()
          reloadThemeFromStorage()
          refresh()
          check()
          break
        case "deselected":
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

  const sections: Record<MiniHubSection, () => VirtualNode | null> = {
    resume: () => {
      const [resume, ...rest] = listProgress()
      if (!resume) return <OpenAppRow key="resume" icon="book" title={t("home.miniHub.openApp")} />
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

function OpenAppRow({ icon, title }: { icon: string; title: string }) {
  const tint = useTint()
  return (
    <Card>
      <IconRow icon={icon} iconColor={tint.tint} title={title} onTap={openFullApp} />
    </Card>
  )
}

function ResumeHero({ entry, recent }: { entry: ResumeEntry; recent: ResumeEntry[] }) {
  const tint = useTint()
  const [opening, setOpening] = useState(false)
  const fraction = entry.readFraction

  return (
    <Card>
      <HStack spacing={COVER_GAP} alignment="top" padding={rowPadding} frame={{ maxWidth: "infinity" }}>
        {}
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

        {}
        <VStack
          spacing={8}
          alignment="leading"
          frame={{ maxWidth: "infinity", height: HERO_COVER.height, alignment: "leading" }}
        >
          {}
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

          {}
          <HStack spacing={8} alignment="center" frame={{ maxWidth: "infinity" }}>
            {entry.openable ? (
              <Button
                buttonStyle="plain"
                disabled={opening}
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

function recentCoverWidth(railWidth: number, count: number): number {
  const base = RECENT_COVER.width
  if (railWidth <= 0) return base
  const inner = railWidth - rowPadding.horizontal
  if (count <= Math.floor((inner + COVER_GAP) / (base + COVER_GAP))) return base
  const whole = Math.max(1, Math.round(inner / (base + COVER_GAP) - 0.5))
  return (inner - COVER_GAP * whole) / (whole + 0.5)
}

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
                {}
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

function heatLevel(activity: DayActivity | undefined): number {
  if (!activity) return 0
  if (activity.chapters >= 5) return 4
  if (activity.chapters >= 3) return 3
  if (activity.chapters >= 2) return 2
  return activity.chapters > 0 || activity.pages > 0 ? 1 : 0
}

function heatmapColumns(activity: Record<string, DayActivity>, now: number): HeatmapCell[][] {
  const totalDays = HEATMAP_COLS * HEATMAP_ROWS
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

function ActivitySection({ activity }: { activity: Record<string, DayActivity> }) {
  const tint = useTint()
  const [gridWidth, setGridWidth] = useState(0)
  const now = Date.now()
  const cols = heatmapColumns(activity, now)
  if (!cols.some(col => col.some(cell => cell.level > 0))) return null
  const streak = readingStreak(activity, now)
  const weekChapters = recentChapters(activity, now)
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

interface UpdateItem {
  favorite: Favorite
  record: ComicUpdateRecord
  newCount: number
}

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

interface RailItem {
  favorite: Favorite
  count: number
  prefix?: string
  badgeLabel: string
  subtitle?: string
}

function CoverRail({ items }: { items: RailItem[] }) {
  return (
    <ScrollView axes="horizontal" scrollIndicator="hidden" padding={{ horizontal: -pageInsets.horizontal }}>
      {}
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

              {}
              <Text
                font="caption"
                fontWeight="semibold"
                lineLimit={1}
                frame={{ width: RAIL_COVER.width, alignment: "leading" }}
              >
                {item.favorite.title}
              </Text>

              {}
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
