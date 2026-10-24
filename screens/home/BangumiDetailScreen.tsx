// Bangumi 條目作品詳情頁面
// 提供與漫畫詳情一致的全螢幕導航體驗：高畫質封面、評分徽章、詳細簡介，
// 以及即時跨已啟用漫畫源搜尋並聚合可閱讀章節。

import {
  Button,
  Divider,
  GeometryReader,
  HStack,
  Image,
  LazyHStack,
  NavigationLink,
  ProgressView,
  RoundedRectangle,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
  useEffect,
  useState,
} from "scripting"

import { type BangumiSubject } from "../../engine/bangumi"
import { matchComicTitleScore } from "../../engine/titleMatch"
import { type ComicSourceInfo } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { type SourceSearchResult } from "../../sources/search"
import { defaultSearchValues, encodeSearchOptions } from "../../sources/searchOptions"
import { bangumiSourceCardSize, heroCoverSize } from "../shared/comicMetrics"
import { ComicDetailScreen } from "../shared/ComicDetailScreen"
import { CoverImage } from "../../components/CoverImage"
import { WidthReporter } from "../../components/WidthReporter"
import { GlassBadge } from "../../design/GlassBadge"
import { EmptyState } from "../../design/status"
import { badgePadding, capsule, fill, hairlineStroke, pageInsets, pageSpacing, palette, radius, rect, tagPadding } from "../../design/tokens"
import { PageBackground, useTint } from "../../app/theme"
import { navigateToSearch } from "../../app/navigation"

interface BangumiDetailScreenProps {
  subject: BangumiSubject
  zoomTransition?: {
    sourceID: string | number
    namespace: NamespaceID
  }
}

export function BangumiDetailScreen({ subject, zoomTransition }: BangumiDetailScreenProps) {
  const library = comicLibrary()
  const tint = useTint()
  const [sources, setSources] = useState<ComicSourceInfo[]>([])
  const [searchResults, setSearchResults] = useState<SourceSearchResult[]>([])
  const [searching, setSearching] = useState(true)
  const [searchProgress, setSearchProgress] = useState({ done: 0, total: 0 })
  const [descExpanded, setDescExpanded] = useState(false)
  const [showNavTitle, setShowNavTitle] = useState(false)
  // hero 與「可用漫畫來源」carousel 的尺寸都依量到的容器寬算（不看 Device.screen）。
  const [heroContainerWidth, setHeroContainerWidth] = useState(0)
  const [sourceCarouselWidth, setSourceCarouselWidth] = useState(0)

  // 語言一換，這一頁的字要立刻跟著變。
  useSubscription(subscribeLocale)

  const title = subject.name_cn || subject.name
  const searchKeyword = subject.name_cn || subject.name

  useEffect(() => {
    const list = library.sources()
    setSources(list)
    if (list.length === 0) {
      setSearching(false)
      return
    }

    setSearchProgress({ done: 0, total: list.length })
    let alive = true

    // 跨已啟用源搜尋，帶每個源宣告的預設篩選值（使用者沒改過）。
    void library.search(
      {
        keyword: searchKeyword,
        optionsOf: key => {
          const info = library.source(key)
          return info ? encodeSearchOptions(info.searchOptions, defaultSearchValues(info.searchOptions)) : []
        },
      },
      snapshot => {
        if (!alive) return
        setSearchResults(snapshot.results)
        setSearchProgress({ done: snapshot.done, total: snapshot.total })
      }
    ).finally(() => {
      if (alive) setSearching(false)
    })

    return () => {
      alive = false
    }
  }, [searchKeyword])

  // 整理有搜尋到該作品的源列表，並根據標題相關度評分過濾與排序
  const candidateList: { source: ComicSourceInfo; comic: any; score: number }[] = []
  for (const res of searchResults) {
    if (res.comics.length === 0) continue
    const source = sources.find(s => s.key === res.key)
    if (!source) continue
    for (const comic of res.comics) {
      const score = matchComicTitleScore(comic.title || "", subject.name_cn || "", subject.name || "")
      // 閾值過濾：只保留高相關度結果（>= 55 分，排除完全沾邊/湊熱鬧的無關漫畫）
      if (score >= 55) {
        candidateList.push({ source, comic, score })
      }
    }
  }

  // 照匹配度高低排序（最精確的排前面）
  candidateList.sort((a, b) => b.score - a.score)
  const matchedSources = candidateList.map(item => ({ source: item.source, comic: item.comic }))

  const hero = heroCoverSize(heroContainerWidth)
  const sourceCard = bangumiSourceCardSize(sourceCarouselWidth)

  const cleanSummary = (subject.summary || "").trim()
  const isLongSummary = cleanSummary.length > 60 || cleanSummary.split("\n").length > 2
  // 氛圍圖的網址先抓成本地常數：在下面的 callback 裡 subject.image 的窄化會失效。
  const ambientUrl = subject.image

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
    >
      <PageBackground />

      {/* 頂部封面 Ambient Glow 氛圍漫射光暈（寬一定要量：`maxWidth: "infinity"` 會讓橫式封面
          用自己的寬高比當理想寬度，變成整頁寬度把版面推歪。見 dev/probe-cover-overflow.tsx）。 */}
      {ambientUrl ? (
        <GeometryReader>
          {geometry => (
            <VStack
              frame={{ width: geometry.size.width, height: 380, alignment: "top" }}
              offset={{ x: 0, y: -60 }}
              allowsHitTesting={false}
            >
              <Image
                imageUrl={ambientUrl}
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
        navigationTitle={showNavTitle ? title : ""}
        navigationBarTitleDisplayMode="inline"
      >
        <ScrollView
          scrollContentBackground="hidden"
          frame={{ maxWidth: "infinity" }}
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
            {/* 1. Hero 頂部海報與元資訊 */}
            <HStack
              key="hero-title"
              spacing={16}
              alignment="top"
              frame={{ maxWidth: "infinity" }}
            >
              {subject.image ? (
                <Image
                  imageUrl={subject.image}
                  resizable={true}
                  scaleToFill={true}
                  frame={{ width: hero.width, height: hero.height }}
                  clipShape={rect(radius.md)}
                  shadow={{ color: "rgba(0, 0, 0, 0.45)", radius: 14, x: 0, y: 6 }}
                />
              ) : (
                <VStack
                  frame={{ width: hero.width, height: hero.height }}
                  background={fill.surface}
                  clipShape={rect(radius.md)}
                  shadow={{ color: "rgba(0, 0, 0, 0.45)", radius: 14, x: 0, y: 6 }}
                />
              )}

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
                  {title}
                </Text>

                {subject.name && subject.name_cn && subject.name !== subject.name_cn ? (
                  <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={2}>
                    {t("home.bangumi.originalName", { name: subject.name })}
                  </Text>
                ) : null}

                {/* 評分與榜單徽章 */}
                <HStack spacing={6}>
                  {subject.score ? (
                    <HStack
                      spacing={4}
                      padding={badgePadding}
                      background={fill.score}
                      clipShape={capsule()}
                    >
                      <Image systemName="star.fill" font="caption2" foregroundStyle={palette.orange} />
                      <Text font="caption" fontWeight="bold" foregroundStyle={palette.orange}>
                        {subject.score.toFixed(1)}
                      </Text>
                    </HStack>
                  ) : null}

                  {subject.rank && subject.rank > 0 ? (
                    <HStack
                      spacing={3}
                      padding={badgePadding}
                      background={tint.rank}
                      clipShape={capsule()}
                    >
                      <Image systemName="trophy.fill" font="caption2" foregroundStyle={tint.tint} />
                      <Text font="caption" fontWeight="semibold" foregroundStyle={tint.tint}>
                        Top {subject.rank}
                      </Text>
                    </HStack>
                  ) : null}
                </HStack>

                {subject.author ? (
                  <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                    {t("home.bangumi.author", { author: subject.author })}
                  </Text>
                ) : null}

                {subject.date ? (
                  <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1}>
                    {t("home.bangumi.releaseDate", { date: subject.date })}
                  </Text>
                ) : null}
              </VStack>
            </HStack>

            {/* 2. 標籤群 */}
            {subject.tags.length > 0 ? (
              <ScrollView axes="horizontal" frame={{ maxWidth: "infinity" }}>
                <HStack spacing={8}>
                  {subject.tags.map((tag, i) => (
                    <HStack
                      key={`tag:${i}:${tag}`}
                      padding={tagPadding}
                      background="ultraThinMaterial"
                      clipShape={rect(radius.md)}
                      overlay={<RoundedRectangle cornerRadius={radius.md} stroke={hairlineStroke} />}
                    >
                      <Text font="caption" fontWeight="medium" foregroundStyle="secondaryLabel">
                        #{tag}
                      </Text>
                    </HStack>
                  ))}
                </HStack>
              </ScrollView>
            ) : null}

            {/* 3. 劇情簡介（長文本自然漸隱淡出，短文本完整清晰不模糊） */}
            {cleanSummary ? (
              <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <HStack>
                  <Text font="headline" fontWeight="bold">
                    {t("home.bangumi.summary")}
                  </Text>
                  <Spacer />
                  {isLongSummary ? (
                    <Button
                      buttonStyle="plain"
                      action={() => setDescExpanded(!descExpanded)}
                    >
                      <HStack spacing={2} alignment="center">
                        <Text font="caption2" foregroundStyle={tint.tint} fontWeight="medium">
                          {descExpanded ? t("home.bangumi.collapse") : t("home.bangumi.expand")}
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
                    !isLongSummary || descExpanded
                      ? "secondaryLabel"
                      : {
                          colors: ["secondaryLabel", "secondaryLabel", "rgba(142, 142, 147, 0.05)"],
                          startPoint: "top",
                          endPoint: "bottom",
                        }
                  }
                  lineLimit={!isLongSummary || descExpanded ? undefined : 3}
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                  multilineTextAlignment="leading"
                  onTapGesture={isLongSummary ? () => setDescExpanded(!descExpanded) : undefined}
                >
                  {cleanSummary}
                </Text>
              </VStack>
            ) : null}

            <Divider />

            {/* 4. 可閱讀漫畫來源列表 */}
            <VStack spacing={14} alignment="leading">
              <HStack>
                <Text font="title3" fontWeight="bold">
                  {t("home.bangumi.sourcesTitle")}
                </Text>
                {searching ? (
                  <HStack spacing={6} padding={{ leading: 8 }}>
                    <ProgressView />
                    <Text font="caption" foregroundStyle="tertiaryLabel">
                      ({searchProgress.done}/{searchProgress.total})
                    </Text>
                  </HStack>
                ) : (
                  <Text font="caption" foregroundStyle="tertiaryLabel" padding={{ leading: 6 }}>
                    ({matchedSources.length})
                  </Text>
                )}
                <Spacer />
                <Button
                  title={t("home.bangumi.manualSearch")}
                  font="caption"
                  action={() => navigateToSearch(searchKeyword)}
                />
              </HStack>

              {matchedSources.length > 0 ? (
                <ScrollView
                  axes="horizontal"
                  // 卡片都在橫向捲動列裡，量的是捲動視窗自己的寬（見 dev/probe-carousel-width.tsx）。
                  background={
                    <GeometryReader>
                      {geometry => (
                        <WidthReporter
                          width={geometry.size.width}
                          onWidth={width => setSourceCarouselWidth(Math.round(width))}
                        />
                      )}
                    </GeometryReader>
                  }
                >
                  <LazyHStack spacing={12} padding={{ vertical: 4 }}>
                    {matchedSources.map(({ source, comic }) => (
                      <NavigationLink
                        key={`${source.key}:${comic.id}`}
                        destination={
                          <ComicDetailScreen
                            sourceKey={source.key}
                            comicId={comic.id}
                            title={comic.title || title}
                          />
                        }
                      >
                        <VStack
                          alignment="leading"
                          spacing={6}
                          frame={{ width: sourceCard.width }}
                        >
                          {/* 封面與來源名稱標籤 */}
                          <ZStack alignment="bottomTrailing" frame={{ width: sourceCard.width, height: sourceCard.height }}>
                            <CoverImage
                              sourceKey={source.key}
                              url={comic.cover}
                              width={sourceCard.width}
                              height={sourceCard.height}
                              cornerRadius={radius.md}
                            />
                            <HStack
                              padding={{ horizontal: 6, vertical: 3 }}
                              background="ultraThinMaterial"
                              clipShape={rect(radius.sm)}
                              offset={{ x: -6, y: -6 }}
                            >
                              <Text font="caption2" fontWeight="semibold" foregroundStyle="label" lineLimit={1}>
                                {source.name}
                              </Text>
                            </HStack>
                          </ZStack>

                          {/* 固定兩行對齊標題 */}
                          <ZStack alignment="topLeading" frame={{ width: sourceCard.width }}>
                            <Text
                              font="caption"
                              lineLimit={2}
                              opacity={0}
                              frame={{ width: sourceCard.width, alignment: "topLeading" }}
                            >
                              {" \n "}
                            </Text>
                            <Text
                              font="caption"
                              fontWeight="medium"
                              foregroundStyle="label"
                              lineLimit={2}
                              frame={{ width: sourceCard.width, alignment: "topLeading" }}
                            >
                              {comic.title || title}
                            </Text>
                          </ZStack>

                          {/* 更新時間或作者 */}
                          {comic.updateTime ? (
                            <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1}>
                              {comic.updateTime}
                            </Text>
                          ) : null}
                        </VStack>
                      </NavigationLink>
                    ))}
                  </LazyHStack>
                </ScrollView>
              ) : searching ? (
                <VStack alignment="center" spacing={8} padding={{ vertical: 30 }} frame={{ maxWidth: "infinity" }}>
                  <Text font="caption" foregroundStyle="tertiaryLabel">
                    {t("home.bangumi.matching", { title })}
                  </Text>
                </VStack>
              ) : (
                <EmptyState
                  icon="magnifyingglass"
                  title={t("home.bangumi.notFoundTitle")}
                  detail={t("home.bangumi.notFoundDetail")}
                />
              )}
            </VStack>
          </VStack>
        </ScrollView>
      </VStack>
    </ZStack>
  )
}
