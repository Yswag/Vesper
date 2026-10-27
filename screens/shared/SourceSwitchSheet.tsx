// 換源 sheet：用書名在目前來源以外找同一部作品，選了就交回去切換。
//
// 比對沿用 `engine/titleMatch`（跟 Bangumi 詳情同一套），門檻也一樣是 55 分：
// 低於這個分數的都是「只沾到幾個字」，列出來只會讓人選錯。

import {
  AbortController,
  Divider,
  HStack,
  Image,
  Navigation,
  ProgressView,
  ScrollView,
  Spacer,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
  Button,
  useEffect,
  useState,
} from "scripting"

import { type ComicRef, type ComicSourceInfo } from "../../app/comic"
import { loadSearchSelections } from "../../app/searchOptions"
import { comicLibrary } from "../../app/services"
import { PageBackground } from "../../app/theme"
import { useSubscription } from "../../app/useSubscription"
import { CoverImage } from "../../components/CoverImage"
import { Card } from "../../design/layout"
import { Chevron } from "../../design/rows"
import { SkeletonListRow } from "../../design/skeleton"
import { EmptyState } from "../../design/status"
import { pageInsets, pageSpacing, radius, rowPadding } from "../../design/tokens"
import { type ComicListItem } from "../../engine/adapt"
import { isAbortError } from "../../engine/http"
import { log } from "../../engine/log"
import { matchComicTitleScore } from "../../engine/titleMatch"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { type SourceSearchResult } from "../../sources/search"

/** 候選的封面尺寸；骨架也用它，資料到了版面不跳。 */
const COVER = { width: 44, height: 62 }

interface Candidate {
  source: ComicSourceInfo
  comic: ComicListItem
  score: number
}

/** 把各源結果攤成候選：只留標題夠像的，分數高的在前。 */
function collectCandidates(
  results: SourceSearchResult[],
  sources: ComicSourceInfo[],
  title: string
): Candidate[] {
  const byKey = new Map(sources.map(source => [source.key, source]))
  const out: Candidate[] = []
  for (const result of results) {
    const source = byKey.get(result.key)
    if (!source) continue
    for (const comic of result.comics) {
      const score = matchComicTitleScore(comic.title, title, title)
      if (score >= 55) out.push({ source, comic, score })
    }
  }
  return out.sort((a, b) => b.score - a.score)
}

export function SourceSwitchSheet({
  sourceKey,
  title,
  onPick,
}: {
  /** 目前這部作品的來源；不會出現在候選裡。 */
  sourceKey: string
  title: string
  onPick: (ref: ComicRef, title: string) => void
}) {
  const library = comicLibrary()
  const dismiss = Navigation.useDismiss()
  // sheet 是獨立的 render 根：語言一換就重繪。
  useSubscription(subscribeLocale)

  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [others, setOthers] = useState(0)
  const [running, setRunning] = useState(true)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  useEffect(() => {
    const sources = library.sources().filter(source => source.key !== sourceKey)
    setOthers(sources.length)
    if (sources.length === 0) {
      setRunning(false)
      return
    }

    // 帶使用者存過的搜尋篩選：跟搜尋分頁看到的是同一組結果。
    const selections = loadSearchSelections()
    let alive = true
    const controller = new AbortController()
    setProgress({ done: 0, total: sources.length })

    void library
      .search(
        { keyword: title, optionsOf: key => selections[key] ?? [] },
        snapshot => {
          if (!alive) return
          setCandidates(collectCandidates(snapshot.results, sources, title))
          setProgress({ done: snapshot.done, total: snapshot.total })
        },
        { signal: controller.signal }
      )
      .catch(error => {
        if (!isAbortError(error)) log("warning", "switch", `「${title}」換源搜尋失敗`, error)
      })
      .finally(() => {
        if (alive) setRunning(false)
      })

    return () => {
      alive = false
      controller.abort()
    }
  }, [sourceKey, title])

  return (
    <VStack
      spacing={0}
      navigationTitle={t("detail.switchSource")}
      navigationBarTitleDisplayMode="inline"
      toolbar={
        <Toolbar>
          <ToolbarItem placement="topBarLeading">
            <Button buttonStyle="plain" action={dismiss} accessibilityLabel={t("common.close")}>
              <Image systemName="xmark" font="body" fontWeight="medium" foregroundStyle="secondaryLabel" />
            </Button>
          </ToolbarItem>
        </Toolbar>
      }
    >
      <ScrollView scrollContentBackground="hidden" background={<PageBackground />}>
        <VStack alignment="leading" spacing={pageSpacing} padding={pageInsets}>
          {running ? (
            <HStack spacing={8} alignment="center">
              <ProgressView />
              <Text font="caption" foregroundStyle="tertiaryLabel">
                {progress.total > 0
                  ? `${t("detail.switchSourceSearching")} ${progress.done}/${progress.total}`
                  : t("detail.switchSourceSearching")}
              </Text>
            </HStack>
          ) : null}

          {candidates.length > 0 ? (
            <Card>
              {candidates.map((candidate, index) => (
                <VStack key={`${candidate.source.key}:${candidate.comic.id}`} spacing={0}>
                  {index > 0 ? <Divider /> : null}
                  <HStack
                    spacing={12}
                    padding={rowPadding}
                    contentShape="rect"
                    onTapGesture={() => {
                      onPick(
                        { sourceKey: candidate.source.key, comicId: candidate.comic.id },
                        candidate.comic.title
                      )
                      dismiss()
                    }}
                  >
                    <CoverImage
                      sourceKey={candidate.source.key}
                      url={candidate.comic.cover}
                      width={COVER.width}
                      height={COVER.height}
                      cornerRadius={radius.sm}
                      title={candidate.comic.title}
                    />
                    <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                      <Text font="subheadline" fontWeight="medium" lineLimit={2}>
                        {candidate.comic.title}
                      </Text>
                      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                        {candidate.source.name}
                      </Text>
                    </VStack>
                    <Chevron />
                  </HStack>
                </VStack>
              ))}
            </Card>
          ) : running ? (
            <VStack spacing={0} frame={{ maxWidth: "infinity" }}>
              <SkeletonListRow cover={COVER} lines={["subheadline", "caption"]} />
              <SkeletonListRow cover={COVER} lines={["subheadline", "caption"]} />
              <SkeletonListRow cover={COVER} lines={["subheadline", "caption"]} />
            </VStack>
          ) : (
            <EmptyState
              icon="arrow.triangle.2.circlepath"
              title={others === 0 ? t("detail.switchSourceNoOthers") : t("detail.switchSourceEmpty")}
            />
          )}
        </VStack>
      </ScrollView>
    </VStack>
  )
}
