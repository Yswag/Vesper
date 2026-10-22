// 單一源的頁面外殼：導覽列右上一個下拉切「探索 / 分類 / 排行」，內容是一整棵子樹。
//
// 三邊的狀態各自獨立（載入、錯誤、翻頁都不共用），這裡只負責切換與標題。
// 切換時子樹會重建、重新載入一次；分開的好處是探索頁那套雜誌流 / 翻頁狀態
// 完全不必知道另外兩頁的存在。

import { Image, Menu, Picker, Text, VStack, useState } from "scripting"

import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { CategoryScreen } from "./CategoryScreen"
import { ExploreScreen } from "./ExploreScreen"
import { RankingScreen } from "./RankingScreen"

export function SourceScreen({ sourceKey }: { sourceKey: string }) {
  // 標題與「有沒有分類／排行」都是庫給的 domain 資訊（畫面不碰源的 instance）。
  const info = comicLibrary().source(sourceKey)
  // Picker 的值只能是 string / number，所以這裡用字串。
  const [mode, setMode] = useState("explore")
  // 選單標籤與導覽列替代標題都在 render 時取自 `t()`：換語言要重繪才算數。
  useSubscription(subscribeLocale)

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

  return (
    <VStack
      spacing={0}
      navigationTitle={title}
      navigationBarTitleDisplayMode="inline"
      toolbar={
        pages.length > 1
          ? {
              topBarTrailing: (
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
              ),
            }
          : undefined
      }
    >
      {showRanking ? (
        <RankingScreen sourceKey={sourceKey} />
      ) : showCategory ? (
        <CategoryScreen sourceKey={sourceKey} />
      ) : (
        <ExploreScreen sourceKey={sourceKey} />
      )}
    </VStack>
  )
}
