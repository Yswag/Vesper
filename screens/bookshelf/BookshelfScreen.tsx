// 書架：閱讀紀錄 + 收藏 + 離線內容。
// 支援 segmented picker 切換「收藏庫」、「歷史紀錄」與「離線內容」，並支援 3 欄海報網格與列表視圖。
// 離線分頁內嵌 OfflineLibraryScreen（純內容，共用這一頁的捲動區）。

import {
  Button,
  LazyVStack,
  ProgressView,
  ScrollView,
  VStack,
  ZStack,
  useEffect,
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
import {
  clearProgress,
  listFavorites,
  listProgress,
  type Favorite,
  type Progress,
} from "../../library/bookshelf"
import { launchResumeReader } from "../shared/ResumeReaderScreen"
import { canResumeOffline } from "../shared/offlineSession"
import { OfflineLibraryScreen } from "./OfflineLibraryScreen"
import { formatHistoryTime } from "./historyTime"
import { comicCount, subscribeOffline } from "../../engine/offline"
import { PageBackground } from "../../app/theme"

export function BookshelfScreen() {
  const [tab, setTab] = useState<"favorites" | "history" | "offline">("favorites")

  // 源清單、書架（收藏／歷史）與離線層一變就重繪；回傳的 refresh 給 onAppear 用。
  // 語言是第三個訂閱源：三個分頁與每一列的字都在 render 時取自 `t()`（子元件跟著重繪）。
  const refresh = useSubscription(comicLibrary().onChange, subscribeOffline, subscribeLocale)

  useEffect(() => {
    refresh()
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
      <VStack
        spacing={0}
        navigationTitle={t("common.tabs.bookshelf")}
        navigationBarTitleDisplayMode="inline"
        toolbar={{ topBarLeading: <LeadingToolbar /> }}
      >
      <VStack padding={{ horizontal: 16, vertical: 8 }}>
        <GlassFilter
          title={t("bookshelf.pickerLabel")}
          value={tab}
          onChanged={setTab}
          options={[
            { value: "favorites", title: t("bookshelf.favoritesCount", { n: favorites.length }) },
            { value: "history", title: t("bookshelf.historyCount", { n: progress.length }) },
            { value: "offline", title: t("bookshelf.offlineCount", { n: offlineCount }) },
          ]}
        />
      </VStack>

      <ScrollView scrollContentBackground="hidden">
        {tab === "favorites" ? (
          favorites.length === 0 ? (
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
            />
          )
        ) : tab === "offline" ? (
          <OfflineLibraryScreen />
        ) : progress.length === 0 ? (
          <EmptyState
            variant="page"
            icon="clock.arrow.circlepath"
            title={t("bookshelf.emptyHistoryTitle")}
            detail={t("bookshelf.emptyHistoryDetail")}
          />
          ) : (
            <LazyVStack spacing={12} padding={{ horizontal: 16, vertical: 12 }} swipeActionsContainer={true}>
              {progress.map(entry => (
                <HistoryCard
                  key={`${entry.sourceKey}:${entry.comicId}`}
                  entry={entry}
                  onDelete={() => clearProgress(entry.sourceKey, entry.comicId)}
                />
              ))}
            </LazyVStack>
          )}
      </ScrollView>
    </VStack>
  </ZStack>
  )
}

/** 閱讀歷史卡片：小封面 + 標題／來源·話數／頁數·時間，右側箭頭。 */
export function HistoryCard({ entry, onDelete }: { entry: Progress; onDelete?: () => void }) {
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

  if (!onDelete) return row

  // 左滑刪除：靠外層容器的 swipeActionsContainer（iOS 27）才對自訂列生效。
  return (
    <VStack
      spacing={0}
      trailingSwipeActions={{
        allowsFullSwipe: true,
        actions: [
          <Button
            key="delete"
            title={t("common.delete")}
            systemImage="trash"
            role="destructive"
            action={onDelete}
          />,
        ],
      }}
    >
      {row}
    </VStack>
  )
}
