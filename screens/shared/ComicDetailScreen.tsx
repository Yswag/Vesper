// 漫畫詳情、收藏與章節閱讀入口。

import {
  Button,
  Divider,
  GeometryReader,
  HStack,
  Image,
  LazyVStack,
  LazyHStack,
  Menu,
  NamespaceReader,
  NavigationLink,
  ScrollView,
  Spacer,
  Text,
  Toolbar,
  ToolbarItem,
  ToolbarSpacer,
  VStack,
  ZStack,
  useEffect,
  useColorScheme,
  useMemo,
  useState,
  type Color,
  type VirtualNode,
} from "scripting"

import { CoverImage } from "../../components/CoverImage"
import { WidthReporter } from "../../components/WidthReporter"
import { CoverViewerScreen } from "./CoverViewerScreen"
import { isActive, type ChapterDownloadState, type ComicLibrary, type ComicPage, type ComicRef } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { comicUpdateRecord, pauseUpdates, resumeUpdates } from "../../app/updates"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import {
  isFavorite,
  markAllChaptersRead,
  markChapterRead,
  readChapterIds,
  setComicUpdate,
  toggleFavorite,
} from "../../library/bookshelf"
import { formatStars } from "../../design/rating"
import { CommentScreen } from "./CommentScreen"
import { heroCoverSize, recommendCardSize } from "./comicMetrics"
import { presentReader } from "./ResumeReaderScreen"
import { type ChapterRef } from "./ReaderScreen"
import { groupChapters, resolveInitialGroupName, type ChapterGroup } from "./chapterGrouping"
import { PageBackground, useTint } from "../../app/theme"
import { cardBackground, cardShape, capsule, fill, pageInsets, pageSpacing, palette, radius, rect, rowPadding } from "../../design/tokens"
import { Card } from "../../design/layout"
import { Tag } from "../../design/Tag"
import { Chip } from "../../design/chip"
import { PageLoading } from "../../design/status"
import { GlassSurface } from "../../design/GlassSurface"
import { liquidGlass, scrollTopBar } from "../../design/glass"

/**
 * 批次解析章節下載狀態映射表（單次重繪單一章節僅查詢一次，提升效能）。
 */
export function chapterDownloadStates(
  library: Pick<ComicLibrary, "downloadState">,
  ref: ComicRef,
  epIds: string[]
): Record<string, ChapterDownloadState> {
  const states = new Map<string, ChapterDownloadState>()
  for (const epId of epIds) {
    if (!states.has(epId)) states.set(epId, library.downloadState({ ...ref, epId }))
  }
  // 攤成物件：呼叫端只讀自己問過的 epId，取值不必再判 undefined。
  return Object.fromEntries(states)
}

/** 「全部已讀」算的章節：鎖定的看不到內容，標了也沒意義，直接排除。 */
export function readableChapters<T extends { locked?: boolean }>(chapters: readonly T[]): T[] {
  return chapters.filter(chapter => chapter.locked !== true)
}

/** 連載狀態的介面字（源只給代碼，畫面負責翻）。 */
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

/** 只有 `suggestive`／`nsfw` 會走到這裡（safe 不占位置）。 */
function ratingText(rating: NonNullable<ComicPage["contentRating"]>): string {
  return rating === "nsfw" ? t("detail.ratingNsfw") : t("detail.ratingSuggestive")
}

export function ComicDetailScreen({
  sourceKey,
  comicId,
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
  // 帶色玻璃只吃 Color：先拿目前的方案解成字串。
  const tint = useTint()
  const tintColor = String(tint.tint[useColorScheme()]) as Color
  const [detail, setDetail] = useState<ComicPage | null>(null)
  // 載入失敗的原因；null＝沒話要說（載入中也算，那一句在 render 時才算）。
  const [status, setStatus] = useState<string | null>(null)
  const [reverseOrder, setReverseOrder] = useState(false)
  const [descExpanded, setDescExpanded] = useState(false)
  // 多選下載模式：已勾選待下載的章節 ID 清單
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  // 依容器實測寬度動態計算 hero 封面尺寸
  const [heroContainerWidth, setHeroContainerWidth] = useState(0)
  // 頂部氛圍光暈圖片
  const [ambientImage, setAmbientImage] = useState<UIImage | null>(null)
  // 滾動離開視線時才在導航欄顯示書名
  const [showNavTitle, setShowNavTitle] = useState(false)

  // 訂閱來源變更、下載進度、書架狀態與語言切換
  const refresh = useSubscription(library.onChange, subscribeLocale)

  // 收藏狀態直接從書架讀取
  const favorite = isFavorite(sourceKey, comicId)

  // 詳情頁在畫面上（含被閱讀器蓋住的期間）就是前台：背景追更先讓路，別跟這裡搶連線。
  useEffect(() => {
    pauseUpdates()
    return () => resumeUpdates()
  }, [])

  useEffect(() => {
    let alive = true
    setStatus(null)
    // 詳情走 ComicLibrary：這一頁不再自己 loadDetail，也不必知道源回傳的原始形狀。
    // 找不到源／沒載入成功都在庫的邊界變成可讀的錯誤訊息。
    library
      .comic({ sourceKey, comicId })
      .then(
        result => {
          if (!alive) return
          setDetail(result)
          setStatus(null)
          // 零成本同步：章節清單已經在手上，不必再為了「有沒有新話」問一次源。
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

  // 章節清單的轉換只有一份（`ComicLibrary.readerChapters`）：詳情頁與續讀拿到的是同一個形狀。
  const chapters: ChapterRef[] = detail ? library.readerChapters(detail) : []

  // 續讀點：ComicLibrary 會把越界的頁碼 clamp 到合法範圍；沒讀過就是 null。
  const resumed = library.resume({ sourceKey, comicId })
  const comicTitle = detail?.title ?? initialTitle
  const comicCover = detail?.cover

  // 章節分組（當源有多個不同 group 時支援分組分頁切換）
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

  // 當前選取分組中的章節（若無分組則為全部章節）
  const currentGroupChapters: ChapterRef[] = useMemo(() => {
    if (!isGrouped) return chapters
    const matched = chapterGroups.find((g: ChapterGroup<ChapterRef>) => g.name === activeGroup)
    return matched ? matched.chapters : chapters
  }, [isGrouped, chapterGroups, activeGroup, chapters])

  // 已讀章節：手動標記與閱讀結算共用同一份紀錄（`Progress.readEpIds`）。
  const readIds = readChapterIds(sourceKey, comicId)

  useEffect(() => {
    if (!comicCover) return
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

  // 確定首選閱讀章節：優先續讀上次進度，無進度則自第一話起算（鎖定的章節不自動開）。
  const firstReadable = chapters.find(chapter => !chapter.locked)
  const resumedReadable =
    resumed && chapters.some(c => c.id === resumed.chapter.epId && !c.locked) ? resumed.chapter.epId : undefined
  const targetEpId = resumedReadable ?? firstReadable?.id

  const targetEpTitle = chapters.find(chapter => chapter.id === targetEpId)?.title

  // 上次讀到的頁碼（只有續讀同一話時才帶，換話從頭）。
  const resumePage = resumed && resumed.chapter.epId === targetEpId ? resumed.page : undefined

  // 整理所有標籤
  const allTags = (detail?.tags ?? []).flatMap(g => g.values)

  // 源給的星等（唯讀）；源沒給或無法辨識就沒有這一項。
  const rating = formatStars(detail?.stars)

  // 簡介文字清洗
  const cleanDescription = (detail?.description ?? "")
    .replace(/\\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  const isLongDescription = cleanDescription.length > 60 || cleanDescription.split("\n").length > 2

  // 章節排序（針對當前分組）
  const displayChapters = reverseOrder ? [...currentGroupChapters].reverse() : currentGroupChapters

  // 依當前重繪單一快照查詢章節下載狀態表
  const chapterStates = chapterDownloadStates(library, { sourceKey, comicId }, [
    ...chapters.map(chapter => chapter.id),
    ...selectedIds,
  ])

  // 選取模式的兩個數字：都只算「尚未下載」且非鎖定的章節（鎖定的不能下載）。
  function pendingOf(epIds: string[]): string[] {
    return epIds.filter(epId => {
      if (chapters.find(chapter => chapter.id === epId)?.locked) return false
      return chapterStates[epId].state !== "done"
    })
  }

  const pendingAll = pendingOf(currentGroupChapters.map(chapter => chapter.id))
  const pendingSelected = pendingOf(selectedIds)

  // 「全部已讀」只看當前分組裡沒被源鎖定的章節。
  const readable = readableChapters(currentGroupChapters)
  const unreadCount = readable.filter(chapter => !readIds.has(chapter.id)).length
  const allSelected = readable.length > 0 && readable.every(chapter => selectedIds.includes(chapter.id))

  /** 選取模式：「全選 / 取消全選」切換。 */
  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds([])
    } else {
      setSelectedIds(readable.map(chapter => chapter.id))
    }
  }

  /** 這一組章的漫畫資訊（下載頁要顯示的名稱與封面）；詳情還沒到就沒有。 */
  const downloadMeta = detail ? { comicTitle: detail.title, cover: detail.cover } : undefined

  /** 選取模式：點列＝切換勾選（不是進閱讀器）；鎖定的章節不能選。 */
  function toggleSelected(epId: string) {
    if (chapters.find(chapter => chapter.id === epId)?.locked) return
    setSelectedIds(previous =>
      previous.includes(epId) ? previous.filter(item => item !== epId) : [...previous, epId]
    )
  }

  /** 「下載 (n)」：只送還沒下載的章節，送出後退出選取模式。 */
  function downloadSelected() {
    const requests = pendingSelected.map(epId => ({
      sourceKey,
      comicId,
      epId,
      title: chapters.find(chapter => chapter.id === epId)?.title,
    }))
    if (requests.length > 0) void library.download(requests, downloadMeta)
    setSelectedIds([])
    setSelecting(false)
  }

  /** 「下載全部」：僅下載當前選中組別（避免多語言源一次下載所有語言）。 */
  function downloadAll() {
    const requests = currentGroupChapters.map(chapter => ({ sourceKey, comicId, epId: chapter.id, title: chapter.title }))
    if (requests.length > 0) void library.download(requests, downloadMeta)
  }

  /** 單章下載的觸發（章節列左滑）。 */
  function downloadChapter(chapter: ChapterRef) {
    void library.download(
      [{ sourceKey, comicId, epId: chapter.id, title: chapter.title }],
      downloadMeta
    )
  }

  /** 章節列左滑：反轉這一話的已讀狀態。 */
  function toggleRead(chapter: ChapterRef) {
    markChapterRead(sourceKey, comicId, [chapter.id], !readIds.has(chapter.id))
  }

  /** 「全部標為已讀」：一次標完當前分組裡還讀得到的章節。 */
  function markGroupRead() {
    markAllChaptersRead(
      sourceKey,
      comicId,
      readable.map(chapter => chapter.id)
    )
  }

  /** 選取模式的「標為已讀」：勾起來的一次標完，然後退出選取。 */
  function markSelectedRead() {
    if (selectedIds.length === 0) return
    markChapterRead(sourceKey, comicId, selectedIds, true)
    setSelectedIds([])
    setSelecting(false)
  }

  // 封面尺寸：容器給多少寬度就用多少（見 comicHeroMetrics 與 docs/ui-ux-liquid-glass.md）。
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
      // 被閱讀器蓋住時不會重繪；退回來要靠 onAppear 重新讀一次書架/進度，
      // 否則收藏愛心與「上次讀到」會停在進閱讀器前的舊狀態。
      onAppear={() => refresh()}
    >
      <PageBackground />

      {/* 頂部封面 Ambient Glow 氛圍漫射光暈。
          氛圍圖一定要用「量到的容器寬」：`maxWidth: "infinity"` 會讓圖片拿自己的寬高比
          （380 × 寬/高）當理想寬度，橫式封面就變成整頁寬度，把整頁推歪（內容偏左、標題切到右緣）。
          見 dev/probe-cover-overflow.tsx：同一個橫式封面，量寬前 798、量寬後 402。 */}
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
      {/* 載入初態（失敗時同一個位置顯示錯誤訊息） */}
      {!detail ? <PageLoading text={status ?? t("common.loading")} /> : null}

      {detail ? (
        <ScrollView
          scrollContentBackground="hidden"
          frame={{ maxWidth: "infinity" }}
          // 跟首頁一樣：內容捲到導覽列下面時是柔和淡出，不是硬邊的分隔線。
          {...scrollTopBar(null)}
          onScrollTargetVisibilityChange={{
            idType: "string",
            threshold: 0.1,
            onChanged: ids => {
              setShowNavTitle(!(ids as string[]).includes("hero-title"))
            },
          }}
          // 量到的容器寬（hero 封面尺寸用）。`maxWidth: "infinity"` 會讓圖片拿自己的寬高比
          // （380 × 寬/高）當理想寬度，橫式封面就變成整頁寬度，把整頁推歪
          // （見 dev/probe-cover-overflow.tsx：同一個橫式封面，量寬前 798、量寬後 402）。
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

            {/* 1. Hero 頂部海報與元資訊 */}
            <HStack
              key="hero-title"
              spacing={16}
              alignment="top"
              frame={{ maxWidth: "infinity" }}
            >
            <NamespaceReader>
              {heroNs => (
                // 點 hero 封面 → 全螢幕看原圖（不裁切的完整封面）。
                // 用 NavigationLink **推入**（不是 modal）：只有推入頁面才會有 zoom 轉場動畫
                // （modal 的 navigationTransition 引擎不觸發，實測過）。
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
                    alignment="center"
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
                  </ZStack>
                </NavigationLink>
              )}
            </NamespaceReader>

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
                  {comicTitle}
                </Text>

                {detail.uploader ? (
                  <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={2}>
                    {t("detail.author", { name: detail.uploader })}
                  </Text>
                ) : null}

                {detail.artists ? (
                  <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={2}>
                    {t("detail.artist", { name: detail.artists })}
                  </Text>
                ) : null}

                {/* 狀態標籤：章數／來源／連載狀態都是中性（不搶注意力）。 */}
                <HStack spacing={6}>
                  <Tag text={t("detail.chapterCount", { n: chapters.length })} />
                  <Tag text={detail.sourceName} />
                  {detail.status ? <Tag text={statusText(detail.status)} /> : null}
                </HStack>

                {/* 唯讀星等、分級與喜愛數：源有給才出現。 */}
                {rating || (detail.contentRating && detail.contentRating !== "safe") || (detail.likesCount != null && detail.likesCount > 0) ? (
                  <HStack spacing={8} alignment="center">
                    {detail.contentRating && detail.contentRating !== "safe" ? (
                      <Tag
                        icon={detail.contentRating === "nsfw" ? "exclamationmark.triangle.fill" : "info.circle"}
                        text={ratingText(detail.contentRating)}
                        tone={detail.contentRating === "nsfw" ? "danger" : "warning"}
                      />
                    ) : null}

                    {rating ? <Tag text={`${rating.glyphs} ${rating.score}`} tone="warning" /> : null}

                    {detail.likesCount != null && detail.likesCount > 0 ? (
                      <Tag
                        icon="heart.fill"
                        tone="love"
                        accessibilityLabel={t("detail.likesCount", { n: detail.likesCount })}
                        text={
                          detail.likesCount >= 10000
                            ? `${(detail.likesCount / 10000).toFixed(1)}w`
                            : detail.likesCount >= 1000
                            ? `${(detail.likesCount / 1000).toFixed(1)}k`
                            : String(detail.likesCount)
                        }
                      />
                    ) : null}
                  </HStack>
                ) : null}

                {/* 時間：優先顯示更新時間，若無則顯示發布時間 */}
                {detail.updateTime || detail.uploadTime ? (
                  <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1}>
                    {detail.updateTime
                      ? t("detail.updatedAt", { time: detail.updateTime })
                      : t("detail.uploadedAt", { time: detail.uploadTime! })}
                  </Text>
                ) : null}
              </VStack>
            </HStack>

            {/* 閱讀入口與動作列（開始閱讀 + 收藏 + 評論留言） */}
            <HStack spacing={10} alignment="center" frame={{ maxWidth: "infinity" }}>
              {targetEpId ? (
                // 閱讀器一律用全螢幕呈現（不是推入）：推入的話狀態列與 tab bar 的修飾子會被導覽容器吃掉。
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
                // 有章節但全部鎖定：不讓入口消失，改成看得懂的狀態。
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

              {/* 收藏按鈕 */}
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

              {/* 評論留言入口：源沒宣告 loadComments 就完全不出現 */}
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

            <Divider />

            {/* 3. 標籤膠囊群 (Pills)：約束在 maxWidth: "infinity" 內，防止大量 tags 撐破父容器 */}
            {allTags.length > 0 ? (
              <ScrollView axes="horizontal" scrollIndicator="hidden" frame={{ maxWidth: "infinity" }}>
                <HStack spacing={8}>
                  {allTags.map((tag, i) => (
                    <Tag key={`tag:${i}:${tag}`} text={tag} />
                  ))}
                </HStack>
              </ScrollView>
            ) : null}

            {/* 4. 故事簡介（長文本自然漸隱淡出，短文本完整清晰不模糊） */}
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

            {/* 4.5 相關推薦漫畫（若源有提供，置於簡介下方與章節列表上方） */}
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

            {/* 5. 章節列表頭部（緊湊合一工具列，大幅減少垂直佔位） */}
            <VStack spacing={12}>
              <HStack alignment="center" spacing={6}>
                {selecting ? (
                  <>
                    <HStack spacing={6} alignment="center">
                      <Chip
                        compact
                        text={allSelected ? t("detail.deselectAll") : t("detail.selectAll")}
                        onTap={toggleSelectAll}
                      />
                      {selectedIds.length > 0 ? (
                        <Text font="subheadline" fontWeight="medium" foregroundStyle="secondaryLabel">
                          {selectedIds.length}
                        </Text>
                      ) : null}
                    </HStack>
                    <Spacer />
                    <HStack spacing={6}>
                      <Chip
                        compact
                        text={t("detail.downloadSelected", { n: pendingSelected.length })}
                        selected={pendingSelected.length > 0}
                        disabled={pendingSelected.length === 0}
                        onTap={downloadSelected}
                      />
                      <Chip
                        compact
                        text={t("detail.markSelectedRead", { n: selectedIds.length })}
                        selected={selectedIds.length > 0}
                        disabled={selectedIds.length === 0}
                        onTap={markSelectedRead}
                      />
                      <Chip
                        compact
                        text={t("common.cancel")}
                        onTap={() => {
                          setSelecting(false)
                          setSelectedIds([])
                        }}
                      />
                    </HStack>
                  </>
                ) : (
                  <>
                    <HStack spacing={6} alignment="firstTextBaseline">
                      <Text font="title3" fontWeight="bold">
                        {t("detail.chaptersTitle")}
                      </Text>
                      <Text font="subheadline" fontWeight="medium" foregroundStyle="tertiaryLabel">
                        {isGrouped ? `${currentGroupChapters.length} / ${chapters.length}` : chapters.length}
                      </Text>
                    </HStack>
                    <Spacer />
                    <HStack spacing={6}>
                      <Chip
                        compact
                        icon="arrow.up.arrow.down"
                        selected={reverseOrder}
                        accessibilityLabel={reverseOrder ? t("detail.sortAscending") : t("detail.sortDescending")}
                        onTap={() => setReverseOrder(!reverseOrder)}
                      />
                      <Chip
                        compact
                        text={t("detail.select")}
                        onTap={() => {
                          setSelecting(true)
                          setSelectedIds([])
                        }}
                      />
                      <Menu label={<Chip compact icon="ellipsis.circle" accessibilityLabel={t("detail.moreActions")} />}>
                        <Button
                          title={t("detail.markAllRead")}
                          systemImage="checkmark.circle"
                          disabled={unreadCount === 0}
                          action={markGroupRead}
                        />
                        <Button
                          title={t("detail.downloadAll")}
                          systemImage="arrow.down.circle"
                          disabled={pendingAll.length === 0}
                          action={downloadAll}
                        />
                      </Menu>
                    </HStack>
                  </>
                )}
              </HStack>

              {/* 5.1 分組切換標籤列（僅在有多個分組時顯示，水平滾動膠囊列） */}
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

              {/* 章節卡片流（左滑＝切換已讀 ／ 單章下載；自訂列的滑動要外層 swipeActionsContainer） */}
              <LazyVStack spacing={8} swipeActionsContainer={true}>
                {displayChapters.map(chapter => {
                  const isCurrent = resumed?.chapter.epId === chapter.id
                  const locked = chapter.locked === true
                  // 已讀＝淡化；當前話的強調色優先，看得到自己讀到哪。
                  const read = readIds.has(chapter.id)
                  // 這一列的狀態是上面那一輪算好的（與「下載 (n)」共用），不再自己問一次。
                  const download = chapterStates[chapter.id]
                  const settled = isActive(download.state) || download.state === "done"
                  const checked = selectedIds.includes(chapter.id)
                  const highlight = selecting ? checked : isCurrent

                  // 章節卡片內容
                  const body = (
                    <Card background={highlight ? tint.selectedRow : cardBackground}>
                      <HStack
                        padding={rowPadding}
                        frame={{ maxWidth: "infinity" }}
                        contentShape="rect"
                      >
                        {selecting && !locked ? (
                          <Image
                            systemName={checked ? "checkmark.circle.fill" : "circle"}
                            fontWeight="medium"
                            foregroundStyle={checked ? tint.tint : "tertiaryLabel"}
                          />
                        ) : null}
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
                          />
                        )}
                      </HStack>
                    </Card>
                  )

                  // 鎖定的章節只顯示，不包按鈕（點了不會進去）。
                  // 非鎖定章節一律包 Button：選取模式下點整張卡片任何地方都能切換勾選，正常模式下進閱讀器。
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

                  // 左滑：切換已讀＋（還沒下載完才有的）下載。選取模式與鎖定章節不給左滑。
                  // 外層也裁成卡片形狀：滑動容器會在列的矩形範圍畫一層底。
                  const actions: VirtualNode[] = [
                    <Button
                      key="read"
                      title={read ? t("detail.markUnread") : t("detail.markRead")}
                      systemImage={read ? "arrow.uturn.backward.circle" : "checkmark.circle"}
                      action={() => toggleRead(chapter)}
                    />,
                  ]
                  // 全滑只做第一顆（已讀切換）；下載完的就不必再擺一顆。
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

                  return selecting || locked ? (
                    <VStack key={chapter.id} spacing={0} clipShape={cardShape}>
                      {row}
                    </VStack>
                  ) : (
                    <VStack
                      key={chapter.id}
                      spacing={0}
                      clipShape={cardShape}
                      trailingSwipeActions={{ allowsFullSwipe: true, actions }}
                    >
                      {row}
                    </VStack>
                  )
                })}
              </LazyVStack>
            </VStack>

          </VStack>
        </ScrollView>
      ) : null}
    </VStack>
  </ZStack>
  )
}

/** 章節列的離線狀態：未下載 / 下載中 x/y / 已下載（未完成是誠實的「有缺」，不假裝下載好了）。 */
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
