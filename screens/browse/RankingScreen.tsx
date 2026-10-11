// 源的排行榜（`categoryComics.ranking`）：上面一排選項（日 / 週 / 月…），下面大網格。
//
// 選項由源宣告（`"值-顯示名"`），翻頁一律用頁碼 —— 33 個源都沒有用到 `loadWithNext`。

import { Button, ScrollView, VStack, ZStack, useEffect, useState } from "scripting"

import { type RankingOption } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import type { ComicListItem } from "../../engine/adapt"
import { ComicGridLayout } from "../../components/ComicGrid"
import { Chip, ChipRow } from "../../design/chip"
import { ListFooter, PageLoading, StatusLine, type StatusKind } from "../../design/status"
import { PageBackground } from "../../app/theme"

export function RankingScreen({ sourceKey }: { sourceKey: string }) {
  const library = comicLibrary()
  // 畫面自己訂閱語言：下面的狀態字與按鈕都在 render 時取自 `t()`，換語言要重繪才算數。
  useSubscription(subscribeLocale)
  const [options, setOptions] = useState<RankingOption[]>([])
  const [active, setActive] = useState(0)
  const [comics, setComics] = useState<ComicListItem[]>([])
  const [page, setPage] = useState(2)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [status, setStatus] = useState<StatusKind>("ready")
  const [errorText, setErrorText] = useState("")

  useEffect(() => {
    setOptions(library.rankingOptions(sourceKey))
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
  // 顯示文字在 render 時才算：狀態只負責判斷。
  const message = status === "error" ? errorText : status === "empty" ? t("browse.noResults") : ""

  return (
    <ZStack>
      <PageBackground />
      {/* maxHeight infinity 只是「摸滿」，內容短時還是會被置中——載入中那塊要有
          alignment top 才會貼頂。見 dev/probe-top-align.tsx。 */}
      <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" }}>
      {options.length > 1 ? (
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
      ) : null}

      {busy && comics.length === 0 ? <PageLoading text={t("browse.rankingLoading")} /> : null}

      {message ? <StatusLine text={message} /> : null}

      {comics.length > 0 ? (
        <ScrollView scrollContentBackground="hidden">
          <ComicGridLayout
            entries={comics.map(comic => ({ sourceKey, comic }))}
            onLastAppear={done ? undefined : () => void loadMore()}
          />

          <ListFooter loading={!done} />
        </ScrollView>
      ) : null}

      {failed && !busy && comics.length === 0 ? (
        <VStack alignment="center" spacing={12} padding={{ top: 12, horizontal: 20 }}>
          <Button title={t("browse.reload")} systemImage="arrow.clockwise" action={() => void loadFirst()} buttonStyle="glassProminent" />
        </VStack>
      ) : null}
    </VStack>
  </ZStack>
  )
}
