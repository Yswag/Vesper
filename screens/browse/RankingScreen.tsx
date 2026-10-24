// 源的排行榜（`categoryComics.ranking`）：上面一排選項（日 / 週 / 月…），下面大網格。
//
// 選項由源宣告（`"值-顯示名"`），翻頁一律用頁碼 —— 33 個源都沒有用到 `loadWithNext`。

import { ScrollView, VStack, ZStack, useEffect, useState } from "scripting"

import { type RankingOption } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import type { ComicListItem } from "../../engine/adapt"
import { ComicGridLayout } from "../../components/ComicGrid"
import { Chip, ChipRow } from "../../design/chip"
import { EmptyState, ListFooter, NoticeBanner, PageLoading, type StatusKind } from "../../design/status"
import { pageInsets } from "../../design/tokens"
import { PageBackground } from "../../app/theme"

export function RankingScreen({ sourceKey }: { sourceKey: string }) {
  const library = comicLibrary()
  // 畫面自己訂閱語言：下面的狀態字與按鈕都在 render 時取自 `t()`，換語言要重繪才算數。
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
    // 源還沒載好時 `rankingOptions` 會丟錯；當成「沒有選項」處理，不要讓畫面一直停在載入中。
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
      {/* maxHeight infinity 只是「摸滿」，內容短時還是會被置中——載入中那塊要有
          alignment top 才會貼頂。見 dev/probe-top-align.tsx。 */}
      <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" }}>
      {/* chip 列當捲動區頂部的 bar：貼在導覽列下面，內容從它後面捲過去；
          頂部邊緣用柔和樣式：導覽列標題仍有底，但沒有硬邊。 */}
      <ScrollView
        scrollContentBackground="hidden"
        scrollEdgeEffectStyle={{ style: "soft", edges: "top" }}
        safeAreaBar={
          options.length > 1
            ? {
                edge: "top",
                content: (
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
                ),
              }
            : undefined
        }
      >

      {!optionsLoaded ? <PageLoading text={t("browse.rankingLoading")} /> : null}

      {optionsLoaded && options.length === 0 ? (
        <EmptyState variant="page" icon="chart.bar" title={t("browse.noRankingOptions")} />
      ) : null}

      {busy && comics.length === 0 ? <PageLoading text={t("browse.rankingLoading")} /> : null}

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
