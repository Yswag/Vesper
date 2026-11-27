import { ScrollView, VStack, ZStack, useEffect, useState } from "scripting"

import { type RankingOption } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import type { ComicListItem } from "../../engine/adapt"
import { ComicGridLayout, ComicGridSkeleton } from "../../components/ComicGrid"
import { Chip, ChipRow } from "../../design/chip"
import { scrollTopBar } from "../../design/glass"
import { EmptyState, ListFooter, NoticeBanner, type StatusKind } from "../../design/status"
import { pageInsets } from "../../design/tokens"
import { PageBackground } from "../../app/theme"

export function RankingScreen({ sourceKey }: { sourceKey: string }) {
  const library = comicLibrary()
  useSubscription(subscribeLocale)
  const [options, setOptions] = useState<RankingOption[]>([])
  const [optionsLoaded, setOptionsLoaded] = useState(false)
  const [active, setActive] = useState(0)
  const [comics, setComics] = useState<ComicListItem[]>([])
  const [page, setPage] = useState(2)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [status, setStatus] = useState<StatusKind>("ready")
  const [errorText, setErrorText] = useState("")

  useEffect(() => {
    let next: RankingOption[] = []
    try {
      next = library.rankingOptions(sourceKey)
    } catch {}
    setOptions(next)
    setOptionsLoaded(true)
  }, [sourceKey])

  useEffect(() => {
    if (options.length === 0) return
    void loadFirst()
  }, [sourceKey, active, options.length])

  async function loadFirst() {
    const option = options[active]
    if (!option) return
    setBusy(true)
    setStatus("loading")
    setComics([])
    setDone(false)
    try {
      const result = await library.ranking(sourceKey, option.value, 1)
      setComics(result.comics)
      setStatus(result.comics.length === 0 ? "empty" : "ready")
      setPage(2)
      setDone(!(result.maxPage != null ? 1 < result.maxPage : result.comics.length > 0))
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
      setStatus("error")
      setDone(true)
    } finally {
      setBusy(false)
    }
  }

  async function loadMore() {
    const option = options[active]
    if (!option || busy || loadingMore || done) return
    setLoadingMore(true)
    try {
      const result = await library.ranking(sourceKey, option.value, page)
      const seen = new Set(comics.map(comic => comic.id))
      const fresh = result.comics.filter(comic => !seen.has(comic.id))
      setComics([...comics, ...fresh])
      const next = page + 1
      setDone(!(result.maxPage != null ? next <= result.maxPage : result.comics.length > 0 && fresh.length > 0))
      setPage(next)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
      setStatus("error")
      setDone(true)
    } finally {
      setLoadingMore(false)
    }
  }

  const failed = status === "error"

  return (
    <ZStack>
      <PageBackground />
      {}
      <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" }}>
      {}
      <ScrollView
        scrollContentBackground="hidden"
        {...scrollTopBar(
          options.length > 1 ? (
            <ChipRow>
              {options.map((option, index) => (
                <Chip
                  key={`rank:${option.value}:${index}`}
                  text={option.label}
                  selected={index === active}
                  onTap={() => setActive(index)}
                />
              ))}
            </ChipRow>
          ) : null
        )}
      >

      {!optionsLoaded || (busy && comics.length === 0) ? <ComicGridSkeleton /> : null}

      {optionsLoaded && options.length === 0 ? (
        <EmptyState variant="page" icon="chart.bar" title={t("browse.noRankingOptions")} />
      ) : null}

      {failed ? (
        <VStack spacing={12} padding={{ top: 24, horizontal: pageInsets.horizontal }} frame={{ maxWidth: "infinity" }}>
          <NoticeBanner tone="error" text={errorText} />
          <Chip text={t("browse.reload")} icon="arrow.clockwise" onTap={() => void loadFirst()} />
        </VStack>
      ) : status === "empty" ? (
        <EmptyState variant="page" icon="magnifyingglass" title={t("browse.noResults")} />
      ) : null}

      {comics.length > 0 ? (
        <VStack spacing={0}>
          <ComicGridLayout
            entries={comics.map(comic => ({ sourceKey, comic }))}
            onLastAppear={done ? undefined : () => void loadMore()}
          />

          <ListFooter loading={!done} />
        </VStack>
      ) : null}
      </ScrollView>
    </VStack>
  </ZStack>
  )
}
