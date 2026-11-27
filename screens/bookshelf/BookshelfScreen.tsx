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
  shelfSources,
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
    setValue(checkProgress.value)
    return checkProgress.subscribe(setValue)
  }, [])
  return value
}

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

function gridEntry(
  { favorite, progress, readFraction, removed, unreadCount, sameTitle, sourceName }: ShelfItem,
  removing: boolean,
  showSource: boolean
): ComicGridEntry {
  return {
    sourceKey: favorite.sourceKey,
    removed,
    coverSource: showSource && sameTitle ? sourceName : undefined,
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
  const [sourceFilter, setSourceFilter] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const checkingRef = useRef(false)
  const removal = useGridRemoval()

  const refresh = useSubscription(subscribeLocale)

  useEffect(
    () =>
      comicLibrary().onChange(() => {
        if (!checkingRef.current) refresh()
      }),
    []
  )

  const library = comicLibrary()
  const favoriteCount = shelfFavoriteCount()
  const sources = shelfSources()
  const activeSource: string | undefined = sources.some(source => source.sourceKey === sourceFilter)
    ? (sourceFilter ?? undefined)
    : undefined
  const items = shelfItems(sort, filter, activeSource)
  const offlineCount = library.offline.comicCount()
  const downloadingCount = library.offline.activeChapterCount()

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
      refresh()
    }
  }

  const isFiltered = filter !== "all" || activeSource !== undefined

  function removeFromShelf(sourceKey: string, comicId: string) {
    HapticFeedback.lightImpact()
    removal.remove(`${sourceKey}:${comicId}`, () => removeFavorite(sourceKey, comicId))
  }

  return (
    <ZStack
      onAppear={() => refresh()}
    >
      <PageBackground />
      <ScrollView
        scrollContentBackground="hidden"
        navigationTitle={t("common.tabs.bookshelf")}
        navigationBarTitleDisplayMode="inline"
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
              {sources.length > 1 ? (
                <Menu title={t("bookshelf.sourceGroup")}>
                  <Button
                    title={t("bookshelf.filterAll")}
                    systemImage={activeSource === undefined ? "checkmark" : undefined}
                    action={() => setSourceFilter(null)}
                  />
                  {sources.map(source => (
                    <Button
                      key={source.sourceKey}
                      title={source.name ?? t("bookshelf.sourceRemovedTitle")}
                      systemImage={activeSource === source.sourceKey ? "checkmark" : undefined}
                      action={() => setSourceFilter(source.sourceKey)}
                    />
                  ))}
                </Menu>
              ) : null}
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
                return gridEntry(item, removal.isRemoving(`${sourceKey}:${comicId}`), activeSource === undefined)
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
