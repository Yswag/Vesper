// 首頁：繼續閱讀進度與 Bangumi 推薦流。

import { Button, Divider, GeometryReader, GlassEffectContainer, HStack, Image, LazyHStack, NamespaceReader, NavigationLink, ProgressView, RoundedRectangle, ScrollView, Spacer, TabView, Text, VStack, ZStack, useEffect, useColorScheme, useState, type Color, type VirtualNode } from "scripting"

import { ComicDetailScreen } from "../shared/ComicDetailScreen"
import { CoverImage, CoverPlaceholder } from "../../components/CoverImage"
import { CoverBadge } from "../../design/CoverBadge"
import { glass, liquidGlass, scrollTopBar } from "../../design/glass"
import { Tag } from "../../design/Tag"
import { WidthReporter } from "../../components/WidthReporter"
import { LeadingToolbar } from "../../components/LeadingToolbar"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { comicLibrary } from "../../app/services"
import { resumeEntry } from "../../app/shelf"
import { EmptyState } from "../../design/status"
import { capsule, coverShadow, coverStroke, fill, radius, rect } from "../../design/tokens"
import { listProgress, type Progress } from "../../library/bookshelf"
import { bangumiCardSize, resumeCardSize, type CardSize } from "../shared/comicMetrics"
import { launchResumeReader } from "../shared/ResumeReaderScreen"
import { PageBackground, useTint } from "../../app/theme"
import { getBangumiHomeFeed, type BangumiSubject } from "../../engine/bangumi"
import { BangumiDetailScreen } from "./BangumiDetailScreen"

/**
 * 量測橫向輪播的 ScrollView 視窗寬度，供子卡片計算尺寸。
 */
function carouselWidthProbe(onWidth: (width: number) => void) {
  return (
    <GeometryReader>
      {geometry => <WidthReporter width={geometry.size.width} onWidth={width => onWidth(Math.round(width))} />}
    </GeometryReader>
  )
}

/** 分頁點的融合容器；舊系統沒有玻璃，直接放內容。 */
function GlassDots({ children }: { children: VirtualNode }) {
  return liquidGlass ? <GlassEffectContainer spacing={6}>{children}</GlassEffectContainer> : children
}

export function HomeScreen() {
  // 帶色玻璃只吃 Color：先拿目前的方案解成字串。
  const tint = useTint()
  const tintColor = String(tint.tint[useColorScheme()]) as Color
  const [topRank, setTopRank] = useState<BangumiSubject[]>([])
  const [trending, setTrending] = useState<BangumiSubject[]>([])
  const [following, setFollowing] = useState<BangumiSubject[]>([])
  const [loadingFeed, setLoadingFeed] = useState(true)
  const [popularPool, setPopularPool] = useState<BangumiSubject[]>([])
  const [heroItems, setHeroItems] = useState<BangumiSubject[]>([])
  const [heroIndex, setHeroIndex] = useState(0)
  // 首頁不在畫面上時輪播暫停：畫面外換頁，TabView 跟不上 tabIndex，回來會錐位。
  const [heroActive, setHeroActive] = useState(true)

  // 「繼續閱讀」與 Bangumi 兩條 carousel 各自量自己的捲動視窗寬，卡片尺寸照 comicMetrics 算。
  const [resumeCarouselWidth, setResumeCarouselWidth] = useState(0)
  const [bangumiCarouselWidth, setBangumiCarouselWidth] = useState(0)
  // 繼續閱讀改成跟 Bangumi 一樣大
  const resumeCard = bangumiCardSize(resumeCarouselWidth)
  const bangumiCard = bangumiCardSize(bangumiCarouselWidth)

  /** 從候選大池中隨機洗牌挑選 8 部漫畫作為輪播圖項目（純本機計算，零網路延遲） */
  function pickHeroItems(pool: BangumiSubject[], fallbackRank: BangumiSubject[]) {
    const source = pool.length >= 8 ? pool : fallbackRank
    if (source.length >= 8) {
      const shuffled = [...source].sort(() => Math.random() - 0.5)
      setHeroItems(shuffled.slice(0, 8))
      setHeroIndex(0)
    }
  }

  /** 抓 Bangumi 推薦流（force ＝ 略過 24h 快取）。 */
  async function loadFeed(force: boolean) {
    const feed = await getBangumiHomeFeed(force)
    setTopRank(feed.topRank)
    setTrending(feed.trending)
    setFollowing(feed.following)
    setPopularPool(feed.popularPool)
    
    // 首次載入或下拉重整時挑選 8 部
    pickHeroItems(feed.popularPool, feed.topRank)
  }

  // 源清單與書架（進度）一變就重繪（庫的單一訂閱）；回傳的 refresh 給 onAppear 與下拉重整用。
  // 語言也在這裡：切了語言這一頁的字要立刻跟著變，不必重進。
  const refresh = useSubscription(comicLibrary().onChange, subscribeLocale)

  useEffect(() => {
    refresh()

    // 載入 Bangumi 推薦流（先給快取，24 小時內不連網）
    void loadFeed(false).finally(() => setLoadingFeed(false))
  }, [])

  // 輪播計時器（runtime 無 setInterval，且 setTimeout handle 0 為合法值需比對 !== null）
  useEffect(() => {
    if (!heroActive || heroItems.length <= 1) return

    const timer = setTimeout(() => {
      setHeroIndex(prev => (prev + 1) % heroItems.length)
    }, 4000)

    return () => {
      if (timer !== null) {
        clearTimeout(timer)
      }
    }
  }, [heroIndex, heroItems.length, heroActive])

  const progress = listProgress()

  return (
    <NamespaceReader>
      {homeNs => (
        <ZStack
          onAppear={() => {
            refresh()
            setHeroActive(true)
          }}
          onDisappear={() => setHeroActive(false)}
        >
          <PageBackground />
      <VStack
        spacing={0}
        navigationTitle={t("home.title")}
        navigationBarTitleDisplayMode="inline"
        toolbar={{ topBarLeading: <LeadingToolbar /> }}
      >
        <ScrollView
          scrollContentBackground="hidden"
          {...scrollTopBar(null)}
          // 下拉重新整理：略過 24 小時快取重抓榜單，並重讀一次書架的進度。
          // iOS 自己會顯示轉圈，所以這裡不動 loadingFeed（那是給首次載入用的 placeholder）。
          refreshable={async () => {
            refresh()
            await loadFeed(true)
          }}
        >
          <VStack spacing={24} padding={{ bottom: 44 }}>

            {/* Hero 輪播區塊 */}
            {heroItems.length > 0 && (
              <VStack
                spacing={8}
                frame={{ maxWidth: "infinity" }}
                // 氛圍光作為 background 裝飾層，不參與版面高度計算
                background={
                  <ZStack alignment="top" frame={{ maxWidth: "infinity" }}>
                    {heroItems.map((item, idx) => {
                      const isCurrent = idx === heroIndex
                      if (!item.image) return null
                      return (
                        <Image
                          key={item.id}
                          imageUrl={item.image}
                          resizable={true}
                          scaleToFill={true}
                          frame={{ maxWidth: "infinity", height: 260 }}
                          blur={60}
                          opacity={isCurrent ? 0.35 : 0}
                          animation={{ animation: Animation.smooth({ duration: 0.55 }), value: isCurrent }}
                        />
                      )
                    })}
                  </ZStack>
                }
              >
                {/* 輪播主體：高度 207（封面 179 + 上下緩衝各 14），讓半徑 10 的立體陰影在 TabView 內自然淡出不被裁切 */}
                <TabView
                  tabViewStyle="pageNeverDisplayIndex"
                  tabIndex={heroIndex}
                  onTabIndexChanged={setHeroIndex}
                  frame={{ height: 207 }}
                  animation={{ animation: Animation.smooth({ duration: 0.45 }), value: heroIndex }}
                >
                  {heroItems.map((item, index) => (
                    <NavigationLink
                      key={item.id}
                      tag={index}
                      destination={
                        <BangumiDetailScreen
                          subject={item}
                          zoomTransition={{ sourceID: `hero:${item.id}`, namespace: homeNs }}
                        />
                      }
                      buttonStyle="plain"
                    >
                      {/* TabView 翻頁要固定高度：字級夹在 xxxLarge，輔助字級下右欄不被裁。 */}
                      <HStack
                        spacing={15}
                        alignment="center"
                        frame={{ maxWidth: "infinity", height: 207 }}
                        padding={{ horizontal: 16, vertical: 14 }}
                        dynamicTypeSize={{ to: "xxxLarge" }}
                      >
                        {/* 封面立體卡片：124×179（＝詳情頁 hero 的上限寬 `HERO_MAX_WIDTH`、同一組 1.44 比例）。
                            舊值 106×150 比下面那排卡片（112×161）還小，四周又留白 → 看起來很迷你。
                            179 加上卡片上下內距 8×2 剛好填滿 195 的輪播條，版面高度不變。 */}
                        {item.image ? (
                          <ZStack
                            frame={{ width: 124, height: 179 }}
                            matchedTransitionSource={{ id: `hero:${item.id}`, namespace: homeNs }}
                          >
                            <Image
                              imageUrl={item.image}
                              resizable={true}
                              scaleToFill={true}
                              frame={{ width: 124, height: 179 }}
                              clipShape={rect(radius.md)}
                              shadow={coverShadow}
                              overlay={
                                <RoundedRectangle
                                  cornerRadius={radius.md}
                                  stroke={coverStroke}
                                />
                              }
                            />
                          </ZStack>
                        ) : (
                          <ZStack
                            frame={{ width: 124, height: 179 }}
                            shadow={coverShadow}
                            matchedTransitionSource={{ id: `hero:${item.id}`, namespace: homeNs }}
                          >
                            <CoverPlaceholder
                              title={item.name_cn || item.name}
                              width={124}
                              height={179}
                              cornerRadius={radius.md}
                            />
                          </ZStack>
                        )}

                        {/* 右側資訊區 */}
                        <VStack
                          alignment="leading"
                          spacing={6}
                          frame={{ maxWidth: "infinity" }}
                        >
                          {/* 評分與榜單徽章 */}
                          <HStack spacing={6} alignment="center">
                            {item.rank && item.rank > 0 ? (
                              <HStack
                                spacing={3}
                                padding={{ horizontal: 6, vertical: 2 }}
                                background={tint.tint}
                                clipShape={rect(radius.sm)}
                              >
                                <Text font="caption2" fontWeight="heavy" foregroundStyle={tint.onTint}>
                                  TOP {item.rank}
                                </Text>
                              </HStack>
                            ) : null}

                            {item.score && item.score > 0 ? (
                              <Tag icon="star.fill" tone="warning" text={item.score.toFixed(1)} />
                            ) : null}
                          </HStack>

                          {/* 大標題（2 行上限，不遮擋）
                              用 title3 而不是 headline：它是這一頁最大的一本書，
                              不該比「繼續閱讀／熱門新作」那些區塊標題（同為 title3）還小。
                              字色吃系統語意色：hero 背後的模糊封面只有 0.35，淺色主題時白字讀不到。 */}
                          <Text
                            font="title3"
                            fontWeight="bold"
                            foregroundStyle="label"
                            lineLimit={2}
                          >
                            {item.name_cn || item.name}
                          </Text>

                          {/* 標籤 · 作者 */}
                          <HStack spacing={4} alignment="center">
                            {item.tags && item.tags.length > 0 ? (
                              <Text font="caption2" fontWeight="medium" foregroundStyle="secondaryLabel">
                                {item.tags.slice(0, 2).join(" · ")}
                              </Text>
                            ) : null}
                            {item.author ? (
                              <>
                                <Text font="caption2" foregroundStyle="tertiaryLabel">
                                  ·
                                </Text>
                                <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                                  {item.author}
                                </Text>
                              </>
                            ) : null}
                          </HStack>

                          {/* 簡介預覽（2 行精華） */}
                          {item.summary ? (
                            <Text
                              font="caption2"
                              foregroundStyle="secondaryLabel"
                              lineLimit={2}
                              padding={{ top: 1 }}
                            >
                              {item.summary.trim()}
                            </Text>
                          ) : null}
                        </VStack>
                      </HStack>
                    </NavigationLink>
                  ))}
                </TabView>

                {/* 置中 Liquid Glass 分裂式分頁指示點 */}
                {heroItems.length > 1 ? (
                  <HStack frame={{ maxWidth: "infinity" }}>
                    <Spacer />
                    <GlassDots>
                      <ZStack alignment="leading" frame={{ width: (heroItems.length - 1) * 16 + 6, height: 16 }}>
                        {/* 靜態各圓點底座（極輕灰玻璃，去除厚重折射霧感） */}
                        <HStack spacing={10} alignment="center" frame={{ height: 16 }}>
                          {heroItems.map((_, i) => (
                            <VStack
                              key={i}
                              frame={{ width: 6, height: 6 }}
                              {...glass({ tint: fill.glassNeutral, shape: capsule("circular") })}
                            />
                          ))}
                        </HStack>

                        {/* 活躍藍色液態水滴（翻頁時物理拉絲扯斷，抵達時融入目標點） */}
                        <VStack
                          frame={{ width: 6, height: 6 }}
                          {...glass({ tint: tintColor, shape: capsule("circular") })}
                          offset={{ x: heroIndex * 16, y: 0 }}
                          animation={{ animation: Animation.spring({ duration: 0.52, bounce: 0.15 }), value: heroIndex }}
                        />
                      </ZStack>
                    </GlassDots>
                    <Spacer />
                  </HStack>
                ) : null}
              </VStack>
            )}
            {heroItems.length === 0 && loadingFeed ? <HeroSkeleton /> : null}

            {/* 1. 繼續閱讀區塊（若有進度才展示，保留一鍵接續） */}
            {progress.length > 0 ? (
              <VStack spacing={4}>
                <HStack padding={{ horizontal: 16 }}>
                  <Text font="title3" fontWeight="bold">
                    {t("home.resumeTitle")}
                  </Text>
                  <Spacer />
                </HStack>

                <ScrollView axes="horizontal" scrollIndicator="hidden" background={carouselWidthProbe(setResumeCarouselWidth)}>
                  <LazyHStack spacing={12} padding={{ horizontal: 16, vertical: 8 }}>
                    {progress.slice(0, 10).map(entry => (
                      <ResumeCard key={`${entry.sourceKey}:${entry.comicId}`} entry={entry} size={resumeCard} />
                    ))}
                  </LazyHStack>
                </ScrollView>
              </VStack>
            ) : null}

            {/* 2. 🔥 近半年才開新連載的熱門新作 */}
            <VStack spacing={4}>
              <HStack padding={{ horizontal: 16 }}>
                <Text font="title3" fontWeight="bold">
                  {t("home.trendingTitle")}
                </Text>
                <Spacer />
              </HStack>

              {trending.length > 0 ? (
                <ScrollView axes="horizontal" scrollIndicator="hidden" background={carouselWidthProbe(setBangumiCarouselWidth)}>
                  <LazyHStack spacing={12} padding={{ horizontal: 16, vertical: 8 }}>
                    {trending.map(item => (
                      <BangumiCard
                        key={item.id}
                        subject={item}
                        size={bangumiCard}
                        namespace={homeNs}
                      />
                    ))}
                  </LazyHStack>
                </ScrollView>
              ) : loadingFeed ? (
                <RowSkeleton size={bangumiCard} onWidth={setBangumiCarouselWidth} />
              ) : (
                <FeedEmptyPlaceholder />
              )}
            </VStack>

            {/* 3. 👀 大家在追（近期在讀人數最多的連載） */}
            <VStack spacing={4}>
              <HStack padding={{ horizontal: 16 }}>
                <Text font="title3" fontWeight="bold">
                  {t("home.followingTitle")}
                </Text>
                <Spacer />
              </HStack>

              {following.length > 0 ? (
                <ScrollView axes="horizontal" scrollIndicator="hidden" background={carouselWidthProbe(setBangumiCarouselWidth)}>
                  <LazyHStack spacing={12} padding={{ horizontal: 16, vertical: 8 }}>
                    {following.map(item => (
                      <BangumiCard
                        key={item.id}
                        subject={item}
                        size={bangumiCard}
                        namespace={homeNs}
                      />
                    ))}
                  </LazyHStack>
                </ScrollView>
              ) : loadingFeed ? (
                <RowSkeleton size={bangumiCard} onWidth={setBangumiCarouselWidth} />
              ) : (
                <FeedEmptyPlaceholder />
              )}
            </VStack>

            {/* 4. 🏆 Bangumi TOP 100 */}
            <VStack spacing={4}>
              <HStack padding={{ horizontal: 16 }}>
                <Text font="title3" fontWeight="bold">
                  Bangumi TOP 100
                </Text>
                <Spacer />
              </HStack>

              {topRank.length > 0 ? (
                <ScrollView axes="horizontal" scrollIndicator="hidden" background={carouselWidthProbe(setBangumiCarouselWidth)}>
                  <LazyHStack spacing={12} padding={{ horizontal: 16, vertical: 8 }}>
                    {topRank.map(item => (
                      <BangumiCard
                        key={item.id}
                        subject={item}
                        size={bangumiCard}
                        showRank={true}
                        namespace={homeNs}
                      />
                    ))}
                  </LazyHStack>
                </ScrollView>
              ) : loadingFeed ? (
                <RowSkeleton size={bangumiCard} onWidth={setBangumiCarouselWidth} />
              ) : (
                <FeedEmptyPlaceholder />
              )}
            </VStack>

          </VStack>
        </ScrollView>
      </VStack>
    </ZStack>
      )}
    </NamespaceReader>
  )
}

/** 格式化話數徽章文案：只保留話數（如：第2話、第03話），不帶頁數，乾淨精巧 */
function formatEpisodeBadge(epTitle?: string): string {
  if (!epTitle) return t("home.lastRead")
  
  // 萃取核心話數（例如「第 2 话 兄与弟」->「第2话」或「第00话 · 第 34 頁」->「第00话」）
  // 這個字元集是**解析章節名的規則**（來源給的資料），不是文案。
  const match = epTitle.trim().match(/^(第\s*[\d.]+\s*[話话回卷集章期]|[\d.]+\s*[話话回卷集章期])/i)
  return match ? match[1].replace(/\s+/g, "") : epTitle.trim()
}

/** 繼續閱讀卡片：包含封面、進度話數磨砂標籤、雙行對齊標題 */
function ResumeCard({ entry, size }: { entry: Progress; size: CardSize }) {
  const shown = resumeEntry(entry)
  // 來源那一行：離線的紀錄在源名前面標「離線」；源被移除但還有離線內容時就只剩「離線」。
  const sourceLabel = [
    shown.offline ? t("common.offlineTag") : null,
    shown.sourceName ?? (shown.source === "offlineOnly" ? null : t("home.sourceRemoved")),
  ]
    .filter(Boolean)
    .join(" · ")
  const { width, height } = size
  const episodeText = shown.openable ? formatEpisodeBadge(entry.epTitle) : t("home.sourceInvalid")
  // page 是 0 起算的領先可見頁；舊紀錄沒有頁數就沒有這條線（統一門檻在 app/shelf.ts）。
  const fraction = shown.readFraction ?? null
  const [opening, setOpening] = useState(false)

  const card = (
    <VStack alignment="leading" spacing={6} frame={{ width }}>
      {/* 封面 + 懸浮閱讀話數標籤 */}
      <ZStack
        alignment="bottomTrailing"
        frame={{ width, height }}
      >
        {shown.source === "present" ? (
          <CoverImage
            sourceKey={entry.sourceKey}
            url={entry.cover}
            width={width}
            height={height}
            cornerRadius={radius.md}
            title={entry.title}
            lifted={true}
          />
        ) : (
          <ZStack shadow={coverShadow}>
            <CoverPlaceholder title={entry.title} width={width} height={height} cornerRadius={radius.md} />
          </ZStack>
        )}

        {/* 原位 In-place 微載入指示層（封面暗化 + 微轉圈） */}
        {opening ? (
          <ZStack
            frame={{ width, height }}
            background={fill.coverScrim}
            clipShape={rect(radius.md)}
            alignment="center"
          >
            <ProgressView controlSize="small" />
          </ZStack>
        ) : null}

        {/* 進度標籤：固定靠右下角，純話數精巧膠囊（源給的長標題才夾寬） */}
        <HStack offset={{ x: -6, y: -6 }}>
          <CoverBadge text={episodeText} maxWidth={episodeText.length > 12 ? width - 12 : undefined} />
        </HStack>
      </ZStack>

      {/* 沒頁數也佔位（透明），同一排卡片等高。 */}
      <ProgressView
        value={fraction ?? 0}
        progressViewStyle="linear"
        frame={{ width }}
        opacity={fraction !== null ? 1 : 0}
      />

      {/* 單行俐落書名（超長自動截斷） */}
      <Text
        font="caption"
        fontWeight="medium"
        foregroundStyle="label"
        lineLimit={1}
        multilineTextAlignment="leading"
        frame={{ width, alignment: "leading" }}
      >
        {entry.title}
      </Text>

      {/* 來源名稱（離線的紀錄前面多一個「離線」） */}
      <Text
        font="caption2"
        foregroundStyle="tertiaryLabel"
        lineLimit={1}
        frame={{ width, alignment: "leading" }}
      >
        {sourceLabel}
      </Text>
    </VStack>
  )

  // 源沒了、也沒有離線內容就進不去（封面也要源才解析得出來）；標籤那顆膠囊改成「源失效」。
  if (!shown.openable) return card

  return (
    <Button
      buttonStyle="plain"
      disabled={opening}
      action={() => {
        setOpening(true)
        void launchResumeReader({ sourceKey: entry.sourceKey, comicId: entry.comicId }).finally(() => {
          setOpening(false)
        })
      }}
    >
      {card}
    </Button>
  )
}

/** Bangumi 漫畫推薦卡片 */
function BangumiCard({
  subject,
  size,
  showRank = false,
  namespace,
}: {
  subject: BangumiSubject
  size: CardSize
  showRank?: boolean
  namespace?: NamespaceID
}) {
  const title = subject.name_cn || subject.name
  const { width, height } = size
  const sourceID = `bgm:${subject.id}`

  return (
    <NavigationLink
      destination={
        <BangumiDetailScreen
          subject={subject}
          zoomTransition={namespace ? { sourceID, namespace } : undefined}
        />
      }
      buttonStyle="plain"
    >
      <VStack
        alignment="leading"
        spacing={6}
        frame={{ width }}
      >
        {/* 封面與評分標籤 */}
        <ZStack
          alignment="bottomTrailing"
          frame={{ width, height }}
          matchedTransitionSource={namespace ? { id: sourceID, namespace } : undefined}
        >
          {subject.image ? (
            <Image
              imageUrl={subject.image}
              resizable={true}
              scaleToFill={true}
              frame={{ width, height }}
              clipShape={rect(radius.md)}
              shadow={coverShadow}
              overlay={
                <RoundedRectangle
                  cornerRadius={radius.md}
                  stroke={coverStroke}
                />
              }
            />
          ) : (
            <ZStack shadow={coverShadow}>
              <CoverPlaceholder title={title} width={width} height={height} cornerRadius={radius.md} />
            </ZStack>
          )}

          {/* 排名或評分角標（圖上的短角標一律 CoverBadge）；
              fixedSize 讓它抱內容寬，不然 ZStack 會把它拉成整張封面寬、角標就跑到中左。 */}
          <HStack offset={{ x: -6, y: -6 }} fixedSize={{ horizontal: true, vertical: false }}>
            {showRank && subject.rank && subject.rank > 0 ? (
              <CoverBadge text={`#${subject.rank}`} />
            ) : subject.score && subject.score > 0 ? (
              <CoverBadge icon="star.fill" text={subject.score.toFixed(1)} />
            ) : null}
          </HStack>
        </ZStack>

        {/* 單行俐落書名（超長自動截斷） */}
        <Text
          font="caption"
          fontWeight="medium"
          foregroundStyle="label"
          lineLimit={1}
          multilineTextAlignment="leading"
          frame={{ width, alignment: "leading" }}
        >
          {title}
        </Text>
      </VStack>
    </NavigationLink>
  )
}

// 載入中的骨架：尺寸跟載入後的版面一樣，資料來了畫面不會跳。文字用 redacted 畫成灰條，內容不會顯示。
const SKELETON_TEXT = "XXXXXXXXXXXX"

/** hero 輪播的骨架：同樣 207 高的主體＋16 高的分頁點那一列。 */
function HeroSkeleton() {
  return (
    <VStack spacing={8} frame={{ maxWidth: "infinity" }} accessibilityLabel={t("home.feedLoading")}>
      <HStack
        spacing={15}
        alignment="center"
        frame={{ maxWidth: "infinity", height: 207 }}
        padding={{ horizontal: 16, vertical: 14 }}
      >
        <VStack frame={{ width: 124, height: 179 }} background={fill.surface} clipShape={rect(radius.md)} />
        <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }} redacted="placeholder">
          <Text font="title3" fontWeight="bold" lineLimit={1}>{SKELETON_TEXT}</Text>
          <Text font="caption2" lineLimit={1}>{SKELETON_TEXT}</Text>
          <Text font="caption2" lineLimit={2}>{SKELETON_TEXT.repeat(4)}</Text>
        </VStack>
      </HStack>
      <HStack frame={{ height: 16 }} />
    </VStack>
  )
}

/** 橫向卡片排的骨架：跟真的卡片同尺寸，也替真的那排量寬。 */
function RowSkeleton({ size, onWidth }: { size: CardSize; onWidth: (width: number) => void }) {
  return (
    <ScrollView axes="horizontal" scrollDisabled={true} background={carouselWidthProbe(onWidth)}>
      <HStack spacing={12} padding={{ horizontal: 16, vertical: 8 }} accessibilityLabel={t("home.feedLoading")}>
        {[0, 1, 2, 3].map(index => (
          <VStack key={index} alignment="leading" spacing={6} frame={{ width: size.width }}>
            <VStack frame={{ width: size.width, height: size.height }} background={fill.surface} clipShape={rect(radius.md)} />
            <Text font="caption" fontWeight="medium" lineLimit={1} redacted="placeholder">
              {SKELETON_TEXT}
            </Text>
          </VStack>
        ))}
      </HStack>
    </ScrollView>
  )
}

function FeedEmptyPlaceholder() {
  return (
    <EmptyState
      icon="wifi.exclamationmark"
      title={t("home.feedErrorTitle")}
      detail={t("home.feedErrorDetail")}
    />
  )
}
