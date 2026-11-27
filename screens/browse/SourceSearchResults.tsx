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
  const [filters, setFilters] = useState<SearchFilterSet | null>(null)
  const [selections, setSelections] = useState<Record<string, Array<string | null>>>(loadSearchSelections())
  const run = useRef({ id: 0, controller: null as AbortController | null })

  const optionRows = library.source(sourceKey)?.searchOptions ?? []
  const optionValues = decodeSearchOptions(optionRows, selections[sourceKey])
  const optionRequest = encodeSearchOptions(optionRows, optionValues)
  const optionKey = JSON.stringify(optionRequest)
  const optionCount = customOptionCount(optionRows, optionValues)

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

  function applyValue(id: string, control: FilterControl) {
    if (!filters) return
    setFilters(applyFilterDraft(filters, { [id]: control }))
  }

  function filterBar() {
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
          {}
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
        {...scrollTopBar(filterBar())}
      >
        {body()}
      </VStack>
    </ZStack>
  )
}
