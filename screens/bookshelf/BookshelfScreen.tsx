// 書架：上面兩列入口（閱讀歷史、離線內容，各推一頁），下面是收藏網格。
// 整頁一個直向捲動區，導覽列才有柔和淡出、tab bar 才會跟著捲動縮放（見 design/LANGUAGE.md）。
// 收藏格子接上閱讀紀錄：狀態行寫讀到哪一話，封面下的進度條是那一話讀到哪。

import { Button, Divider, Menu, NavigationLink, ScrollView, VStack, ZStack, useEffect, useState } from "scripting"

import { shelfItems, type ShelfFilter, type ShelfItem, type ShelfSort } from "../../app/shelf"
import { comicLibrary } from "../../app/services"
import { PageBackground } from "../../app/theme"
import { useSubscription } from "../../app/useSubscription"
import { ComicGridLayout, type ComicGridEntry } from "../../components/ComicGrid"
import { LeadingToolbar } from "../../components/LeadingToolbar"
import { scrollTopBar } from "../../design/glass"
import { Card } from "../../design/layout"
import { IconRow, rowSeparatorInset } from "../../design/rows"
import { EmptyState } from "../../design/status"
import { pageInsets } from "../../design/tokens"
import { formatBytes } from "../../engine/format"
import { subscribe as subscribeLocale, t, type MessageKey } from "../../i18n"
import { listFavorites, listProgress, removeFavorite } from "../../library/bookshelf"
import { HistoryScreen } from "./HistoryScreen"
import { OfflineLibraryPage } from "./OfflineLibraryScreen"

const SORTS: { value: ShelfSort; key: MessageKey }[] = [
  { value: "recent", key: "bookshelf.sortRecent" },
  { value: "added", key: "bookshelf.sortAdded" },
  { value: "title", key: "bookshelf.sortTitle" },
]
const FILTERS: { value: ShelfFilter; key: MessageKey }[] = [
  { value: "all", key: "bookshelf.filterAll" },
  { value: "read", key: "bookshelf.filterRead" },
  { value: "unread", key: "bookshelf.filterUnread" },
]

function gridEntry({ favorite, progress, readFraction, removed }: ShelfItem): ComicGridEntry {
  return {
    sourceKey: favorite.sourceKey,
    removed,
    readFraction,
    comic: {
      id: favorite.comicId,
      title: favorite.title,
      cover: favorite.cover,
      subtitle: progress ? progress.epTitle || t("bookshelf.lastRead") : t("bookshelf.unread"),
      tags: [],
    },
  }
}

export function BookshelfScreen() {
  const [sort, setSort] = useState<ShelfSort>("recent")
  const [filter, setFilter] = useState<ShelfFilter>("all")

  // 源清單、書架（收藏／歷史）、離線層與語言一變就重繪（`onChange` 已含離線層）；回傳的 refresh 給 onAppear 用。
  const refresh = useSubscription(comicLibrary().onChange, subscribeLocale)

  useEffect(() => {
    refresh()
  }, [])

  const library = comicLibrary()
  const favoriteCount = listFavorites().length
  const items = shelfItems(sort, filter)
  const historyCount = listProgress().length
  const offlineCount = library.offline.comicCount()

  return (
    <ZStack
      // 被推入的閱讀器蓋住時不會重繪；回來時重新讀一次書架。
      onAppear={() => refresh()}
    >
      <PageBackground />
      <ScrollView
        scrollContentBackground="hidden"
        navigationTitle={t("common.tabs.bookshelf")}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: <LeadingToolbar />,
          topBarTrailing: (
            // 跟左上角關閉鍵同色；只有篩選中才改用主題色，顏色就是「有東西被藏起來」的提示。
            <Menu
              title={t("bookshelf.sortMenu")}
              foregroundStyle={filter === "all" ? "label" : undefined}
              systemImage={
                filter === "all" ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill"
              }
            >
              <Menu title={t("bookshelf.sortGroup")}>
                {SORTS.map(option => (
                  <Button
                    key={option.value}
                    title={t(option.key)}
                    systemImage={sort === option.value ? "checkmark" : undefined}
                    action={() => setSort(option.value)}
                  />
                ))}
              </Menu>
              <Menu title={t("bookshelf.filterGroup")}>
                {FILTERS.map(option => (
                  <Button
                    key={option.value}
                    title={t(option.key)}
                    systemImage={filter === option.value ? "checkmark" : undefined}
                    action={() => setFilter(option.value)}
                  />
                ))}
              </Menu>
            </Menu>
          ),
        }}
        {...scrollTopBar(null)}
      >
        <VStack spacing={0}>
          <VStack padding={{ horizontal: pageInsets.horizontal, top: 8 }}>
            <Card>
              <NavigationLink destination={<HistoryScreen />}>
                <IconRow
                  icon="clock.arrow.circlepath"
                  title={t("bookshelf.historyTab")}
                  detail={historyCount > 0 ? t("bookshelf.comicCount", { n: historyCount }) : undefined}
                  chevron
                />
              </NavigationLink>
              <Divider padding={{ leading: rowSeparatorInset }} />
              <NavigationLink destination={<OfflineLibraryPage />}>
                <IconRow
                  icon="arrow.down.circle"
                  title={t("bookshelf.offlineTab")}
                  detail={
                    offlineCount > 0
                      ? `${t("bookshelf.comicCount", { n: offlineCount })} · ${formatBytes(library.offline.totalBytes())}`
                      : undefined
                  }
                  chevron
                />
              </NavigationLink>
            </Card>
          </VStack>

          {items.length > 0 ? (
            <ComicGridLayout
              entries={items.map(gridEntry)}
              menuItems={entry => (
                <Button
                  title={t("detail.unfavorite")}
                  role="destructive"
                  action={() => removeFavorite(entry.sourceKey, entry.comic.id)}
                />
              )}
            />
          ) : favoriteCount === 0 ? (
            <EmptyState
              variant="page"
              icon="heart"
              title={t("bookshelf.emptyFavoritesTitle")}
              detail={t("bookshelf.emptyFavoritesDetail")}
            />
          ) : (
            <EmptyState
              variant="page"
              icon="line.3.horizontal.decrease.circle"
              title={t("bookshelf.emptyFilteredTitle")}
              detail={t("bookshelf.emptyFilteredDetail")}
            />
          )}
        </VStack>
      </ScrollView>
    </ZStack>
  )
}
