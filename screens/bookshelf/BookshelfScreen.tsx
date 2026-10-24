// 書架：閱讀紀錄 + 收藏 + 離線內容。
// 三個分區用 TabView 左右滑換頁，上方 segmented picker 雙向同步；收藏是 3 欄海報網格，歷史是列表。
// 離線分頁內嵌 OfflineLibraryScreen（純內容，自己帶捲動區）。
// 刪除放長按選單、不給左滑：列上有左滑動作時，左滑會被它搶走，翻不了頁。

import {
  Button,
  Group,
  LazyVStack,
  NamespaceReader,
  ProgressView,
  ScrollView,
  TabView,
  VStack,
  ZStack,
  useEffect,
  useObservable,
  useState,
} from "scripting"

import { ComicGridLayout } from "../../components/ComicGrid"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { LeadingToolbar } from "../../components/LeadingToolbar"
import { Card } from "../../design/layout"
import { GlassFilter } from "../../design/GlassFilter"
import { EmptyState } from "../../design/status"
import { fill, palette, radius, rect } from "../../design/tokens"
import { ComicListRow, LIST_COVER } from "../../components/ComicListRow"
import { ComicDetailScreen } from "../shared/ComicDetailScreen"
import {
  clearProgress,
  listFavorites,
  listProgress,
  removeFavorite,
  type Favorite,
  type Progress,
} from "../../library/bookshelf"
import { launchResumeReader } from "../shared/ResumeReaderScreen"
import { canResumeOffline } from "../shared/offlineSession"
import { OfflineLibraryScreen } from "./OfflineLibraryScreen"
import { formatHistoryTime } from "./historyTime"
import { comicCount, subscribeOffline } from "../../engine/offline"
import { PageBackground } from "../../app/theme"

type BookshelfTab = "favorites" | "history" | "offline"

export function BookshelfScreen() {
  // TabView 的翻頁狀態是 Observable，picker 的值是 state：兩邊互相回寫（見下面的訂閱）。
  const selection = useObservable<string>("favorites")
  const [tab, setTab] = useState<BookshelfTab>("favorites")
  // 歷史列長按「前往詳情」：推頁掛在這一層（不放進 Lazy 容器裡的列）。
  const [detailOf, setDetailOf] = useState<Progress | null>(null)

  // 源清單、書架（收藏／歷史）與離線層一變就重繪；回傳的 refresh 給 onAppear 用。
  // 語言是第三個訂閱源：三個分頁與每一列的字都在 render 時取自 `t()`（子元件跟著重繪）。
  const refresh = useSubscription(comicLibrary().onChange, subscribeOffline, subscribeLocale)

  useEffect(() => {
    refresh()
  }, [])

  // 左右滑只動 selection：回寫 state，上方 picker 才跟著換。
  useEffect(() => {
    const listener = (value: string) => setTab(value as BookshelfTab)
    selection.subscribe(listener)
    return () => selection.unsubscribe(listener)
  }, [])

  const progress = listProgress()
  const favorites = listFavorites()
  const offlineCount = comicCount()

  return (
    <ZStack
      // 分頁被推入的閱讀器蓋住時不會重繪；回來時重新讀一次書架，
      // 否則收藏／歷史會停在進閱讀器前的舊資料。
      onAppear={() => refresh()}
    >
      <PageBackground />
      <NamespaceReader>
        {historyNs => (
      <VStack
        spacing={0}
        navigationTitle={t("common.tabs.bookshelf")}
        navigationBarTitleDisplayMode="inline"
        toolbar={{ topBarLeading: <LeadingToolbar /> }}
        navigationDestination={{
          content: detailOf ? (
            // key 跟著漫畫換：同一個推頁位置會沿用上一本的狀態，先閃一下舊的詳情。
            <ComicDetailScreen
              key={`${detailOf.sourceKey}:${detailOf.comicId}`}
              sourceKey={detailOf.sourceKey}
              comicId={detailOf.comicId}
              title={detailOf.title}
              zoomTransition={{ sourceID: historyZoomID(detailOf), namespace: historyNs }}
            />
          ) : (
            <VStack />
          ),
          isPresented: detailOf !== null,
          onChanged: presented => {
            if (!presented) setDetailOf(null)
          },
        }}
      >
        <VStack padding={{ horizontal: 16, vertical: 8 }}>
          <GlassFilter
            title={t("bookshelf.pickerLabel")}
            value={tab}
            onChanged={(value: BookshelfTab) => {
              setTab(value)
              // 點選擇器：selection 一變 TabView 就翻頁（帶動畫）。
              withAnimation(() => selection.setValue(value))
            }}
            options={[
              { value: "favorites", title: t("bookshelf.favoritesCount", { n: favorites.length }) },
              { value: "history", title: t("bookshelf.historyCount", { n: progress.length }) },
              { value: "offline", title: t("bookshelf.offlineCount", { n: offlineCount }) },
            ]}
          />
        </VStack>

        {/* 每一頁各自一個捲動區：三頁的捲動位置互不影響。翻頁容器預設停在 tab bar 上緣，延伸到底下才跟其他 tab 一樣。 */}
        <TabView selection={selection} tabViewStyle="pageNeverDisplayIndex" ignoresSafeArea={{ edges: "bottom" }}>
          <VStack tag="favorites">
            <ScrollView scrollContentBackground="hidden">
              {favorites.length === 0 ? (
                <EmptyState
                  variant="page"
                  icon="heart"
                  title={t("bookshelf.emptyFavoritesTitle")}
                  detail={t("bookshelf.emptyFavoritesDetail")}
                />
              ) : (
                <ComicGridLayout
                  entries={favorites.map(item => {
                    const source = comicLibrary().source(item.sourceKey)
                    return {
                      sourceKey: item.sourceKey,
                      sourceName: source?.name,
                      removed: source === undefined,
                      comic: {
                        id: item.comicId,
                        title: item.title,
                        cover: item.cover,
                        tags: [],
                      },
                    }
                  })}
                  showSource={true}
                  menuItems={entry => (
                    <Button
                      title={t("detail.unfavorite")}
                      role="destructive"
                      action={() => removeFavorite(entry.sourceKey, entry.comic.id)}
                    />
                  )}
                />
              )}
            </ScrollView>
          </VStack>
          <VStack tag="history">
            <ScrollView scrollContentBackground="hidden">
              {progress.length === 0 ? (
                <EmptyState
                  variant="page"
                  icon="clock.arrow.circlepath"
                  title={t("bookshelf.emptyHistoryTitle")}
                  detail={t("bookshelf.emptyHistoryDetail")}
                />
              ) : (
                <LazyVStack spacing={12} padding={{ horizontal: 16, vertical: 12 }}>
                  {progress.map(entry => (
                    <HistoryCard
                      key={`${entry.sourceKey}:${entry.comicId}`}
                      entry={entry}
                      onDelete={() => clearProgress(entry.sourceKey, entry.comicId)}
                      onOpenDetail={() => setDetailOf(entry)}
                      zoomNamespace={historyNs}
                    />
                  ))}
                </LazyVStack>
              )}
            </ScrollView>
          </VStack>
          <VStack tag="offline">
            <ScrollView scrollContentBackground="hidden">
              <OfflineLibraryScreen />
            </ScrollView>
          </VStack>
        </TabView>
      </VStack>
        )}
      </NamespaceReader>
    </ZStack>
  )
}

/** 閱讀歷史卡片：小封面 + 標題／來源·話數／頁數·時間，右側箭頭。 */
/** 歷史列封面 → 詳情頁的 zoom 配對 id。 */
function historyZoomID(entry: Progress): string {
  return `history:${entry.sourceKey}:${entry.comicId}`
}

export function HistoryCard({
  entry,
  onDelete,
  onOpenDetail,
  zoomNamespace,
}: {
  entry: Progress
  onDelete?: () => void
  /** 長按選單的「前往詳情」；源不在了就不給（詳情頁要源）。 */
  onOpenDetail?: () => void
  /** 給了就把封面當 zoom 來源（跟收藏網格推詳情一樣）。 */
  zoomNamespace?: NamespaceID
}) {
  const source = comicLibrary().source(entry.sourceKey)
  // 判斷是否可走離線續讀；若無離線則退回線上來源開啟
  const offline = canResumeOffline(
    { sourceKey: entry.sourceKey, comicId: entry.comicId, epId: entry.epId },
    entry.offline
  )
  const openable = source !== undefined || offline
  // 源被移除時，還有離線內容就只顯示「離線」——內容就在手機上，那筆紀錄不該是紅字「來源已移除」。
  const sourceName = source?.name ?? (offline ? null : t("bookshelf.sourceRemovedTitle"))
  const [opening, setOpening] = useState(false)
  const meta = [
    offline ? t("common.offlineTag") : null,
    sourceName,
    openable ? entry.epTitle || t("bookshelf.lastRead") : null,
  ]
    .filter(Boolean)
    .join(" · ")
  const pageLabel =
    entry.page === undefined
      ? null
      : entry.pageCount && entry.pageCount > 1
        ? t("bookshelf.pageOfTotal", { page: entry.page + 1, total: entry.pageCount })
        : t("bookshelf.pageOf", { page: entry.page + 1 })
  const barValue =
    openable && entry.page !== undefined && entry.pageCount && entry.pageCount > 1
      ? Math.min((entry.page + 1) / entry.pageCount, 1)
      : null
  // 兩段都可能沒有（沒有頁碼的舊資料／時間解析不出來），所以還是「有值的才接」；分隔號是標點。
  const detail = openable ? [pageLabel, formatHistoryTime(entry.updatedAt)].filter(Boolean).join(" · ") : null

  const body = (
    <Card>
      <ComicListRow
        sourceKey={entry.sourceKey}
        cover={entry.cover}
        title={entry.title}
        subtitle={meta}
        subtitleColor={openable ? "secondaryLabel" : palette.red}
        detail={detail}
        coverTransition={zoomNamespace ? { id: historyZoomID(entry), namespace: zoomNamespace } : undefined}
        footer={barValue !== null ? <ProgressView value={barValue} total={1} frame={{ maxWidth: "infinity" }} /> : undefined}
        coverOverlay={
          opening ? (
            <ZStack frame={LIST_COVER} background={fill.coverScrim} clipShape={rect(radius.md)} alignment="center">
              <ProgressView controlSize="small" />
            </ZStack>
          ) : undefined
        }
      />
    </Card>
  )

  const row = openable ? (
    <Button
      buttonStyle="plain"
      disabled={opening}
      action={() => {
        setOpening(true)
        void launchResumeReader({
          sourceKey: entry.sourceKey,
          comicId: entry.comicId,
          epId: entry.epId,
          page: entry.page,
          title: entry.title,
          cover: entry.cover,
        }).finally(() => {
          setOpening(false)
        })
      }}
      frame={{ maxWidth: "infinity" }}
    >
      {body}
    </Button>
  ) : (
    body
  )

  const canOpenDetail = onOpenDetail !== undefined && source !== undefined
  if (!onDelete && !canOpenDetail) return row

  // 動作放長按選單、不給左滑：這一頁在左右滑翻頁的容器裡，左滑會被列的動作搶走。
  return (
    <VStack
      spacing={0}
      contextMenu={{
        menuItems: (
          <Group>
            {canOpenDetail ? <Button title={t("bookshelf.openDetail")} action={onOpenDetail} /> : null}
            {onDelete ? <Button title={t("common.delete")} role="destructive" action={onDelete} /> : null}
          </Group>
        ),
      }}
    >
      {row}
    </VStack>
  )
}
