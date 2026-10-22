// 單一源的頁面外殼：導覽列右上一個下拉切「探索 / 分類 / 排行」，內容是一整棵子樹。
//
// 搜尋歸這裡：輸入框是 top bar 的 toolbar 搜尋（minimize），擁有者與按鈕同一個 view。
// 送出才真的打源，結果換成整頁的搜尋結果。
// 三邊的狀態各自獨立（載入、錯誤、翻頁都不共用），這裡只負責切換與標題。

import {
  DefaultToolbarItem,
  Image,
  Menu,
  Picker,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
  useEffect,
  useState,
} from "scripting"

import { comicLibrary } from "../../app/services"
import { log } from "../../engine/log"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { CategoryScreen } from "./CategoryScreen"
import { ExploreScreen } from "./ExploreScreen"
import { RankingScreen } from "./RankingScreen"
import { SourceSearchResults } from "./SourceSearchResults"

export function SourceScreen({ sourceKey }: { sourceKey: string }) {
  // 標題與「有沒有分類／排行」都是庫給的 domain 資訊（畫面不碰源的 instance）。
  const info = comicLibrary().source(sourceKey)
  // Picker 的值只能是 string / number，所以這裡用字串。
  const [mode, setMode] = useState("explore")
  // 搜尋框：`keyword` 是框裡的原文，`submitted` 是「這些結果屬於哪個關鍵字」（送出才更新）。
  const [keyword, setKeyword] = useState("")
  const [submitted, setSubmitted] = useState("")
  const [searchPresented, setSearchPresented] = useState(false)
  // 選單標籤與導覽列替代標題都在 render 時取自 `t()`：換語言要重繪才算數。
  useSubscription(subscribeLocale)

  // 換源時整組搜尋作廢，不要把上一個源的關鍵字帶過來。
  useEffect(() => {
    setKeyword("")
    setSubmitted("")
  }, [sourceKey])

  // 源沒宣告的頁面就不列進選單（33 個源裡有 2 個沒有分類、24 個沒有排行榜）。
  const hasCategory = info?.hasCategory ?? false
  const hasBoard = info?.hasRanking ?? false
  const pages = [
    { value: "explore", label: t("browse.explore") },
    ...(hasCategory ? [{ value: "category", label: t("browse.category") }] : []),
    ...(hasBoard ? [{ value: "ranking", label: t("browse.ranking") }] : []),
  ]

  const showCategory = hasCategory && mode === "category"
  const showRanking = hasBoard && mode === "ranking"
  const title = info?.name ?? t("browse.source")

  /** 搜尋框的每一次變動：**不搜**，只記在原字。清成空的就復原（回原本的檢視）。 */
  function handleKeywordChange(text: string) {
    setKeyword(text)
    if (text.trim() === "") setSubmitted("")
  }

  /** 搜尋欄的呈現狀態；系統取消時應回報 false。 */
  function handleSearchPresented(value: boolean) {
    log("info", "source-search", "Presented state changed", {
      previous: searchPresented,
      next: value,
    })
    setSearchPresented(value)
  }

  /** 送出（鍵盤的搜尋鍵）：現在框裡的字才去搜。 */
  function handleSubmitSearch() {
    const term = keyword.trim()
    if (!term) return
    // 結果拿到就收起鍵盤，讓出來給網格。
    if (Keyboard.visible) Keyboard.hide()
    setSubmitted(term)
  }

  return (
    <VStack
      spacing={0}
      navigationTitle={title}
      navigationBarTitleDisplayMode="inline"
      searchable={{
        placement: "toolbar",
        prompt: t("browse.searchInSource", { name: title }),
        value: keyword,
        onChanged: handleKeywordChange,
        presented: {
          value: searchPresented,
          onChanged: handleSearchPresented,
        },
      }}
      //searchToolbarBehavior="minimize"
      onSubmit={{ triggers: "search", action: handleSubmitSearch }}
      toolbar={
        <Toolbar>
          <DefaultToolbarItem kind="search" placement="topBarTrailing" />
          {pages.length > 1 && (
            <ToolbarItem placement="topBarTrailing">
              <Menu
                label={
                  <Image
                    systemName={
                      mode === "explore"
                        ? "line.3.horizontal.decrease.circle"
                        : "line.3.horizontal.decrease.circle.fill"
                    }
                    font="body"
                    fontWeight="medium"
                  />
                }
              >
                <Picker
                  title={t("browse.viewLabel", {
                    label: pages.find(page => page.value === mode)?.label ?? t("browse.explore"),
                  })}
                  value={mode}
                  onChanged={setMode}
                >
                  {pages.map(page => (
                    <Text key={page.value} tag={page.value}>
                      {page.label}
                    </Text>
                  ))}
                </Picker>
              </Menu>
            </ToolbarItem>
          )}
        </Toolbar>
      }
    >
      {submitted ? (
        <SourceSearchResults sourceKey={sourceKey} term={submitted} />
      ) : showRanking ? (
        <RankingScreen sourceKey={sourceKey} />
      ) : showCategory ? (
        <CategoryScreen sourceKey={sourceKey} />
      ) : (
        <ExploreScreen sourceKey={sourceKey} />
      )}
    </VStack>
  )
}
