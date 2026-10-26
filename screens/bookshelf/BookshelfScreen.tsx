// 書架：上面一列離線內容入口（沒有下載就不出現；閱讀歷史在首頁「繼續閱讀」標題）、顯示範圍的膠囊列，下面是收藏網格。
// 整頁一個直向捲動區，導覽列才有柔和淡出、tab bar 才會跟著捲動縮放（見 design/LANGUAGE.md）。
// 收藏格子接上閱讀紀錄：狀態行寫讀到哪一話，封面下的進度條是那一話讀到哪，
// 右上的數字膠囊是還沒讀的章數（追更快取 × 已讀清單）。下拉則手動跑一輪追更檢查。

import {
  Button,
  Image,
  Menu,
  NavigationLink,
  ProgressView,
  ScrollView,
  Text,
  VStack,
  ZStack,
  useEffect,
  useState,
} from "scripting"

import { shelfItems, type ShelfFilter, type ShelfItem, type ShelfSort } from "../../app/shelf"
import { comicLibrary } from "../../app/services"
import { PageBackground, useTint } from "../../app/theme"
import { updatesScheduler } from "../../app/updates"
import { useSubscription } from "../../app/useSubscription"
import { ComicGridLayout, type ComicGridEntry } from "../../components/ComicGrid"
import { LeadingToolbar } from "../../components/LeadingToolbar"
import { scrollTopBar } from "../../design/glass"
import { Card } from "../../design/layout"
import { IconRow } from "../../design/rows"
import { EmptyState } from "../../design/status"
import { pageInsets } from "../../design/tokens"
import { formatBytes } from "../../engine/format"
import { subscribe as subscribeLocale, t, type MessageKey } from "../../i18n"
import { listFavorites, removeFavorite } from "../../library/bookshelf"
import { OfflineLibraryPage } from "./OfflineLibraryScreen"

const SORTS: { value: ShelfSort; key: MessageKey }[] = [
  { value: "recent", key: "bookshelf.sortRecent" },
  { value: "added", key: "bookshelf.sortAdded" },
  { value: "title", key: "bookshelf.sortTitle" },
]
const FILTERS: { value: ShelfFilter; key: MessageKey }[] = [
  { value: "all", key: "bookshelf.filterAll" },
  { value: "updates", key: "bookshelf.filterUpdates" },
  { value: "read", key: "bookshelf.filterRead" },
  { value: "unread", key: "bookshelf.filterUnread" },
]

function gridEntry({ favorite, progress, readFraction, removed, unreadCount }: ShelfItem): ComicGridEntry {
  return {
    sourceKey: favorite.sourceKey,
    removed,
    readFraction,
    unreadCount,
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
  const tint = useTint()
  const [sort, setSort] = useState<ShelfSort>("recent")
  const [filter, setFilter] = useState<ShelfFilter>("all")
  /** 手動檢查的進度（null＝沒在跑，進度列不出現）。 */
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null)

  // 源清單、書架（收藏／歷史／追更）、離線層與語言一變就重繪（`onChange` 已含離線層與書架）；回傳的 refresh 給 onAppear 用。
  const refresh = useSubscription(comicLibrary().onChange, subscribeLocale)

  useEffect(() => {
    refresh()
  }, [])

  const library = comicLibrary()
  const favoriteCount = listFavorites().length
  const items = shelfItems(sort, filter)
  const offlineCount = library.offline.comicCount()
  const downloadingCount = library.offline.activeChapterCount()

  /**
   * 下拉：無視 TTL 重查一輪。背景剛好在跑就接管它（見 app/updates.ts）：
   * 不重啟、不重複連線，只是把並行升到前台速度並把進度接到這裡。
   */
  async function checkUpdates() {
    if (checking) return
    setChecking({ done: 0, total: favoriteCount })
    try {
      await updatesScheduler().checkUpdates({
        force: true,
        onProgress: (done, total) => setChecking({ done, total }),
      })
    } finally {
      setChecking(null)
      refresh()
    }
  }

  const isFiltered = filter !== "all"

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
        // iOS 自己會顯示轉圈；檢查的進度另外寫在膠囊列下面。
        refreshable={checkUpdates}
        toolbar={{
          topBarLeading: <LeadingToolbar />,
          topBarTrailing: (
            <Menu
              label={
                <Image
                  systemName={isFiltered ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"}
                  font="body"
                  fontWeight="medium"
                  foregroundStyle={isFiltered ? tint.tint : "label"}
                />
              }
            >
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
            </Menu>
          ),
        }}
        {...scrollTopBar(null)}
      >
        <VStack spacing={0}>
          {offlineCount > 0 || downloadingCount > 0 ? (
            <VStack padding={{ horizontal: pageInsets.horizontal, top: 8 }}>
              <Card>
                <NavigationLink destination={<OfflineLibraryPage />}>
                  <IconRow
                    icon="arrow.down.circle"
                    title={t("bookshelf.offlineTab")}
                    detail={[
                      offlineCount > 0 ? t("bookshelf.comicCount", { n: offlineCount }) : null,
                      downloadingCount > 0
                        ? t("bookshelf.downloadingCount", { n: downloadingCount })
                        : formatBytes(library.offline.totalBytes()),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    chevron
                  />
                </NavigationLink>
              </Card>
            </VStack>
          ) : null}

          {checking && checking.total > 0 ? (
            <VStack spacing={6} padding={{ horizontal: pageInsets.horizontal, bottom: 4 }}>
              <ProgressView
                value={checking.done / checking.total}
                progressViewStyle="linear"
              />
              <Text font="caption2" foregroundStyle="secondaryLabel" monospacedDigit>
                {t("bookshelf.checkingUpdates", { done: checking.done, total: checking.total })}
              </Text>
            </VStack>
          ) : null}

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
          ) : filter === "updates" ? (
            <EmptyState
              variant="page"
              icon="arrow.triangle.2.circlepath"
              title={t("bookshelf.emptyUpdatesTitle")}
              detail={t("bookshelf.emptyUpdatesDetail")}
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
