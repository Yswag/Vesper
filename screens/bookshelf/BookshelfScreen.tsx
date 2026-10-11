// 書架：閱讀紀錄 + 收藏 + 離線內容。
// 支援 segmented picker 切換「收藏庫」、「歷史紀錄」與「離線內容」，並支援 3 欄海報網格與列表視圖。
// 離線分頁內嵌 OfflineLibraryScreen（純內容，共用這一頁的捲動區）。

import {
  Button,
  HStack,
  LazyVStack,
  NavigationLink,
  ProgressView,
  RoundedRectangle,
  ScrollView,
  Text,
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
import { GlassFilter } from "../../design/GlassFilter"
import { Chevron } from "../../design/rows"
import { EmptyState } from "../../design/status"
import { cardBackground, fill, hairlineStroke, radius, rect, rowPadding } from "../../design/tokens"
import { CoverImage } from "../../components/CoverImage"
import {
  clearProgress,
  listFavorites,
  listProgress,
  type Favorite,
  type Progress,
} from "../../library/bookshelf"
import { launchResumeReader } from "../shared/ResumeReaderScreen"
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
                  sourceName: source?.name ?? t("bookshelf.sourceRemoved"),
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
  const sourceName = source?.name ?? t("bookshelf.sourceRemovedTitle")
  const [opening, setOpening] = useState(false)
  const meta = source ? `${sourceName} · ${entry.epTitle || t("bookshelf.lastRead")}` : sourceName
  const pageLabel =
    entry.page === undefined
      ? null
      : entry.pageCount && entry.pageCount > 1
        ? t("bookshelf.pageOfTotal", { page: entry.page + 1, total: entry.pageCount })
        : t("bookshelf.pageOf", { page: entry.page + 1 })
  const barValue =
    source && entry.page !== undefined && entry.pageCount && entry.pageCount > 1
      ? Math.min((entry.page + 1) / entry.pageCount, 1)
      : null
  // 兩段都可能沒有（沒有頁碼的舊資料／時間解析不出來），所以還是「有值的才接」；分隔號是標點。
  const detail = source
    ? [pageLabel, formatHistoryTime(entry.updatedAt)].filter(Boolean).join(" · ")
    : null

  const body = (
    <HStack
      spacing={14}
      padding={rowPadding}
      background={cardBackground}
      clipShape={rect(radius.card)}
      shadow={{ color: "rgba(0, 0, 0, 0.28)", radius: 10, x: 0, y: 3 }}
      overlay={
        <RoundedRectangle
          cornerRadius={radius.card}
          stroke={hairlineStroke}
        />
      }
    >
      {/* 封面縮圖（帶立體微陰影與細圓角） */}
      <ZStack
        frame={{ width: 56, height: 80 }}
        shadow={{ color: "rgba(0, 0, 0, 0.4)", radius: 6, x: 0, y: 3 }}
      >
        <CoverImage
          sourceKey={entry.sourceKey}
          url={entry.cover}
          width={56}
          height={80}
          cornerRadius={radius.cover}
        />
        {opening ? (
          <ZStack
            frame={{ width: 56, height: 80 }}
            background="rgba(0, 0, 0, 0.45)"
            clipShape={rect(radius.cover)}
            alignment="center"
          >
            <ProgressView controlSize="small" />
          </ZStack>
        ) : null}
      </ZStack>

      {/* 右側文字資訊 */}
      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity" }}>
        <Text
          font="subheadline"
          fontWeight="semibold"
          foregroundStyle="label"
          lineLimit={1}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          {entry.title}
        </Text>

        <Text
          font="caption"
          foregroundStyle={source ? "secondaryLabel" : "systemRed"}
          lineLimit={1}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          {meta}
        </Text>

        {detail ? (
          <Text
            font="caption2"
            foregroundStyle="tertiaryLabel"
            lineLimit={1}
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            {detail}
          </Text>
        ) : null}

        {barValue !== null ? (
          <ProgressView value={barValue} total={1} frame={{ maxWidth: "infinity" }} />
        ) : null}
      </VStack>

      <Chevron />
    </HStack>
  )

  const row = source ? (
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
