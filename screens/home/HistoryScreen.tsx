import {
  Button,
  LazyVStack,
  NamespaceReader,
  ProgressView,
  ScrollView,
  VStack,
  ZStack,
  useState,
} from "scripting"

import { resumeEntry } from "../../app/shelf"
import { comicLibrary } from "../../app/services"
import { PageBackground } from "../../app/theme"
import { useSubscription } from "../../app/useSubscription"
import { ComicListRow, LIST_COVER } from "../../components/ComicListRow"
import { scrollTopBar } from "../../design/glass"
import { Card } from "../../design/layout"
import { EmptyState } from "../../design/status"
import { cardShape, fill, palette, radius, rect } from "../../design/tokens"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { clearProgress, listProgress, type Progress } from "../../library/bookshelf"
import { canOpenComicDetail, progressDetailDestination, ProgressMenuItems, progressZoomID } from "../shared/progressActions"
import { launchResumeReader } from "../shared/ResumeReaderScreen"
import { formatHistoryTime } from "./historyTime"

export function HistoryScreen() {
  const [detailOf, setDetailOf] = useState<Progress | null>(null)
  const refresh = useSubscription(comicLibrary().onChange, subscribeLocale)
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
            navigationDestination={progressDetailDestination({
              entry: detailOf,
              onDismiss: () => setDetailOf(null),
              zoomNamespace: historyNs,
            })}
          >
            {progress.length === 0 ? (
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

export function HistoryCard({
  entry,
  onDelete,
  onOpenDetail,
  zoomNamespace,
}: {
  entry: Progress
  onDelete?: () => void
  onOpenDetail?: () => void
  zoomNamespace?: NamespaceID
}) {
  const shown = resumeEntry(entry)
  const sourceName = shown.sourceName ?? (shown.source === "offlineOnly" ? null : t("bookshelf.sourceRemovedTitle"))
  const [opening, setOpening] = useState(false)
  const meta = [
    shown.offline ? t("common.offlineTag") : null,
    sourceName,
    shown.openable ? entry.epTitle || t("bookshelf.lastRead") : null,
  ]
    .filter(Boolean)
    .join(" · ")
  const pageLabel = shown.pageLabel
    ? shown.pageLabel.total !== undefined
      ? t("bookshelf.pageOfTotal", { page: shown.pageLabel.page, total: shown.pageLabel.total })
      : t("bookshelf.pageOf", { page: shown.pageLabel.page })
    : null
  const barValue = shown.openable ? (shown.readFraction ?? null) : null
  const detail = shown.openable ? [pageLabel, formatHistoryTime(entry.updatedAt)].filter(Boolean).join(" · ") : null

  const body = (
    <Card>
      <ComicListRow
        sourceKey={entry.sourceKey}
        cover={entry.cover}
        title={entry.title}
        subtitle={meta}
        subtitleColor={shown.openable ? "secondaryLabel" : palette.red}
        detail={detail}
        coverTransition={zoomNamespace ? { id: progressZoomID(entry), namespace: zoomNamespace } : undefined}
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

  const row = shown.openable ? (
    <Button
      buttonStyle="plain"
      disabled={opening}
      action={() => {
        setOpening(true)
        void launchResumeReader({ sourceKey: entry.sourceKey, comicId: entry.comicId }).finally(() => {
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

  const canOpenDetail = onOpenDetail !== undefined && canOpenComicDetail(shown)
  if (!onDelete && !canOpenDetail) return row

  return (
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
          <ProgressMenuItems onOpenDetail={canOpenDetail ? onOpenDetail : undefined} onDelete={onDelete} />
        ),
      }}
    >
      {row}
    </VStack>
  )
}
