// 離線漫畫：從書架的離線分頁推入，只寫離線層看得到的章節。
//
// 順序＝manifest 的下載時間正序（跟 `chaptersForReader` 給閱讀器換話的順序同一個）：
// 離線層沒有記源原本的章節索引，這是唯一能排的順序。
//
// 繼續閱讀：有進度且那一章下載完 → 從那一章那一頁開；否則開第一個下載完的章。

import { Button, HStack, Image, LazyVStack, NavigationLink, ProgressView, Spacer, Text, VStack } from "scripting"

import type { ChapterDownloadState } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useTint } from "../../app/theme"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { CoverImage } from "../../components/CoverImage"
import { Card, PageScroll } from "../../design/layout"
import { Chevron } from "../../design/rows"
import { EmptyState } from "../../design/status"
import { Tag } from "../../design/Tag"
import { cardGap, cardShape, fill, radius, rect, rowPadding, tagText } from "../../design/tokens"
import { formatBytes } from "../../engine/format"
import { chaptersForReader, listChapters, statusOf, type OfflineChapter } from "../../engine/offline"
import { HERO_ASPECT } from "../shared/comicMetrics"
import { ReaderScreen } from "../shared/ReaderScreen"

/** 縮小版 hero：詳情頁封面 124 寬，這裡小一號。 */
const HERO_COVER = { width: 96, height: Math.round(96 * HERO_ASPECT) }

/** 一部漫畫的離線章節，照閱讀順序（下載時間正序）。 */
function chaptersOf(sourceKey: string, comicId: string): OfflineChapter[] {
  return listChapters()
    .filter(chapter => chapter.key.sourceKey === sourceKey && chapter.key.comicId === comicId)
    .sort((a, b) => a.updatedAt - b.updatedAt)
}

function titleOf(chapter: OfflineChapter): string {
  return chapter.epTitle ?? chapter.key.epId
}

export function OfflineComicScreen({
  sourceKey,
  comicId,
  title,
  cover,
}: {
  sourceKey: string
  comicId: string
  /** 推入時手上有（清單算好的）就用，沒有才從 manifest 找。 */
  title?: string
  cover?: string
}) {
  const library = comicLibrary()
  // 下載進度、刪除、書架進度都會讓這裡重繪（`onChange` 已含離線層）；語言也是訂閱源。
  useSubscription(library.onChange, subscribeLocale)

  const chapters = chaptersOf(sourceKey, comicId)
  const rows = chapters.map(chapter => ({ chapter, state: library.downloadState(chapter.key) }))
  const comicTitle = title ?? chapters.find(chapter => chapter.comicTitle)?.comicTitle ?? t("bookshelf.unknownComic")
  const comicCover = cover ?? chapters.find(chapter => chapter.cover)?.cover
  const sourceName = library.source(sourceKey)?.name ?? t("bookshelf.sourceRemoved")
  const doneCount = rows.filter(row => row.state.state === "done").length
  const bytes = chapters.reduce((sum, chapter) => sum + statusOf(chapter.key).bytes, 0)

  const resume = library.resume({ sourceKey, comicId })
  const resumeEpId = resume?.chapter.epId
  const resumeRow = resumeEpId
    ? rows.find(row => row.chapter.key.epId === resumeEpId && row.state.state === "done")
    : undefined
  const target = resumeRow ?? rows.find(row => row.state.state === "done")
  const targetPage = resume && resumeRow ? resume.page : undefined

  async function deleteChapter(chapter: OfflineChapter) {
    const confirmed = await Dialog.confirm({
      title: t("common.delete"),
      message: t("bookshelf.deleteChapterConfirm", { chapter: titleOf(chapter) }),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
    })
    if (!confirmed) return
    library.deleteDownload(chapter.key)
  }

  // 刪光了就留在這一頁說清楚（沒有可用的 pop；回上一頁是使用者的手勢）。
  if (rows.length === 0) {
    return (
      <PageScroll title={comicTitle}>
        <EmptyState
          variant="page"
          icon="arrow.down.circle"
          title={t("bookshelf.emptyOfflineTitle")}
          detail={t("bookshelf.emptyOfflineDetail")}
        />
      </PageScroll>
    )
  }

  return (
    <PageScroll title={comicTitle}>
      <HStack spacing={16} alignment="top" frame={{ maxWidth: "infinity" }}>
        <CoverImage
          sourceKey={sourceKey}
          url={comicCover}
          title={comicTitle}
          width={HERO_COVER.width}
          height={HERO_COVER.height}
          cornerRadius={radius.md}
          lifted={true}
        />
        <VStack
          alignment="leading"
          spacing={8}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
          fixedSize={{ horizontal: false, vertical: true }}
        >
          <Text
            font="title3"
            fontWeight="bold"
            lineLimit={3}
            multilineTextAlignment="leading"
            fixedSize={{ horizontal: false, vertical: true }}
          >
            {comicTitle}
          </Text>
          <HStack spacing={6}>
            <Tag text={sourceName} />
            <Tag
              text={t("bookshelf.chapterStats", {
                done: doneCount,
                total: rows.length,
                n: rows.length,
                size: formatBytes(bytes),
              })}
            />
          </HStack>
        </VStack>
      </HStack>

      {target ? (
        <NavigationLink
          buttonStyle="plain"
          destination={
            <ReaderScreen
              sourceKey={sourceKey}
              comicId={comicId}
              epId={target.chapter.key.epId}
              chapters={chaptersForReader(sourceKey, comicId)}
              comicTitle={comicTitle}
              comicCover={comicCover}
              initialPage={targetPage}
              offlineMode={true}
            />
          }
        >
          <PrimaryAction
            label={resumeRow ? t("detail.resumeReading") : t("detail.startReading")}
            detail={
              targetPage !== undefined
                ? t("detail.chapterAtPage", { chapter: titleOf(target.chapter), n: targetPage + 1 })
                : titleOf(target.chapter)
            }
          />
        </NavigationLink>
      ) : (
        <PrimaryAction label={t("bookshelf.noDownloadedChapter")} disabled={true} />
      )}

      {/* 章節卡片的左滑要外層容器的 swipeActionsContainer（iOS 27）才生效。 */}
      <LazyVStack spacing={cardGap} frame={{ maxWidth: "infinity" }} swipeActionsContainer={true}>
        {rows.map(row => (
          <ChapterRow
            key={row.chapter.key.epId}
            chapter={row.chapter}
            state={row.state}
            resumePage={resume && row.chapter.key.epId === resume.chapter.epId ? resume.page : undefined}
            sourceKey={sourceKey}
            comicId={comicId}
            comicTitle={comicTitle}
            comicCover={comicCover}
            onDelete={() => void deleteChapter(row.chapter)}
            onCancel={() => library.cancelDownload(row.chapter.key)}
          />
        ))}
      </LazyVStack>
    </PageScroll>
  )
}

/** 主要動作的底：實心 tint（停用時中性底），字一律 onTint。 */
function PrimaryAction({ label, detail, disabled = false }: { label: string; detail?: string; disabled?: boolean }) {
  const tint = useTint()
  const textColor = disabled ? "secondaryLabel" : tint.onTint
  return (
    <HStack
      spacing={10}
      alignment="center"
      padding={{ horizontal: 16 }}
      frame={{ maxWidth: "infinity", height: 64 }}
      background={disabled ? fill.surface : tint.tint}
      clipShape={rect(radius.lg)}
    >
      <Spacer />
      <Image systemName={disabled ? "arrow.down.circle" : "book.fill"} font="title3" foregroundStyle={textColor} />
      <VStack alignment="leading" spacing={2}>
        <Text font="headline" fontWeight="bold" foregroundStyle={textColor} lineLimit={1}>
          {label}
        </Text>
        {detail ? (
          <Text font="caption2" fontWeight="medium" foregroundStyle={textColor} opacity={0.75} lineLimit={1}>
            {detail}
          </Text>
        ) : null}
      </VStack>
      <Spacer />
    </HStack>
  )
}

/** 一章：下載完的點進閱讀器；其餘只顯示佇列／進行中的狀態，不給點。 */
function ChapterRow({
  chapter,
  state,
  resumePage,
  sourceKey,
  comicId,
  comicTitle,
  comicCover,
  onDelete,
  onCancel,
}: {
  chapter: OfflineChapter
  state: ChapterDownloadState
  resumePage?: number
  sourceKey: string
  comicId: string
  comicTitle: string
  comicCover?: string
  onDelete: () => void
  onCancel: () => void
}) {
  const status = statusOf(chapter.key)
  const done = state.state === "done"
  const failed = state.state === "failed"
  // 還在跑的章不能直接刪：任務跑完手上那一張會把 manifest 寫回去（資料層的邊界，見回報）。
  const active = state.state === "running" || state.state === "queued"

  const detail = done
    ? t("bookshelf.downloadedStats", { n: status.total, size: formatBytes(status.bytes) })
    : state.state === "running"
      ? t("detail.downloadRunning", { done: state.completed, total: state.total })
      : state.state === "queued"
        ? t("detail.downloadQueued")
        : failed
          ? t("bookshelf.downloadFailed")
          : t("detail.incompleteProgress", { done: state.completed, total: state.total })

  const icon = failed
    ? "exclamationmark.triangle.fill"
    : state.state === "running"
      ? "arrow.down.circle"
      : state.state === "queued"
        ? "clock"
        : done
          ? undefined
          : "pause.circle"
  const iconColor = failed ? tagText.danger : done ? "tertiaryLabel" : "secondaryLabel"
  const progress = state.state === "running" && state.total > 0 ? state.completed / state.total : undefined

  const body = (
    <Card>
      <HStack spacing={12} padding={rowPadding} alignment="center" frame={{ maxWidth: "infinity" }}>
        <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity" }}>
          <Text
            font="subheadline"
            foregroundStyle={done ? "label" : "secondaryLabel"}
            lineLimit={1}
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            {titleOf(chapter)}
          </Text>
          <Text
            font="caption2"
            foregroundStyle={failed ? tagText.danger : done ? "tertiaryLabel" : "secondaryLabel"}
            lineLimit={1}
          >
            {detail}
          </Text>
          {progress !== undefined ? <ProgressView value={progress} total={1} frame={{ maxWidth: "infinity" }} /> : null}
        </VStack>
        {icon ? <Image systemName={icon} foregroundStyle={iconColor} /> : null}
        {done ? <Chevron /> : null}
      </HStack>
    </Card>
  )

  const content = done ? (
    <NavigationLink
      destination={
        <ReaderScreen
          sourceKey={sourceKey}
          comicId={comicId}
          epId={chapter.key.epId}
          chapters={chaptersForReader(sourceKey, comicId)}
          comicTitle={comicTitle}
          comicCover={comicCover}
          initialPage={resumePage}
          offlineMode={true}
        />
      }
    >
      {body}
    </NavigationLink>
  ) : (
    body
  )

  return (
    // 外層也裁成卡片形狀：滑動容器會在列的矩形範圍畫一層底，圓角外會露出方角。
    <VStack
      spacing={0}
      clipShape={cardShape}
      trailingSwipeActions={{
        allowsFullSwipe: false,
        actions: [
          <Button
            key="swipe"
            title={active ? t("settings.downloads.cancel") : t("common.delete")}
            systemImage={active ? "xmark.circle.fill" : "trash.fill"}
            role="destructive"
            action={active ? onCancel : onDelete}
          />,
        ],
      }}
    >
      {content}
    </VStack>
  )
}
