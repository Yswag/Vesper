import {
  Button,
  Divider,
  HStack,
  Image,
  NavigationLink,
  ProgressView,
  Spacer,
  Text,
  VStack,
  useState,
} from "scripting"

import { isActive, type ChapterRef, type ComicRef, type DownloadRecord, type ReaderChapter } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { ComicListRow } from "../../components/ComicListRow"
import { Card, CardGroup, GroupHeader, PageScroll } from "../../design/layout"
import { Chevron, IconBadge, IconRow, InfoRow, ToggleRow, rowSeparatorInset } from "../../design/rows"
import { EmptyState } from "../../design/status"
import { fill, rowPadding, toneText } from "../../design/tokens"
import { useTint } from "../../app/theme"
import { formatBytes } from "../../engine/format"
import { hasPro } from "../../engine/pro"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { ReaderScreen } from "../shared/ReaderScreen"
import {
  getBackgroundDownloads,
  setBackgroundDownloads,
  subscribeBackgroundDownloads,
} from "../../sources/downloadSettings"

export function DownloadScreen() {
  const library = comicLibrary()
  useSubscription(library.onChange, subscribeBackgroundDownloads, subscribeLocale)

  const canUseBackground = hasPro()

  return (
    <DownloadSections
      records={library.listDownloads()}
      used={library.offline.totalBytes()}
      background={getBackgroundDownloads()}
      canUseBackground={canUseBackground}
      onToggleBackground={setBackgroundDownloads}
      onCancel={library.cancelDownload}
      onDelete={ref => void library.offline.deleteChapter(ref)}
      readerChapters={library.offline.readerChapters}
    />
  )
}

interface ComicDownloadGroup {
  groupKey: string
  sourceKey: string
  comicId: string
  comicTitle: string
  cover?: string
  records: DownloadRecord[]
  totalBytes: number
}

function groupDownloadsByComic(records: DownloadRecord[]): ComicDownloadGroup[] {
  const map = new Map<string, ComicDownloadGroup>()
  for (const record of records) {
    const key = `${record.key.sourceKey}:${record.key.comicId}`
    let group = map.get(key)
    if (!group) {
      group = {
        groupKey: key,
        sourceKey: record.key.sourceKey,
        comicId: record.key.comicId,
        comicTitle: record.comicTitle || record.key.comicId,
        cover: record.cover,
        records: [],
        totalBytes: 0,
      }
      map.set(key, group)
    }
    group.records.push(record)
    group.totalBytes += record.bytes
    if (!group.cover && record.cover) {
      group.cover = record.cover
    }
  }
  return Array.from(map.values())
}

export function DownloadSections({
  records,
  used,
  background,
  canUseBackground,
  onToggleBackground,
  onCancel,
  onDelete,
  readerChapters,
}: {
  records: DownloadRecord[]
  used: number
  background: boolean
  canUseBackground: boolean
  onToggleBackground: (value: boolean) => void
  onCancel: (ref: ChapterRef) => void
  onDelete: (ref: ChapterRef) => void
  readerChapters: (ref: ComicRef) => ReaderChapter[]
}) {
  const active = records.filter(record => isActive(record.state))
  const pending = records.filter(record => record.state === "partial" || record.state === "failed")
  const done = records.filter(record => record.state === "done")
  const comicGroups = groupDownloadsByComic(done)

  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({})

  function toggleExpand(groupKey: string) {
    withAnimation(() => {
      setExpandedKeys(prev => ({
        ...prev,
        [groupKey]: !prev[groupKey],
      }))
    })
  }

  return (
    <PageScroll title={t("settings.downloads.title")}>
      {records.length === 0 ? (
        <EmptyState
          variant="page"
          icon="arrow.down.circle"
          title={t("settings.downloads.empty")}
          detail={t("settings.downloads.emptyDetail")}
        />
      ) : null}

      {}
      {active.length > 0 ? (
        <CardGroup title={t("settings.downloads.active", { n: active.length })} swipeActionsContainer={true}>
          {active.map((record, index) => (
            <VStack
              key={recordId(record)}
              spacing={0}
              trailingSwipeActions={{
                allowsFullSwipe: true,
                actions: [
                  <Button
                    key="cancel"
                    title={t("settings.downloads.cancel")}
                    systemImage="xmark.circle"
                    action={() => onCancel(record.key)}
                  />,
                ],
              }}
            >
              {index > 0 ? <Divider padding={{ leading: rowSeparatorInset }} /> : null}
              <ActiveDownloadRow record={record} onCancel={() => onCancel(record.key)} />
            </VStack>
          ))}
        </CardGroup>
      ) : null}

      {}
      {pending.length > 0 ? (
        <CardGroup
          title={t("settings.downloads.pending", { n: pending.length })}
          swipeActionsContainer={true}
        >
          {pending.map((record, index) => (
            <VStack
              key={recordId(record)}
              spacing={0}
              trailingSwipeActions={{
                allowsFullSwipe: true,
                actions: [
                  <Button
                    key="delete"
                    title={t("common.delete")}
                    systemImage="trash.fill"
                    role="destructive"
                    action={() => onDelete(record.key)}
                  />,
                ],
              }}
            >
              {index > 0 ? <Divider padding={{ leading: rowSeparatorInset }} /> : null}
              <HStack
                spacing={14}
                padding={rowPadding}
                alignment="center"
                frame={{ maxWidth: "infinity" }}
              >
                <IconBadge
                  icon={record.state === "failed" ? "exclamationmark.triangle.fill" : "pause.circle"}
                  color={record.state === "failed" ? toneText.danger : "secondaryLabel"}
                />
                <VStack spacing={2} alignment="leading">
                  <Text font="body" fontWeight="regular" foregroundStyle="label">
                    {nameOf(record)}
                  </Text>
                  <Text font="caption" foregroundStyle={record.state === "failed" ? toneText.danger : "secondaryLabel"}>
                    {reasonOf(record)}
                  </Text>
                </VStack>
                <Spacer />
                <Button
                  title=""
                  systemImage="trash"
                  role="destructive"
                  foregroundStyle={toneText.danger}
                  action={() => onDelete(record.key)}
                />
              </HStack>
            </VStack>
          ))}
        </CardGroup>
      ) : null}

      {}
      {comicGroups.length > 0 ? (
        <VStack spacing={14} alignment="leading">
          <GroupHeader title={t("settings.downloads.doneGroup", { n: done.length })} />
          {comicGroups.map(group => {
            const isExpanded = !!expandedKeys[group.groupKey]
            return (
              <ComicGroupCard
                key={group.groupKey}
                group={group}
                isExpanded={isExpanded}
                onToggle={() => toggleExpand(group.groupKey)}
                onDeleteChapter={onDelete}
                readerChapters={readerChapters}
              />
            )
          })}
        </VStack>
      ) : null}

      {}
      {records.length > 0 ? (
        <CardGroup
          title={t("settings.downloads.storage")}
          footnote={t("settings.downloads.storageFootnote", { action: t("settings.root.clearThumbCache") })}
        >
          <InfoRow
            label={t("settings.downloads.offlineChapters")}
            value={t("settings.shared.countChapters", { n: done.length })}
          />
          <Divider padding={{ leading: rowSeparatorInset }} />
          <InfoRow label={t("settings.downloads.totalUsed")} value={formatBytes(used)} />
        </CardGroup>
      ) : null}

      {}
      <CardGroup
        title={t("settings.downloads.background")}
        footnote={
          canUseBackground
            ? t("settings.downloads.backgroundFootnote")
            : t("settings.downloads.backgroundFootnoteNoPro")
        }
      >
        {canUseBackground ? (
          <ToggleRow
            icon="arrow.down.circle"
            title={t("settings.downloads.allowBackground")}
            value={background}
            onChanged={onToggleBackground}
          />
        ) : (
          <IconRow
            icon="lock.fill"
            title={t("settings.downloads.allowBackground")}
            detail={t("settings.downloads.requiresPro")}
          />
        )}
      </CardGroup>
    </PageScroll>
  )
}

function ActiveDownloadRow({
  record,
  onCancel,
}: {
  record: DownloadRecord
  onCancel: () => void
}) {
  const isQueued = record.state === "queued"
  const tint = useTint()
  const progressRatio = record.total > 0 ? Math.min(1, record.completed / record.total) : undefined

  return (
    <HStack
      spacing={14}
      padding={rowPadding}
      alignment="center"
      frame={{ maxWidth: "infinity" }}
    >
      <IconBadge icon="arrow.down.circle.fill" color={tint.tint} />
      <VStack spacing={3} alignment="leading">
        <Text font="body" fontWeight="regular" foregroundStyle="label">
          {nameOf(record)}
        </Text>
        <Text font="caption" foregroundStyle="secondaryLabel">
          {isQueued
            ? t("settings.downloads.queued")
            : t("settings.downloads.downloading", { done: record.completed, total: record.total })}
        </Text>
        {progressRatio !== undefined && !isQueued ? (
          <ProgressView value={progressRatio} total={1} />
        ) : null}
      </VStack>
      <Spacer />
      <Button
        title=""
        systemImage="xmark.circle"
        foregroundStyle="secondaryLabel"
        action={onCancel}
      />
    </HStack>
  )
}

function ComicGroupCard({
  group,
  isExpanded,
  onToggle,
  onDeleteChapter,
  readerChapters,
}: {
  group: ComicDownloadGroup
  isExpanded: boolean
  onToggle: () => void
  onDeleteChapter: (ref: ChapterRef) => void
  readerChapters: (ref: ComicRef) => ReaderChapter[]
}) {
  async function handleDeleteAll() {
    const confirmed = await Dialog.confirm({
      title: t("common.delete"),
      message: t("settings.downloads.deleteComicConfirm", { title: group.comicTitle }),
      confirmLabel: t("settings.downloads.deleteComicAction"),
    })
    if (confirmed) {
      for (const record of group.records) {
        onDeleteChapter(record.key)
      }
    }
  }

  return (
    <Card swipeActionsContainer={true}>
      {}
      <VStack
        spacing={0}
        frame={{ maxWidth: "infinity" }}
        trailingSwipeActions={{
          allowsFullSwipe: false,
          actions: [
            <Button
              key="deleteAll"
              title={t("settings.downloads.deleteComicAction")}
              systemImage="trash.fill"
              role="destructive"
              action={() => void handleDeleteAll()}
            />,
          ],
        }}
      >
        <ComicListRow
          sourceKey={group.sourceKey}
          cover={group.cover}
          title={group.comicTitle}
          subtitle={`${t("settings.shared.countChapters", { n: group.records.length })} · ${formatBytes(group.totalBytes)}`}
          trailing={
            <Image
              systemName={isExpanded ? "chevron.up" : "chevron.down"}
              font="caption"
              fontWeight="semibold"
              foregroundStyle="tertiaryLabel"
            />
          }
          onTap={onToggle}
        />
      </VStack>

      {}
      {isExpanded ? (
        <VStack spacing={0} background={fill.tag}>
          {group.records.map((record) => (
            <VStack
              key={recordId(record)}
              spacing={0}
              trailingSwipeActions={{
                allowsFullSwipe: true,
                actions: [
                  <Button
                    key="delete"
                    title={t("common.delete")}
                    systemImage="trash.fill"
                    role="destructive"
                    action={() => onDeleteChapter(record.key)}
                  />,
                ],
              }}
            >
              <Divider padding={{ leading: 16 }} />
              <NavigationLink
                destination={
                  <ReaderScreen
                    sourceKey={record.key.sourceKey}
                    comicId={record.key.comicId}
                    epId={record.key.epId}
                    chapters={readerChapters(record.key)}
                    comicTitle={record.comicTitle ?? ""}
                    comicCover={record.cover}
                  />
                }
              >
                <HStack
                  spacing={12}
                  padding={{ leading: 18, trailing: 16, vertical: 12 }}
                  alignment="center"
                  frame={{ maxWidth: "infinity" }}
                >
                  <Image
                    systemName="checkmark.circle.fill"
                    font="subheadline"
                    foregroundStyle={toneText.success}
                  />
                  <Text font="body" fontWeight="regular" foregroundStyle="label">
                    {record.epTitle || record.key.epId}
                  </Text>
                  <Spacer />
                  <Text font="subheadline" foregroundStyle="secondaryLabel">
                    {`${t("settings.shared.countImages", { n: record.total })} · ${formatBytes(record.bytes)}`}
                  </Text>
                  <Chevron />
                </HStack>
              </NavigationLink>
            </VStack>
          ))}
        </VStack>
      ) : null}
    </Card>
  )
}

function recordId(record: DownloadRecord): string {
  return `${record.key.sourceKey}/${record.key.comicId}/${record.key.epId}`
}

function nameOf(record: DownloadRecord): string {
  const episode = record.epTitle || record.key.epId
  return record.comicTitle ? `${record.comicTitle} · ${episode}` : episode
}

function reasonOf(record: DownloadRecord): string {
  if (record.state === "failed") {
    return record.error ? `${t("bookshelf.downloadFailed")} · ${record.error}` : t("bookshelf.downloadFailed")
  }
  return record.total > 0
    ? t("settings.downloads.incomplete", { done: record.completed, total: record.total })
    : t("settings.downloads.incompletePlain")
}
