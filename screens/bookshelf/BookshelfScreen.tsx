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
  useRef,
  useState,
} from "scripting"

import {
  shelfFavoriteCount,
  shelfItems,
  type ShelfFilter,
  type ShelfItem,
  type ShelfSort,
} from "../../app/shelf"
import { comicLibrary } from "../../app/services"
import { PageBackground, useTint } from "../../app/theme"
import { updatesScheduler } from "../../app/updates"
import { useSubscription } from "../../app/useSubscription"
import { ComicGridLayout, type ComicGridEntry } from "../../components/ComicGrid"
import { useGridRemoval } from "../../components/gridRemoval"
import { ExitToolbar } from "../../components/ExitToolbar"
import { scrollTopBar } from "../../design/glass"
import { Card } from "../../design/layout"
import { IconRow } from "../../design/rows"
import { EmptyState } from "../../design/status"
import { pageInsets } from "../../design/tokens"
import { formatBytes } from "../../engine/format"
import { subscribe as subscribeLocale, t, type MessageKey } from "../../i18n"
import { removeFavorite } from "../../library/bookshelf"
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

interface CheckProgress {
  done: number
  total: number
}

/**
 * 檢查更新的進度（null＝沒在跑）：純 JS 訊號，只有下面的進度條重繪。
 * 做法同 components/pageSignal.ts——`onProgress` 每完成一部就回報一次，
 * 不該讓整個書架跟著重跑一遍。
 */
function createCheckProgress() {
  let current: CheckProgress | null = null
  const listeners = new Set<(value: CheckProgress | null) => void>()
  return {
    get value() {
      return current
    },
    set(value: CheckProgress | null) {
      if (value === current) return
      if (value && current && value.done === current.done && value.total === current.total) return
      current = value
      for (const listener of listeners) listener(value)
    },
    subscribe(listener: (value: CheckProgress | null) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

const checkProgress = createCheckProgress()

function useCheckProgress(): CheckProgress | null {
  const [value, setValue] = useState<CheckProgress | null>(checkProgress.value)
  useEffect(() => {
    // 訂閱前可能已經變過（掛載與 effect 之間），先對齊一次。
    setValue(checkProgress.value)
    return checkProgress.subscribe(setValue)
  }, [])
  return value
}

/** 檢查更新的進度條：自己訂閱訊號，書架本體只留「有沒有在檢查」。 */
function CheckingUpdates() {
  const progress = useCheckProgress()
  if (!progress || progress.total <= 0) return null
  return (
    <VStack spacing={6} padding={{ horizontal: pageInsets.horizontal, bottom: 4 }}>
      <ProgressView value={progress.done / progress.total} progressViewStyle="linear" />
      <Text font="caption2" foregroundStyle="secondaryLabel" monospacedDigit>
        {t("bookshelf.checkingUpdates", { done: progress.done, total: progress.total })}
      </Text>
    </VStack>
  )
}

function gridEntry({ favorite, progress, readFraction, removed, unreadCount }: ShelfItem, removing: boolean): ComicGridEntry {
  return {
    sourceKey: favorite.sourceKey,
    removed,
    removing,
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
  /** 有沒有在跑手動檢查（進度由 CheckingUpdates 自己訂閱，不放進這裡）。 */
  const [checking, setChecking] = useState(false)
  const checkingRef = useRef(false)
  /** 移除收藏：那一格先退場，演完才真的從書架刪掉（見 components/gridRemoval.ts）。 */
  const removal = useGridRemoval()

  const refresh = useSubscription(subscribeLocale)

  // 源清單、書架（收藏／歷史／追更）與離線層一變就重繪（`onChange` 已含離線層與書架）。
  // 檢查更新期間先壓住：每完成一部都會通知書庫，書架本體不必跟著跑（結束時 refresh 一次）。
  useEffect(
    () =>
      comicLibrary().onChange(() => {
        if (!checkingRef.current) refresh()
      }),
    []
  )

  const library = comicLibrary()
  const favoriteCount = shelfFavoriteCount()
  const items = shelfItems(sort, filter)
  const offlineCount = library.offline.comicCount()
  const downloadingCount = library.offline.activeChapterCount()

  /**
   * 下拉：無視 TTL 重查一輪。背景剛好在跑就接管它（見 app/updates.ts）：
   * 不重啟、不重複連線，只是把並行升到前台速度並把進度接到這裡。
   */
  async function checkUpdates() {
    if (checkingRef.current) return
    checkingRef.current = true
    checkProgress.set({ done: 0, total: favoriteCount })
    setChecking(true)
    try {
      await updatesScheduler().checkUpdates({
        force: true,
        onProgress: (done, total) => checkProgress.set({ done, total }),
      })
    } finally {
      checkingRef.current = false
      checkProgress.set(null)
      setChecking(false)
      // 檢查期間壓住的變更（每一部的追更紀錄）在這裡一次反映，角標才是新的。
      refresh()
    }
  }

  const isFiltered = filter !== "all"

  function removeFromShelf(sourceKey: string, comicId: string) {
    HapticFeedback.lightImpact()
    removal.remove(`${sourceKey}:${comicId}`, () => removeFavorite(sourceKey, comicId))
  }

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
          topBarLeading: <ExitToolbar />,
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

          {checking ? <CheckingUpdates /> : null}

          {items.length > 0 ? (
            <ComicGridLayout
              entries={items.map(item => {
                const { sourceKey, comicId } = item.favorite
                return gridEntry(item, removal.isRemoving(`${sourceKey}:${comicId}`))
              })}
              menuItems={entry => (
                <Button
                  title={t("detail.unfavorite")}
                  role="destructive"
                  action={() => removeFromShelf(entry.sourceKey, entry.comic.id)}
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
