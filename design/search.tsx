// 導覽列放大鏡搜尋：平常不掛 searchable，點放大鏡才掛上並展開，取消就清空並卸下。
// 不常駐是為了不跟同一捲動區的下拉重整搶手勢（見 SourceScreen）。打字即篩選，不必送出。
// tab 根頁上 `navigationBarDrawerAutomaticDisplay` 一進頁就展開（實機），收不起來，所以也走這個。

import {
  Button,
  DefaultToolbarItem,
  Image,
  ToolbarItem,
  useEffect,
  useObservable,
  useState,
  type CommonViewProps,
} from "scripting"

import { liquidGlass } from "./glass"
import { t } from "../i18n"

export interface ToolbarSearch {
  /** 框裡的字（已 trim）；空字串＝沒在篩選。 */
  query: string
  /** 搜尋框掛著（搜尋模式中）；這時下拉重整要讓路。 */
  active: boolean
  searchable: CommonViewProps["searchable"]
  open: () => void
}

/** `initialQuery` 有值時一進頁就展開並帶入（從別頁帶關鍵字過來）。 */
export function useToolbarSearch(prompt: string, initialQuery: string = ""): ToolbarSearch {
  const [text, setText] = useState(initialQuery)
  const [mounted, setMounted] = useState(initialQuery !== "")
  // Observable 而不是 state：展開過程中系統會連續回報，用 state 會重繪打斷手勢。
  const presented = useObservable(false)

  useEffect(() => {
    const listener = (open: boolean) => {
      if (open) return
      setText("")
      setMounted(false)
    }
    presented.subscribe(listener)
    // 先掛上 searchable，下一拍再展開。
    if (initialQuery) setTimeout(() => presented.setValue(true), 50)
    return () => presented.unsubscribe(listener)
  }, [presented])

  return {
    query: text.trim(),
    active: mounted,
    searchable: mounted ? { placement: "toolbar", prompt, value: text, onChanged: setText, presented } : undefined,
    open: () => {
      setMounted(true)
      setTimeout(() => presented.setValue(true), 50)
    },
  }
}

/** 放進頁面自己的 `<Toolbar>`：沒掛時是放大鏡；掛著時 iOS 26 要系統的搜尋項目佔位。 */
export function searchToolbarItem(search: ToolbarSearch) {
  if (search.active) return liquidGlass ? <DefaultToolbarItem kind="search" placement="topBarTrailing" /> : null
  return (
    <ToolbarItem placement="topBarTrailing">
      <Button buttonStyle="plain" accessibilityLabel={t("common.tabs.search")} action={search.open}>
        <Image systemName="magnifyingglass" font="body" fontWeight="medium" foregroundStyle="label" />
      </Button>
    </ToolbarItem>
  )
}

/** 不分大小寫的子字串比對，任一欄位命中就算。 */
export function matchesQuery(query: string, ...fields: Array<string | undefined>): boolean {
  const needle = query.toLowerCase()
  return fields.some(field => field !== undefined && field.toLowerCase().includes(needle))
}
