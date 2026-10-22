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
import { rect } from "../../design/tokens"
import { AidokuFilterSheet } from "./AidokuFilterSheet"

// 點完不關 Menu（Scripting 沒有這個修飾子，當成 prop 硬送；沒作用也不影響）。
const KEEP_MENU_OPEN = { menuActionDismissDisabled: true } as any

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

  /** 套用某一列的值（chips 是即時生效，沒有「套用」）。 */
  function applyValue(index: number, value: AidokuFilterValue) {
    if (!filters) return
    const values = filters.values.map((item, at) => (at === index ? value : item))
    saveFilterValues(sourceKey, filters.rows, values)
    setFilters({ rows: filters.rows, values })
  }

  /** 膠囊：`active` 決定要不要上色，`badge` 是左邊那個數字。 */
  function capsule(label: string, active: boolean, badge?: number, chevron = true): VirtualNode {
    return (
      <HStack
        spacing={4}
        alignment="center"
        padding={{ horizontal: 9, vertical: 6 }}
        background="ultraThinMaterial"
        clipShape={rect(14)}
      >
        {badge && badge > 0 ? (
          <Text font="caption2" fontWeight="semibold" foregroundStyle="tintColor">
            {String(badge)}
          </Text>
        ) : null}
        <Text font="caption" fontWeight="medium" foregroundStyle={active ? "tintColor" : "label"} lineLimit={1}>
          {label}
        </Text>
        {chevron ? <Image systemName="chevron.down" font="caption2" foregroundStyle="tertiaryLabel" /> : null}
      </HStack>
    )
  }

  /** 每個篩選一顆膠囊：select／sort 開 menu，check 直接切，multi 開 sheet（跟 Aidoku 一樣）。 */
  function chip(row: AidokuFilterRow, index: number): VirtualNode {
    const value = filters?.values[index]

    switch (row.kind) {
      case "text":
        // 文字篩選沒有 chip，只從篩選 sheet 進（Aidoku 也是這樣）。
        return <VStack spacing={0} />
      case "check": {
        const on = value === true
        return (
          <Button action={() => applyValue(index, !on)} buttonStyle="plain">
            {capsule(row.label, on, undefined, false)}
          </Button>
        )
      }
      case "select": {
        const current = typeof value === "string" ? value : (row.options[0]?.value ?? "")
        const active = current !== row.options[0]?.value
        return (
          <Menu label={capsule(row.label, active)}>
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
          <Menu label={capsule(`${row.label}: ${row.options[sort.index] ?? ""}`, active)}>
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
        // `menuActionDismissDisabled` 這裡沒有，所以 Menu 每點一次會關，重新打開才繼續。
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
          <Menu label={capsule(row.label, count > 0, count)}>
            {row.options.map(option => (
              <Button {...KEEP_MENU_OPEN} key={option.value} action={() => toggle(option.value)}>
                <HStack spacing={8}>
                  <Text>{option.label}</Text>
                  {picked.included.includes(option.value) ? (
                    <Image systemName="checkmark" foregroundStyle="tintColor" />
                  ) : picked.excluded.includes(option.value) ? (
                    <Image systemName="xmark" foregroundStyle="tintColor" />
                  ) : null}
                </HStack>
              </Button>
            ))}
          </Menu>
        )
      }
    }
  }

  /** 上緣那一排：`[篩選]` 後面每個篩選一顆膠囊，改過的排前面（Aidoku 的 `sortedFilters`）。 */
  function filterBar(): VirtualNode {
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
      <ScrollView axes="horizontal">
        <HStack spacing={6} padding={{ horizontal: 16, vertical: 6 }}>
          <Button action={() => void openFilters()} buttonStyle="plain">
            <HStack
              spacing={4}
              alignment="center"
              padding={{ horizontal: 9, vertical: 6 }}
              background="ultraThinMaterial"
              clipShape={rect(14)}
            >
              <Image systemName="line.3.horizontal.decrease" font="footnote" foregroundStyle="label" />
              {count > 0 ? (
                <Text font="caption2" fontWeight="semibold" foregroundStyle="tintColor">
                  {String(count)}
                </Text>
              ) : null}
            </HStack>
          </Button>
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
