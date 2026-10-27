// 帶著固定篩選的結果頁（首頁的 filters 捷徑用）：跟單源搜尋結果共用
// `comicLibrary().searchSource` 與同一組描述子，沒有關鍵字、只有源給的 filter values。

import { ScrollView, VStack, ZStack, useEffect, useState } from "scripting"

import type { ComicListItem } from "../../engine/adapt"
import { comicLibrary } from "../../app/services"
import { PageBackground } from "../../app/theme"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { ComicGridLayout } from "../../components/ComicGrid"
import { scrollTopBar } from "../../design/glass"
import { EmptyState, NoticeBanner, PageLoading } from "../../design/status"
import { pageInsets } from "../../design/tokens"

export function FilteredListScreen({
  sourceKey,
  title,
  filters,
}: {
  sourceKey: string
  /** 導覽列標題（原版用篩選項目的標題）。 */
  title: string
  /** 源給的 FilterValue 描述子，原樣交給 `searchSource`。 */
  filters: unknown[]
}) {
  const library = comicLibrary()
  useSubscription(subscribeLocale)
  const [hits, setHits] = useState<ComicListItem[] | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let alive = true
    setHits(null)
    setError("")
    void (async () => {
      try {
        const result = await library.searchSource(sourceKey, "", [], { filters })
        if (!alive) return
        setError(result.error ?? "")
        setHits(result.comics)
      } catch (failure) {
        if (!alive) return
        setError(failure instanceof Error ? failure.message : String(failure))
        setHits([])
      }
    })()
    return () => {
      alive = false
    }
  }, [sourceKey, title])

  return (
    <ZStack>
      <PageBackground />
      <VStack
        spacing={0}
        navigationTitle={title}
        navigationBarTitleDisplayMode="inline"
        frame={{ maxHeight: "infinity", alignment: "top" }}
      >
        {error ? (
          <VStack padding={{ horizontal: pageInsets.horizontal, top: 12 }} frame={{ maxWidth: "infinity" }}>
            <NoticeBanner tone="error" text={error} />
          </VStack>
        ) : null}

        {hits === null ? (
          <PageLoading />
        ) : hits.length === 0 ? (
          <EmptyState variant="page" icon="magnifyingglass" title={t("browse.noResults")} />
        ) : (
          <ScrollView scrollContentBackground="hidden" {...scrollTopBar(null)}>
            <ComicGridLayout entries={hits.map(comic => ({ sourceKey, comic }))} />
          </ScrollView>
        )}
      </VStack>
    </ZStack>
  )
}
