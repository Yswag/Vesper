import { Button, Divider, GeometryReader, GlassEffectContainer, HStack, Image, LazyHStack, NamespaceReader, NavigationLink, ProgressView, RoundedRectangle, ScrollView, Spacer, TabView, Text, VStack, ZStack, useEffect, useState, type Color, type VirtualNode } from "scripting"

import { CoverImage, CoverPlaceholder } from "../../components/CoverImage"
import { CoverBadge } from "../../design/CoverBadge"
import { CoverShadow } from "../../design/CoverShadow"
import { glass, liquidGlass, scrollTopBar } from "../../design/glass"
import { Tag } from "../../design/Tag"
import { WidthReporter } from "../../components/WidthReporter"
import { ExitToolbar } from "../../components/ExitToolbar"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { comicLibrary } from "../../app/services"
import { resumeEntry } from "../../app/shelf"
import { EmptyState } from "../../design/status"
import { SkeletonBlock, SkeletonCardRow, SkeletonText } from "../../design/skeleton"
import { capsule, coverStroke, fill, radius, rect } from "../../design/tokens"
import { clearProgress, listProgress, type Progress } from "../../library/bookshelf"
import { bangumiCardSize, resumeCardSize, type CardSize } from "../shared/comicMetrics"
import { launchResumeReader } from "../shared/ResumeReaderScreen"
import { canOpenComicDetail, progressDetailDestination, ProgressMenuItems } from "../shared/progressActions"
import { PageBackground, useResolvedColorScheme, useTint } from "../../app/theme"
import { getBangumiHomeFeed, type BangumiSubject } from "../../engine/bangumi"
import { BangumiDetailScreen } from "./BangumiDetailScreen"
import { HistoryScreen } from "./HistoryScreen"

function carouselWidthProbe(onWidth: (width: number) => void) {
  return (
    <GeometryReader>
      {geometry => <WidthReporter width={geometry.size.width} onWidth={width => onWidth(Math.round(width))} />}
    </GeometryReader>
  )
}

function GlassDots({ children }: { children: VirtualNode }) {
  return liquidGlass ? <GlassEffectContainer spacing={6}>{children}</GlassEffectContainer> : children
}

export function HomeScreen() {
  const [topRank, setTopRank] = useState<BangumiSubject[]>([])
  const [trending, setTrending] = useState<BangumiSubject[]>([])
  const [following, setFollowing] = useState<BangumiSubject[]>([])
  const [loadingFeed, setLoadingFeed] = useState(true)
  const [popularPool, setPopularPool] = useState<BangumiSubject[]>([])
  const [heroItems, setHeroItems] = useState<BangumiSubject[]>([])

  const [detailOf, setDetailOf] = useState<Progress | null>(null)

  const [resumeCarouselWidth, setResumeCarouselWidth] = useState(0)
  const [bangumiCarouselWidth, setBangumiCarouselWidth] = useState(0)
  const resumeCard = bangumiCardSize(resumeCarouselWidth)
  const bangumiCard = bangumiCardSize(bangumiCarouselWidth)

  function pickHeroItems(pool: BangumiSubject[], fallbackRank: BangumiSubject[]) {
    const source = pool.length >= 8 ? pool : fallbackRank
    if (source.length >= 8) {
      const shuffled = [...source].sort(() => Math.random() - 0.5)
      setHeroItems(shuffled.slice(0, 8))
    }
  }

  async function loadFeed(force: boolean) {
    const feed = await getBangumiHomeFeed(force)
    setTopRank(feed.topRank)
    setTrending(feed.trending)
    setFollowing(feed.following)
    setPopularPool(feed.popularPool)
    
    pickHeroItems(feed.popularPool, feed.topRank)
  }

  const refresh = useSubscription(comicLibrary().onChange, subscribeLocale)

  useEffect(() => {
    refresh()

    void loadFeed(false).finally(() => setLoadingFeed(false))
  }, [])

  const progress = listProgress()

  return (
    <NamespaceReader>
      {homeNs => (
        <ZStack onAppear={refresh}>
          <PageBackground />
      <VStack
        spacing={0}
        navigationTitle={t("home.title")}
        navigationBarTitleDisplayMode="inline"
        toolbar={{ topBarLeading: <ExitToolbar /> }}
      >
        <ScrollView
          scrollContentBackground="hidden"
          {...scrollTopBar(null)}
          navigationDestination={progressDetailDestination({ entry: detailOf, onDismiss: () => setDetailOf(null) })}
          refreshable={async () => {
            refresh()
            await loadFeed(true)
          }}
        >
          <VStack spacing={24} padding={{ bottom: 44 }}>

            {}
            {heroItems.length > 0 ? <HeroCarousel items={heroItems} namespace={homeNs} /> : null}
            {heroItems.length === 0 && loadingFeed ? <HeroSkeleton /> : null}

            {}
            {progress.length > 0 ? (
              <VStack spacing={4}>
                <NavigationLink destination={<HistoryScreen />} buttonStyle="plain">
                  <HStack spacing={4} alignment="center" padding={{ horizontal: 16 }} contentShape="rect">
                    <Text font="title3" fontWeight="bold" foregroundStyle="label">
                      {t("home.resumeTitle")}
                    </Text>
                    <Spacer />
                    <Image systemName="chevron.right" font="headline" fontWeight="bold" foregroundStyle="tertiaryLabel" />
                  </HStack>
                </NavigationLink>

                <ScrollView axes="horizontal" scrollIndicator="hidden" background={carouselWidthProbe(setResumeCarouselWidth)}>
                  <LazyHStack spacing={12} padding={{ horizontal: 16, vertical: 8 }}>
                    {progress.slice(0, 10).map(entry => (
                      <ResumeCard
                        key={`${entry.sourceKey}:${entry.comicId}`}
                        entry={entry}
                        size={resumeCard}
                        onDelete={() => clearProgress(entry.sourceKey, entry.comicId)}
                        onOpenDetail={() => setDetailOf(entry)}
                      />
                    ))}
                  </LazyHStack>
                </ScrollView>
              </VStack>
            ) : null}

            {}
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

            {}
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

            {}
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

function HeroCarousel({ items, namespace }: { items: BangumiSubject[]; namespace: NamespaceID }) {
  const tint = useTint()
  const tintColor = String(tint.tint[useResolvedColorScheme()]) as Color
  const [index, setIndex] = useState(0)
  const [active, setActive] = useState(true)

  useEffect(() => {
    setIndex(0)
  }, [items])

  useEffect(() => {
    if (!active || items.length <= 1) return

    const timer = setTimeout(() => {
      setIndex(prev => (prev + 1) % items.length)
    }, 4000)

    return () => {
      if (timer !== null) {
        clearTimeout(timer)
      }
    }
  }, [index, items.length, active])

  return (
    <VStack
      spacing={8}
      frame={{ maxWidth: "infinity" }}
      onAppear={() => setActive(true)}
      onDisappear={() => setActive(false)}
      background={
        <ZStack alignment="top" frame={{ maxWidth: "infinity" }}>
          {items.map((item, idx) => {
            const isCurrent = idx === index
            if (!item.image) return null
            if (Math.min(Math.abs(idx - index), items.length - Math.abs(idx - index)) > 1) return null
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
      {}
      <TabView
        tabViewStyle="pageNeverDisplayIndex"
        tabIndex={index}
        onTabIndexChanged={setIndex}
        frame={{ height: 207 }}
        animation={{ animation: Animation.smooth({ duration: 0.45 }), value: index }}
      >
        {items.map((item, itemIndex) => (
          <NavigationLink
            key={item.id}
            tag={itemIndex}
            destination={
              <BangumiDetailScreen
                subject={item}
                zoomTransition={{ sourceID: `hero:${item.id}`, namespace }}
              />
            }
            buttonStyle="plain"
          >
            {}
            <HStack
              spacing={15}
              alignment="center"
              frame={{ maxWidth: "infinity", height: 207 }}
              padding={{ horizontal: 16, vertical: 14 }}
              dynamicTypeSize={{ to: "xxxLarge" }}
            >
              {}
              {item.image ? (
                <ZStack
                  frame={{ width: 124, height: 179 }}
                  matchedTransitionSource={{ id: `hero:${item.id}`, namespace }}
                >
                  <CoverShadow>
                    <Image
                      imageUrl={item.image}
                      resizable={true}
                      scaleToFill={true}
                      frame={{ width: 124, height: 179 }}
                      clipShape={rect(radius.md)}
                      overlay={
                        <RoundedRectangle
                          cornerRadius={radius.md}
                          stroke={coverStroke}
                        />
                      }
                    />
                  </CoverShadow>
                </ZStack>
              ) : (
                <ZStack
                  frame={{ width: 124, height: 179 }}
                  matchedTransitionSource={{ id: `hero:${item.id}`, namespace }}
                >
                  <CoverShadow>
                    <CoverPlaceholder
                      title={item.name_cn || item.name}
                      width={124}
                      height={179}
                      cornerRadius={radius.md}
                    />
                  </CoverShadow>
                </ZStack>
              )}

              {}
              <VStack
                alignment="leading"
                spacing={6}
                frame={{ maxWidth: "infinity" }}
              >
                {}
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

                {}
                <Text
                  font="title3"
                  fontWeight="bold"
                  foregroundStyle="label"
                  lineLimit={2}
                >
                  {item.name_cn || item.name}
                </Text>

                {}
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

                {}
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

      {}
      {items.length > 1 ? (
        <HStack frame={{ maxWidth: "infinity" }}>
          <Spacer />
          <GlassDots>
            <ZStack alignment="leading" frame={{ width: (items.length - 1) * 16 + 6, height: 16 }}>
              {}
              <HStack spacing={10} alignment="center" frame={{ height: 16 }}>
                {items.map((_, i) => (
                  <VStack
                    key={i}
                    frame={{ width: 6, height: 6 }}
                    {...glass({ tint: fill.glassNeutral, shape: capsule("circular") })}
                  />
                ))}
              </HStack>

              {}
              <VStack
                frame={{ width: 6, height: 6 }}
                {...glass({ tint: tintColor, shape: capsule("circular") })}
                offset={{ x: index * 16, y: 0 }}
                animation={{ animation: Animation.spring({ duration: 0.52, bounce: 0.15 }), value: index }}
              />
            </ZStack>
          </GlassDots>
          <Spacer />
        </HStack>
      ) : null}
    </VStack>
  )
}

function formatEpisodeBadge(epTitle?: string): string {
  if (!epTitle) return t("home.lastRead")
  
  const match = epTitle.trim().match(/^(第\s*[\d.]+\s*[話话回卷集章期]|[\d.]+\s*[話话回卷集章期])/i)
  return match ? match[1].replace(/\s+/g, "") : epTitle.trim()
}

function ResumeCard({
  entry,
  size,
  onDelete,
  onOpenDetail,
}: {
  entry: Progress
  size: CardSize
  onDelete?: () => void
  onOpenDetail?: () => void
}) {
  const shown = resumeEntry(entry)
  const sourceLabel = [
    shown.offline ? t("common.offlineTag") : null,
    shown.sourceName ?? (shown.source === "offlineOnly" ? null : t("home.sourceRemoved")),
  ]
    .filter(Boolean)
    .join(" · ")
  const { width, height } = size
  const episodeText = shown.openable ? formatEpisodeBadge(entry.epTitle) : t("home.sourceInvalid")
  const fraction = shown.readFraction ?? null
  const [opening, setOpening] = useState(false)

  const card = (
    <VStack alignment="leading" spacing={6} frame={{ width }}>
      {}
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
          <CoverShadow>
            <CoverPlaceholder title={entry.title} width={width} height={height} cornerRadius={radius.md} />
          </CoverShadow>
        )}

        {}
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

        {}
        <HStack offset={{ x: -6, y: -6 }}>
          <CoverBadge text={episodeText} maxWidth={episodeText.length > 12 ? width - 12 : undefined} />
        </HStack>
      </ZStack>

      {}
      <ProgressView
        value={fraction ?? 0}
        progressViewStyle="linear"
        frame={{ width }}
        opacity={fraction !== null ? 1 : 0}
      />

      {}
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

      {}
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

  const body = shown.openable ? (
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
  ) : card

  const canOpenDetail = onOpenDetail !== undefined && canOpenComicDetail(shown)
  if (!onDelete && !canOpenDetail) return body

  return (
    <VStack
      spacing={0}
      contextMenu={{
        menuItems: <ProgressMenuItems onOpenDetail={canOpenDetail ? onOpenDetail : undefined} onDelete={onDelete} />,
      }}
    >
      {body}
    </VStack>
  )
}

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
        {}
        <ZStack
          alignment="bottomTrailing"
          frame={{ width, height }}
          matchedTransitionSource={namespace ? { id: sourceID, namespace } : undefined}
        >
          {subject.image ? (
            <CoverShadow>
              <Image
                imageUrl={subject.image}
                resizable={true}
                scaleToFill={true}
                frame={{ width, height }}
                clipShape={rect(radius.md)}
                overlay={
                  <RoundedRectangle
                    cornerRadius={radius.md}
                    stroke={coverStroke}
                  />
                }
              />
            </CoverShadow>
          ) : (
            <CoverShadow>
              <CoverPlaceholder title={title} width={width} height={height} cornerRadius={radius.md} />
            </CoverShadow>
          )}

          {}
          <HStack offset={{ x: -6, y: -6 }} fixedSize={{ horizontal: true, vertical: false }}>
            {showRank && subject.rank && subject.rank > 0 ? (
              <CoverBadge text={`#${subject.rank}`} />
            ) : subject.score && subject.score > 0 ? (
              <CoverBadge icon="star.fill" text={subject.score.toFixed(1)} />
            ) : null}
          </HStack>
        </ZStack>

        {}
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

function HeroSkeleton() {
  return (
    <VStack spacing={8} frame={{ maxWidth: "infinity" }} accessibilityLabel={t("home.feedLoading")}>
      <HStack
        spacing={15}
        alignment="center"
        frame={{ maxWidth: "infinity", height: 207 }}
        padding={{ horizontal: 16, vertical: 14 }}
      >
        <SkeletonBlock width={124} height={179} />
        <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <HStack spacing={6}>
            <SkeletonBlock width={38} height={21} shape="capsule" />
            <SkeletonBlock width={46} height={21} shape="capsule" />
          </HStack>
          <SkeletonText font="title3" fontWeight="bold" lineLimit={2} length={6} />
          <SkeletonText font="caption2" length={4} />
          <SkeletonText font="caption2" lineLimit={2} length={14} />
        </VStack>
      </HStack>
      <HStack frame={{ height: 16 }} />
    </VStack>
  )
}

function RowSkeleton({ size, onWidth }: { size: CardSize; onWidth: (width: number) => void }) {
  return (
    <VStack frame={{ maxWidth: "infinity" }} background={carouselWidthProbe(onWidth)}>
      <SkeletonCardRow size={size} accessibilityLabel={t("home.feedLoading")} />
    </VStack>
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
