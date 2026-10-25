// 下載管理：進行中的任務（可取消）、未完成／失敗的章節、已完成的章節（依漫畫收納折疊、可離線閱讀、左滑刪除），以及離線總佔用。
//
// 狀態全部來自 ComicLibrary（底下的下載管理員與離線層都是 app 層、不綁畫面）；
// 這一頁不自己記任何東西，只把狀態轉成結構化卡片與 design/ 的列。

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
import { Script } from "scripting"

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
import { t } from "../../i18n"
import { ReaderScreen } from "../shared/ReaderScreen"
import {
  getBackgroundDownloads,
  setBackgroundDownloads,
  subscribeBackgroundDownloads,
} from "../../sources/downloadSettings"

export function DownloadScreen() {
  const library = comicLibrary()
  // 下載、取消、刪除都會讓這裡重繪（去抖在管理員那邊）；背景開關也可能從別的地方被改（或還原）。
  useSubscription(library.onChange, subscribeBackgroundDownloads)

  // 背景續傳是 Scripting Pro 的功能；沒有 Pro 時開關看得見但按不下去。
  const canUseBackground = Script.hasFullAccess()

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

/** 依漫畫分組的已下載紀錄。 */
interface ComicDownloadGroup {
  groupKey: string
  sourceKey: string
  comicId: string
  comicTitle: string
  cover?: string
  records: DownloadRecord[]
  totalBytes: number
}

/** 把已完成的章節依漫畫分組。 */
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

/**
 * 版面本體。資料與動作都用參數進來（`dev/preview-download.tsx` 餵假資料看版面），
 * 所以在預覽裡也不會碰到磁碟。
 */
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
  /** 這一部的閱讀器章節清單（本機快取合併已下載的章）；預覽餵假的就好。 */
  readerChapters: (ref: ComicRef) => ReaderChapter[]
}) {
  const active = records.filter(record => isActive(record.state))
  const pending = records.filter(record => record.state === "partial" || record.state === "failed")
  const done = records.filter(record => record.state === "done")
  const comicGroups = groupDownloadsByComic(done)

  // 預設收起全部漫畫分組；使用者點擊哪本展開哪本
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

      {/* 1. 頂部：進行中的任務 */}
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

      {/* 2. 未完成／失敗的任務 */}
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

      {/* 3. 已完成：依漫畫收納的卡片列表 */}
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

      {/* 4. 儲存空間統計 */}
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

      {/* 5. 背景續傳設定 */}
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

/** 進行中的下載項目：帶進度資訊與取消按鈕。 */
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

/**
 * 依漫畫收納的摺疊卡片：
 * - Header：漫畫封面（40×56）、漫畫名稱、已下載章數與總容量、展開/收合 chevron。
 * - 支援整部左滑刪除確認。
 * - 展開後展示各章節，章節支援左滑單獨刪除。
 */
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
      {/* 漫畫總覽列：點擊展開／收起，左滑可整部刪除 */}
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

      {/* 展開後的章節子列表 */}
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

/** 清單每一筆的 React key（章的識別三元組本來就唯一）。 */
function recordId(record: DownloadRecord): string {
  return `${record.key.sourceKey}/${record.key.comicId}/${record.key.epId}`
}

/** 「漫畫 · 章節」；沒有漫畫名就只顯示章節。 */
function nameOf(record: DownloadRecord): string {
  const episode = record.epTitle || record.key.epId
  return record.comicTitle ? `${record.comicTitle} · ${episode}` : episode
}

/** 未完成的原因：有抓到幾張就誠實說幾張，加上失敗的原因。 */
function reasonOf(record: DownloadRecord): string {
  if (record.state === "failed") {
    return record.error ? `${t("bookshelf.downloadFailed")} · ${record.error}` : t("bookshelf.downloadFailed")
  }
  return record.total > 0
    ? t("settings.downloads.incomplete", { done: record.completed, total: record.total })
    : t("settings.downloads.incompletePlain")
}
