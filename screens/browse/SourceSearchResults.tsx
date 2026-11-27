// 單一源的搜尋結果：關鍵字由 SourceScreen 送出，這裡只負責跑與畫。
// 用跟探索同一套網格，點進詳情與封面解析的行為完全一樣。

import {
  AbortController,
  HStack,
  Navigation,
  ProgressView,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
  useEffect,
  useRef,
  useState,
} from "scripting"

import type { ComicListItem } from "../../engine/adapt"
import { isAbortError } from "../../engine/http"
import { comicLibrary } from "../../app/services"
import { loadSearchSelections, saveSearchSelection } from "../../app/searchOptions"
import { applyFilterDraft, filterEntries, filterPayload, loadSearchFilters, type SearchFilterSet } from "../../app/searchFilters"
import { PageBackground, ThemedNavigationStack } from "../../app/theme"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { decodeSearchOptions, defaultSearchValues, encodeSearchOptions, type SearchOptionRow, type SearchOptionValue } from "../../sources/searchOptions"
import { findSource } from "../../sources/registry"
import { ComicGridLayout, ComicGridSkeleton } from "../../components/ComicGrid"
import { SourceFilterBar, SourceFilterSheet } from "../../components/SourceFilterSheet"
import { Chip } from "../../design/chip"
import type { FilterControl } from "../../design/filterEntries"
import { scrollTopBar } from "../../design/glass"
import { EmptyState, NoticeBanner } from "../../design/status"
import { pageInsets } from "../../design/tokens"
import { SearchFilterSheet } from "../search/SearchFilterSheet"

/** 有幾列的篩選跟源的預設不一樣（chip 上的數字）。 */
function customOptionCount(rows: SearchOptionRow[], values: SearchOptionValue[]): number {
  return rows.filter(
    (row, index) =>
      JSON.stringify(encodeSearchOptions([row], [values[index]])) !==
      JSON.stringify(encodeSearchOptions([row], [row.initial]))
  ).length
}

export function SourceSearchResults({ sourceKey, term }: { sourceKey: string; term: string }) {
  const library = comicLibrary()
  useSubscription(subscribeLocale)
  const [hits, setHits] = useState<ComicListItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  /** Aidoku／Mihon 源的搜尋篩選；其他源留在 null。 */
  const [filters, setFilters] = useState<SearchFilterSet | null>(null)
  /** Venera 源的篩選值：跟聚合搜尋讀同一份（`search-options.json`）。 */
  const [selections, setSelections] = useState<Record<string, Array<string | null>>>(loadSearchSelections())
  /** 這一輪搜尋的 epoch：換關鍵字或重試時舊的一輪作廢，在飛的請求真的被中止。 */
  const run = useRef({ id: 0, controller: null as AbortController | null })

  // Venera 源的搜尋選項（`search.optionList`）：存過的優先，否則是源的預設。
  const optionRows = library.source(sourceKey)?.searchOptions ?? []
  const optionValues = decodeSearchOptions(optionRows, selections[sourceKey])
  const optionRequest = encodeSearchOptions(optionRows, optionValues)
  const optionKey = JSON.stringify(optionRequest)
  const optionCount = customOptionCount(optionRows, optionValues)

  /** 開 Venera 源的篩選 sheet（草稿從現在的值開始）；套用後存回同一份設定，`optionKey` 一變搜尋 effect 就重跑。 */
  async function openOptions() {
    await Navigation.present({
      element: (
        <ThemedNavigationStack>
          <SearchFilterSheet
            rows={optionRows}
            values={optionValues}
            defaults={defaultSearchValues(optionRows)}
            onApply={next => {
              const options = encodeSearchOptions(optionRows, next)
              saveSearchSelection(sourceKey, options)
              setSelections(previous => ({ ...previous, [sourceKey]: options }))
            }}
          />
        </ThemedNavigationStack>
      ),
      modalPresentationStyle: "pageSheet",
    })
  }

  // 篩選定義要問源（Aidoku 可能要起宿主、Mihon 要問 dexvm），所以是非同步的。
  useEffect(() => {
    let alive = true
    setFilters(null)
    const source = findSource(sourceKey)
    if (!source) return
    void (async () => {
      try {
        const next = await loadSearchFilters(source)
        if (!alive || !next) return
        setFilters(next)
      } catch {
        // 篩選拿不到就只是沒有篩選可用，不影響搜尋本身。
      }
    })()
    return () => {
      alive = false
    }
  }, [sourceKey])

  const entries = filters ? filterEntries(filters) : []
  const payload = filters ? filterPayload(filters) : []
  const filterKey = JSON.stringify(payload)

  useEffect(() => {
    const id = ++run.current.id
    const current = () => run.current.id === id
    run.current.controller?.abort()
    const controller = new AbortController()
    run.current.controller = controller
    setSearching(true)
    setError("")
    void (async () => {
      try {
        const result = await library.searchSource(sourceKey, term, optionRequest, {
          signal: controller.signal,
          filters: payload,
        })
        if (!current()) return
        setError(result.error ?? "")
        setHits(result.comics)
      } catch (failure: unknown) {
        // 取消是正常結束；其他錯誤留在畫面上讓使用者看得到。
        if (!current() || isAbortError(failure)) return
        setError(failure instanceof Error ? failure.message : String(failure))
        setHits([])
      } finally {
        if (current()) {
          setSearching(false)
          run.current.controller = null
        }
      }
    })()
    return (): void => {
      run.current.controller?.abort()
    }
  }, [sourceKey, term, attempt, filterKey, optionKey])

  /** 開篩選 sheet；套用後寫回存檔，搜尋 effect 會因為 `filterKey` 變了重跑。 */
  async function openFilters() {
    if (!filters) return
    const current = filters
    await Navigation.present({
      element: (
        <ThemedNavigationStack>
          <SourceFilterSheet
            entries={filterEntries(current)}
            onApply={draft => setFilters(applyFilterDraft(current, draft))}
          />
        </ThemedNavigationStack>
      ),
      modalPresentationStyle: "pageSheet",
    })
  }

  /** 膠囊改一個值：存回去，`filterKey` 一變就重新搜尋並回到第一頁。 */
  function applyValue(id: string, control: FilterControl) {
    if (!filters) return
    setFilters(applyFilterDraft(filters, { [id]: control }))
  }

  /** 上緣那一排篩選：Venera 源一顆（開自己的 sheet），Aidoku／Mihon 源是 `[篩選]` 加每個篩選一顆。 */
  function filterBar() {
    // `filters` 只有 Aidoku／Mihon 源會有值，所以這一段不會跟下面那排打到。
    if (optionRows.length > 0 && !filters) {
      return (
        <HStack
          spacing={6}
          padding={{ horizontal: pageInsets.horizontal, vertical: 6 }}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          <Chip
            icon="line.3.horizontal.decrease"
            detail={optionCount > 0 ? String(optionCount) : undefined}
            selected={optionCount > 0}
            onTap={() => void openOptions()}
            accessibilityLabel={t("search.filterTitle")}
          />
        </HStack>
      )
    }
    if (!filters) return <VStack spacing={0} />
    return <SourceFilterBar entries={entries} onOpenAll={() => void openFilters()} onChange={applyValue} />
  }

  function body() {
    if (error) {
      return (
        <VStack spacing={12} padding={{ top: 40, horizontal: pageInsets.horizontal }} frame={{ maxWidth: "infinity" }}>
          <NoticeBanner tone="error" text={error} />
          <Chip text={t("browse.refresh")} icon="arrow.clockwise" onTap={() => setAttempt(current => current + 1)} />
        </VStack>
      )
    }
    // 尚無結果或重新搜尋中：先佔位的骨架，結果來了才換上網格。
    if (hits === null || (searching && hits.length === 0)) {
      return (
        <ScrollView scrollDisabled={true}>
          <ComicGridSkeleton />
        </ScrollView>
      )
    }
    if (hits.length === 0) {
      return <EmptyState variant="page" icon="magnifyingglass" title={t("browse.noResults")} />
    }
    return (
      <ScrollView scrollDismissesKeyboard="interactively">
        <VStack
          spacing={0}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          onTapGesture={() => {
            if (Keyboard.visible) Keyboard.hide()
          }}
        >
          {/* 已經有結果時再改關鍵字：舊的先留著，只在上面放一條進行中，免得整個網格閃掉。 */}
          {searching ? (
            <HStack spacing={8} padding={{ horizontal: pageInsets.horizontal, top: 10 }} frame={{ maxWidth: "infinity" }}>
              <ProgressView />
              <Text font="caption" foregroundStyle="secondaryLabel">
                {t("browse.searching")}
              </Text>
              <Spacer />
            </HStack>
          ) : null}
          <ComicGridLayout entries={hits.map(comic => ({ sourceKey, comic }))} />
        </VStack>
      </ScrollView>
    )
  }

  return (
    <ZStack>
      <PageBackground />
      <VStack
        spacing={0}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" }}
        // 篩選那排釘在導覽列下、浮在內容上：還在載入、0 筆或失敗時也要進得去（那正是要改篩選的時候）。
        {...scrollTopBar(filterBar())}
      >
        {body()}
      </VStack>
    </ZStack>
  )
}
