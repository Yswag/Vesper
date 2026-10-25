// 閱讀歷史：從書架頂部的入口推進來。一本一張卡，點一下續讀，左滑刪除，長按可前往詳情。

import {
  Button,
  Group,
  LazyVStack,
  NamespaceReader,
  ProgressView,
  ScrollView,
  VStack,
  ZStack,
  useState,
} from "scripting"

import { comicLibrary } from "../../app/services"
import { PageBackground } from "../../app/theme"
import { useSubscription } from "../../app/useSubscription"
import { ComicListRow, LIST_COVER } from "../../components/ComicListRow"
import { scrollTopBar } from "../../design/glass"
import { Card } from "../../design/layout"
import { EmptyState } from "../../design/status"
import { cardShape, fill, palette, radius, rect } from "../../design/tokens"
import { subscribeOffline } from "../../engine/offline"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { clearProgress, listProgress, type Progress } from "../../library/bookshelf"
import { ComicDetailScreen } from "../shared/ComicDetailScreen"
import { launchResumeReader } from "../shared/ResumeReaderScreen"
import { canResumeOffline } from "../../app/offlineReading"
import { formatHistoryTime } from "./historyTime"

export function HistoryScreen() {
  // 長按「前往詳情」：推頁掛在這一層（不放進 Lazy 容器裡的列）。
  const [detailOf, setDetailOf] = useState<Progress | null>(null)
  const refresh = useSubscription(comicLibrary().onChange, subscribeOffline, subscribeLocale)
  const progress = listProgress()

  return (
    <ZStack onAppear={() => refresh()}>
      <PageBackground />
      <NamespaceReader>
        {historyNs => (
          <ScrollView
            scrollContentBackground="hidden"
            navigationTitle={t("bookshelf.historyTab")}
            navigationBarTitleDisplayMode="inline"
            {...scrollTopBar(null)}
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
            {progress.length === 0 ? (
              <EmptyState
                variant="page"
                icon="clock.arrow.circlepath"
                title={t("bookshelf.emptyHistoryTitle")}
                detail={t("bookshelf.emptyHistoryDetail")}
              />
            ) : (
              // 卡片的左滑要外層容器的 swipeActionsContainer（iOS 27）才生效。
              <LazyVStack spacing={12} padding={{ horizontal: 16, vertical: 12 }} swipeActionsContainer={true}>
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
        )}
      </NamespaceReader>
    </ZStack>
  )
}

/** 歷史列封面 → 詳情頁的 zoom 配對 id。 */
function historyZoomID(entry: Progress): string {
  return `history:${entry.sourceKey}:${entry.comicId}`
}

/** 閱讀歷史卡片：小封面 + 標題／來源·話數／頁數·時間。 */
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

  return (
    // 外層也裁成卡片形狀：滑動容器會在列的矩形範圍畫一層底，圓角外會露出方角。
    <VStack
      spacing={0}
      clipShape={cardShape}
      trailingSwipeActions={
        onDelete
          ? {
              allowsFullSwipe: false,
              actions: [
                <Button key="delete" title={t("common.delete")} systemImage="trash.fill" role="destructive" action={onDelete} />,
              ],
            }
          : undefined
      }
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
