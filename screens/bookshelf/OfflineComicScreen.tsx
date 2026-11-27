import { Button, Group, HStack, Image, LazyVStack, ProgressView, Spacer, Text, VStack } from "scripting"

import { isActive, type OfflineChapterRow } from "../../app/comic"
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
import { HERO_ASPECT } from "../shared/comicMetrics"
import { presentReader } from "../shared/ResumeReaderScreen"
import type { ChapterRef } from "../shared/ReaderScreen"

const HERO_COVER = { width: 96, height: Math.round(96 * HERO_ASPECT) }

export function OfflineComicScreen({
  sourceKey,
  comicId,
  title,
  cover,
  zoomFrom,
}: {
  sourceKey: string
  comicId: string
  title?: string
  cover?: string
  zoomFrom?: { sourceID: string; namespace: NamespaceID }
}) {
  const library = comicLibrary()
  useSubscription(library.onChange, subscribeLocale)

  const ref = { sourceKey, comicId }
  const rows = library.offline.chapters(ref)
  const offline = library.offline.comic(ref)
  const comicTitle = title ?? offline?.title ?? t("bookshelf.unknownComic")
  const comicCover = cover ?? offline?.cover
  const sourceName = offline?.sourceName ?? t("bookshelf.sourceRemoved")
  const doneCount = rows.filter(row => row.state.state === "done").length
  const bytes = rows.reduce((sum, row) => sum + row.bytes, 0)

  const resume = library.resume(ref)
  const resumeRow = resume
    ? rows.find(row => row.ref.epId === resume.chapter.epId && row.state.state === "done")
    : undefined
  const target = resumeRow ?? rows.find(row => row.state.state === "done")
  const targetPage = resume && resumeRow ? resume.page : undefined

  const readerChapters = () => library.offline.readerChapters(ref)

  async function deleteChapter(row: OfflineChapterRow) {
    const confirmed = await Dialog.confirm({
      title: t("common.delete"),
      message: t("bookshelf.deleteChapterConfirm", { chapter: row.title }),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
    })
    if (confirmed) await library.offline.deleteChapter(row.ref)
  }

  if (rows.length === 0) {
    return (
      <PageScroll title={comicTitle} zoomFrom={zoomFrom}>
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
    <PageScroll title={comicTitle} zoomFrom={zoomFrom}>
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
        <Button
          buttonStyle="plain"
          action={() =>
            void presentReader({
              sourceKey,
              comicId,
              epId: target.ref.epId,
              chapters: readerChapters(),
              comicTitle,
              comicCover,
              initialPage: targetPage,
            })
          }
        >
          <PrimaryAction
            label={resumeRow ? t("detail.resumeReading") : t("detail.startReading")}
            detail={
              targetPage !== undefined
                ? t("detail.chapterAtPage", { chapter: target.title, n: targetPage + 1 })
                : target.title
            }
          />
        </Button>
      ) : (
        <PrimaryAction label={t("bookshelf.noDownloadedChapter")} disabled={true} />
      )}

      {}
      <LazyVStack spacing={cardGap} frame={{ maxWidth: "infinity" }} swipeActionsContainer={true}>
        {rows.map(row => (
          <ChapterRow
            key={row.ref.epId}
            row={row}
            resumePage={resume && row.ref.epId === resume.chapter.epId ? resume.page : undefined}
            sourceKey={sourceKey}
            comicId={comicId}
            comicTitle={comicTitle}
            comicCover={comicCover}
            readerChapters={readerChapters}
            onDelete={() => void deleteChapter(row)}
            onCancel={() => library.cancelDownload(row.ref)}
          />
        ))}
      </LazyVStack>
    </PageScroll>
  )
}

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

function ChapterRow({
  row,
  resumePage,
  sourceKey,
  comicId,
  comicTitle,
  comicCover,
  readerChapters,
  onDelete,
  onCancel,
}: {
  row: OfflineChapterRow
  resumePage?: number
  sourceKey: string
  comicId: string
  comicTitle: string
  comicCover?: string
  readerChapters: () => ChapterRef[]
  onDelete: () => void
  onCancel: () => void
}) {
  const { state } = row
  const done = state.state === "done"
  const failed = state.state === "failed"
  const active = isActive(state.state)

  const detail = done
    ? t("bookshelf.downloadedStats", { n: row.pages, size: formatBytes(row.bytes) })
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
            {row.title}
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
    <Button
      buttonStyle="plain"
      frame={{ maxWidth: "infinity" }}
      action={() =>
        void presentReader({
          sourceKey,
          comicId,
          epId: row.ref.epId,
          chapters: readerChapters(),
          comicTitle,
          comicCover,
          initialPage: resumePage,
        })
      }
    >
      {body}
    </Button>
  ) : (
    body
  )

  return (
    <VStack
      spacing={0}
      clipShape={cardShape}
      trailingSwipeActions={{
        allowsFullSwipe: false,
        actions: [
          <Button key="swipe" title={t("common.delete")} systemImage="trash.fill" role="destructive" action={onDelete} />,
        ],
      }}
      contextMenu={{
        menuItems: (
          <Group>
            {active ? <Button title={t("settings.downloads.cancel")} action={onCancel} /> : null}
            <Button title={t("common.delete")} role="destructive" action={onDelete} />
          </Group>
        ),
      }}
    >
      {content}
    </VStack>
  )
}
