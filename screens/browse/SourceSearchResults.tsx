// 單一源的搜尋結果：關鍵字由 SourceScreen 送出，這裡只負責跑與畫。
// 用跟探索同一套網格，點進詳情與封面解析的行為完全一樣。

import {
  AbortController,
  Button,
  HStack,
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
import { PageBackground } from "../../app/theme"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { decodeSearchOptions, encodeSearchOptions } from "../../sources/searchOptions"
import { ComicGridLayout } from "../../components/ComicGrid"
import { PageLoading } from "../../design/status"

export function SourceSearchResults({ sourceKey, term }: { sourceKey: string; term: string }) {
  const library = comicLibrary()
  useSubscription(subscribeLocale)
  const [hits, setHits] = useState<ComicListItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  /** 這一輪搜尋的 epoch：換關鍵字或重試時舊的一輪作廢，在飛的請求真的被中止。 */
  const run = useRef({ id: 0, controller: null as AbortController | null })

  /** 這個源要帶的搜尋 options：跟搜尋分頁同一套（存過的篩選優先，否則是源的預設）。 */
  function searchOptions(): Array<string | null> {
    const rows = library.source(sourceKey)?.searchOptions ?? []
    if (rows.length === 0) return []
    return encodeSearchOptions(rows, decodeSearchOptions(rows, loadSearchSelections()[sourceKey]))
  }

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
  }, [sourceKey, term, attempt])

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
