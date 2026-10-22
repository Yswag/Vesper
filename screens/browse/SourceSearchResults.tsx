// 單一源的搜尋結果：關鍵字由 SourceScreen 送出，這裡只負責跑與畫。
// 用跟探索同一套網格，點進詳情與封面解析的行為完全一樣。

import {
  AbortController,
  Button,
  HStack,
  Image,
  Navigation,
  NavigationStack,
  ProgressView,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
  useEffect,
  useRef,
  useState,
  type VirtualNode,
} from "scripting"

import type { ComicListItem } from "../../engine/adapt"
import { isAbortError } from "../../engine/http"
import { comicLibrary } from "../../app/services"
import { loadSearchSelections } from "../../app/searchOptions"
import { aidokuFilterRows, loadFilterValues, saveFilterValues } from "../../app/aidokuSearchFilters"
import { PageBackground } from "../../app/theme"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { decodeSearchOptions, encodeSearchOptions } from "../../sources/searchOptions"
import {
  activeFilterCount,
  defaultFilterValues,
  encodeFilters,
  type AidokuFilterRow,
  type AidokuFilterValue,
} from "../../sources/aidokuFilters"
import { findSource } from "../../sources/registry"
import { ComicGridLayout } from "../../components/ComicGrid"
import { PageLoading } from "../../design/status"
import { AidokuFilterSheet } from "./AidokuFilterSheet"

interface FilterState {
  rows: AidokuFilterRow[]
  values: AidokuFilterValue[]
}

export function SourceSearchResults({ sourceKey, term }: { sourceKey: string; term: string }) {
  const library = comicLibrary()
  useSubscription(subscribeLocale)
  const [hits, setHits] = useState<ComicListItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  /** Aidoku 源的搜尋篩選（列＋值）；其他源留在 null。 */
  const [filters, setFilters] = useState<FilterState | null>(null)
  /** 這一輪搜尋的 epoch：換關鍵字或重試時舊的一輪作廢，在飛的請求真的被中止。 */
  const run = useRef({ id: 0, controller: null as AbortController | null })

  /** 這個源要帶的搜尋 options：跟搜尋分頁同一套（存過的篩選優先，否則是源的預設）。 */
  function searchOptions(): Array<string | null> {
    const rows = library.source(sourceKey)?.searchOptions ?? []
    if (rows.length === 0) return []
    return encodeSearchOptions(rows, decodeSearchOptions(rows, loadSearchSelections()[sourceKey]))
  }

  // Aidoku 源的篩選定義要問源（舊版讀 filters.json、v2 問 runtime），所以是非同步的。
  useEffect(() => {
    let alive = true
    setFilters(null)
    const source = findSource(sourceKey)
    if (!source || source.stored.kind !== "aidoku") return
    void (async () => {
      try {
        const rows = await aidokuFilterRows(source)
        if (!alive || rows.length === 0) return
        setFilters({ rows, values: loadFilterValues(sourceKey, rows) })
      } catch {
        // 篩選拿不到就只是沒有篩選可用，不影響搜尋本身。
      }
    })()
    return () => {
      alive = false
    }
  }, [sourceKey])

  const encodedFilters = filters ? encodeFilters(filters.rows, filters.values) : []
  const filterKey = JSON.stringify(encodedFilters)

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
        const result = await library.searchSource(sourceKey, term, searchOptions(), {
          signal: controller.signal,
          filters: encodedFilters,
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
  }, [sourceKey, term, attempt, filterKey])

  /** 開篩選 sheet；套用後寫回存檔，搜尋 effect 會因為 `filterKey` 變了重跑。 */
  async function openFilters() {
    if (!filters) return
    const current = filters
    await Navigation.present({
      element: (
        <NavigationStack>
          <AidokuFilterSheet
            rows={current.rows}
            values={current.values}
            defaults={defaultFilterValues(current.rows)}
            onApply={next => {
              const values = next ?? defaultFilterValues(current.rows)
              saveFilterValues(sourceKey, current.rows, values)
              setFilters({ rows: current.rows, values })
            }}
          />
        </NavigationStack>
      ),
      modalPresentationStyle: "pageSheet",
    })
  }

  function clearFilters() {
    if (!filters) return
    const values = defaultFilterValues(filters.rows)
    saveFilterValues(sourceKey, filters.rows, values)
    setFilters({ rows: filters.rows, values })
  }

  /** 結果頁上緣的篩選列：沒有篩選可設的源不顯示。 */
  function filterBar(): VirtualNode {
    if (!filters) return <VStack spacing={0} />
    const count = activeFilterCount(filters.rows, filters.values)
    return (
      <HStack spacing={8} padding={{ horizontal: 16, vertical: 6 }} frame={{ maxWidth: "infinity" }}>
        <Button action={() => void openFilters()} buttonStyle="plain">
          <HStack spacing={6} alignment="center">
            <Image
              systemName={count > 0 ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"}
              foregroundStyle={count > 0 ? "tintColor" : "label"}
            />
            <Text font="subheadline" foregroundStyle={count > 0 ? "tintColor" : "label"}>
              {count > 0 ? t("search.filterCount", { n: count }) : t("search.filter")}
            </Text>
          </HStack>
        </Button>
        <Spacer />
        {count > 0 ? (
          <Button action={clearFilters} buttonStyle="plain">
            <Text font="subheadline" foregroundStyle="tintColor">
              {t("search.filterClear")}
            </Text>
          </Button>
        ) : null}
      </HStack>
    )
  }

  function body(): VirtualNode {
    if (error) {
      return (
        <VStack alignment="center" spacing={12} padding={{ top: 60, horizontal: 20 }}>
          <Text foregroundStyle="secondaryLabel">{error}</Text>
          <Button
            title={t("browse.refresh")}
            systemImage="arrow.clockwise"
            action={() => setAttempt(current => current + 1)}
            buttonStyle="glassProminent"
          />
        </VStack>
      )
    }
    // 尚無結果或重新搜尋中：顯示加載動畫
    if (hits === null || (searching && hits.length === 0)) return <PageLoading />
    if (hits.length === 0) {
      return (
        <VStack alignment="center" padding={{ top: 60, horizontal: 20 }}>
          <Text foregroundStyle="secondaryLabel">{t("browse.noResults")}</Text>
        </VStack>
      )
    }
    return (
      <ScrollView
        scrollDismissesKeyboard="interactively"
        safeAreaInset={{ top: { content: filterBar() } }}
      >
        <VStack
          spacing={0}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          onTapGesture={() => {
            if (Keyboard.visible) Keyboard.hide()
          }}
        >
          {/* 已經有結果時再改關鍵字：舊的先留著，只在上面放一條進行中，免得整個網格閃掉。 */}
          {searching ? (
            <HStack spacing={8} padding={{ horizontal: 16, top: 10 }} frame={{ maxWidth: "infinity" }}>
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
      <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" }}>
        {body()}
      </VStack>
    </ZStack>
  )
}
