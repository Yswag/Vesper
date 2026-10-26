// 單一源的搜尋結果：關鍵字由 SourceScreen 送出，這裡只負責跑與畫。
// 用跟探索同一套網格，點進詳情與封面解析的行為完全一樣。

import {
  AbortController,
  Button,
  HStack,
  Image,
  Menu,
  Navigation,
  NavigationStack,
  Picker,
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
import { loadSearchSelections, saveSearchSelection } from "../../app/searchOptions"
import { aidokuFilterRows, loadFilterValues, saveFilterValues } from "../../app/aidokuSearchFilters"
import { PageBackground, useTint } from "../../app/theme"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { decodeSearchOptions, defaultSearchValues, encodeSearchOptions, type SearchOptionRow, type SearchOptionValue } from "../../sources/searchOptions"
import {
  activeFilterCount,
  defaultFilterValues,
  encodeFilters,
  type AidokuFilterRow,
  type AidokuFilterValue,
} from "../../sources/aidokuFilters"
import { findSource } from "../../sources/registry"
import { ComicGridLayout } from "../../components/ComicGrid"
import { Chip } from "../../design/chip"
import { EmptyState, NoticeBanner, PageLoading } from "../../design/status"
import { pageInsets } from "../../design/tokens"
import { AidokuFilterSheet } from "./AidokuFilterSheet"
import { SearchFilterSheet } from "../search/SearchFilterSheet"

interface FilterState {
  rows: AidokuFilterRow[]
  values: AidokuFilterValue[]
}

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
  const tint = useTint()
  useSubscription(subscribeLocale)
  const [hits, setHits] = useState<ComicListItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  /** Aidoku 源的搜尋篩選（列＋值）；其他源留在 null。 */
  const [filters, setFilters] = useState<FilterState | null>(null)
  /** Venera 源的篩選值：跟聚合搜尋讀同一份（`search-options.json`）。 */
  const [selections, setSelections] = useState<Record<string, Array<string | null>>>(loadSearchSelections())
  /** Venera 篩選 sheet 的草稿與開關（按下「套用」才存）。 */
  /** 這一輪搜尋的 epoch：換關鍵字或重試時舊的一輪作廢，在飛的請求真的被中止。 */
  const run = useRef({ id: 0, controller: null as AbortController | null })

  // Venera 源的搜尋選項（`search.optionList`）：存過的優先，否則是源的預設。
  const optionRows = library.source(sourceKey)?.searchOptions ?? []
  const optionValues = decodeSearchOptions(optionRows, selections[sourceKey])
  const optionRequest = encodeSearchOptions(optionRows, optionValues)
  const optionKey = JSON.stringify(optionRequest)
  const optionCount = customOptionCount(optionRows, optionValues)

  /** 開 Venera 篩選 sheet（草稿從現在的值開始，「套用」以外的操作不會寫回）。 */
  /** 開 Venera 源的篩選 sheet；套用後存回同一份設定，`optionKey` 一變搜尋 effect 就重跑。 */
  async function openOptions() {
    await Navigation.present({
      element: (
        <NavigationStack>
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
        </NavigationStack>
      ),
      modalPresentationStyle: "pageSheet",
    })
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
        const result = await library.searchSource(sourceKey, term, optionRequest, {
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
  }, [sourceKey, term, attempt, filterKey, optionKey])

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

  /** 套用某一列的值（chips 是即時生效，沒有「套用」）。 */
  function applyValue(index: number, value: AidokuFilterValue) {
    if (!filters) return
    const values = filters.values.map((item, at) => (at === index ? value : item))
    saveFilterValues(sourceKey, filters.rows, values)
    setFilters({ rows: filters.rows, values })
  }

  /** 每個篩選一顆膠囊：select／sort／multi 開 menu，check 直接切（跟 Aidoku 一樣）。 */
  function chip(row: AidokuFilterRow, index: number): VirtualNode {
    const value = filters?.values[index]

    switch (row.kind) {
      case "text":
        // 文字篩選沒有 chip，只從篩選 sheet 進（Aidoku 也是這樣）。
        return <VStack spacing={0} />
      case "check": {
        const on = value === true
        return <Chip text={row.label} selected={on} onTap={() => applyValue(index, !on)} />
      }
      case "select": {
        const current = typeof value === "string" ? value : (row.options[0]?.value ?? "")
        const active = current !== row.options[0]?.value
        return (
          <Menu label={<Chip text={row.label} selected={active} chevron />}>
            <Picker
              title={row.label}
              value={current}
              onChanged={(next: string | number) => applyValue(index, String(next))}
            >
              {row.options.map(option => (
                <Text key={option.value} tag={option.value}>
                  {option.label}
                </Text>
              ))}
            </Picker>
          </Menu>
        )
      }
      case "sort": {
        const sort =
          typeof value === "object" && value !== null && "index" in value ? value : { index: 0, ascending: false }
        const active = sort.index !== 0 || sort.ascending
        return (
          <Menu label={<Chip text={`${row.label}: ${row.options[sort.index] ?? ""}`} selected={active} chevron />}>
            <Picker
              title={row.label}
              value={String(sort.index)}
              onChanged={(next: string | number) =>
                applyValue(index, { index: Number(next) || 0, ascending: sort.ascending })
              }
            >
              {row.options.map((option, at) => (
                <Text key={String(at)} tag={String(at)}>
                  {option}
                </Text>
              ))}
            </Picker>
            {row.canAscend ? (
              <Button action={() => applyValue(index, { index: sort.index, ascending: !sort.ascending })}>
                <HStack spacing={6}>
                  <Image systemName={sort.ascending ? "chevron.up" : "chevron.down"} />
                  <Text>{t("search.filterAscending")}</Text>
                </HStack>
              </Button>
            ) : null}
          </Menu>
        )
      }
      case "multi": {
        const picked =
          typeof value === "object" && value !== null && "included" in value
            ? value
            : { included: [] as string[], excluded: [] as string[] }
        const count = picked.included.length + picked.excluded.length
        // Aidoku 的 MultiSelectFilterView 也是 Menu：點一下包含、再點一下排除（canExclude 時）、再點一下取消。
        // 每顆選項都不關 Menu，才能連續勾選。
        const toggle = (option: string) => {
          const included = picked.included.filter(item => item !== option)
          const excluded = picked.excluded.filter(item => item !== option)
          if (picked.included.includes(option)) {
            if (row.canExclude) excluded.push(option)
          } else if (!(row.canExclude && picked.excluded.includes(option))) {
            included.push(option)
          }
          applyValue(index, { included, excluded })
        }
        return (
          <Menu
            label={
              <Chip
                text={row.label}
                selected={count > 0}
                detail={count > 0 ? String(count) : undefined}
                chevron
              />
            }
          >
            {row.options.map(option => (
              <Button
                key={option.value}
                menuActionDismissBehavior="disabled"
                action={() => toggle(option.value)}
              >
                <HStack spacing={8}>
                  <Text>{option.label}</Text>
                  {picked.included.includes(option.value) ? (
                    <Image systemName="checkmark" foregroundStyle={tint.tint} />
                  ) : picked.excluded.includes(option.value) ? (
                    <Image systemName="xmark" foregroundStyle={tint.tint} />
                  ) : null}
                </HStack>
              </Button>
            ))}
          </Menu>
        )
      }
    }
  }

  /** 上緣那一排篩選：Venera 源一顆（開自己的 sheet），Aidoku 源是 `[篩選]` 加每個篩選一顆。 */
  function filterBar(): VirtualNode {
    // `filters` 只有 Aidoku 源會有值，所以這一段不會跟下面那排打到。
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
    const count = activeFilterCount(filters.rows, filters.values)
    const touched = new Set(encodedFilters.map(descriptor => descriptor.name))
    const entries = filters.rows
      .map((row, index) => ({ row, index }))
      .filter(entry => entry.row.kind !== "text")
    const ordered = [
      ...entries.filter(entry => touched.has(entry.row.name)),
      ...entries.filter(entry => !touched.has(entry.row.name)),
    ]

    return (
      <ScrollView axes="horizontal" scrollIndicator="hidden">
        <HStack spacing={6} padding={{ horizontal: pageInsets.horizontal, vertical: 6 }}>
          {/* 改過的排前面（Aidoku 的 `sortedFilters`）。 */}
          <Chip
            icon="line.3.horizontal.decrease"
            detail={count > 0 ? String(count) : undefined}
            onTap={() => void openFilters()}
            accessibilityLabel={t("search.filterTitle")}
          />
          {ordered.map(entry => (
            <VStack key={`chip:${entry.index}`} spacing={0}>
              {chip(entry.row, entry.index)}
            </VStack>
          ))}
        </HStack>
      </ScrollView>
    )
  }

  function body(): VirtualNode {
    if (error) {
      return (
        <VStack spacing={12} padding={{ top: 40, horizontal: pageInsets.horizontal }} frame={{ maxWidth: "infinity" }}>
          <NoticeBanner tone="error" text={error} />
          <Chip text={t("browse.refresh")} icon="arrow.clockwise" onTap={() => setAttempt(current => current + 1)} />
        </VStack>
      )
    }
    // 尚無結果或重新搜尋中：先佔位的骨架，結果來了才換上網格。
    if (hits === null || (searching && hits.length === 0)) return <PageLoading />
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
        // 篩選那排釘在導覽列下：還在載入、0 筆或失敗時也要進得去（那正是要改篩選的時候）。
        safeAreaInset={{ top: { content: filterBar() } }}
      >
        {body()}
      </VStack>
    </ZStack>
  )
}
