// 離線書架：已下載內容的入口。整頁只讀離線層（標題／封面／頁數／大小都在 manifest 裡），
// 點一章就直接進離線模式的閱讀器——不經過詳情頁、不發任何請求。
//
// 純內容元件（沒有自己的 ScrollView）：書架的「離線內容」分頁內嵌它，
// 跟收藏／歷史共用同一個捲動區（見票 04）。
//
// 展開狀態留在這個元件裡；切回收藏再回來會恢復成收合。刻意不做記住展開（票 04 的取捨）。

import {
  Divider,
  HStack,
  Image,
  LazyVStack,
  NavigationLink,
  RoundedRectangle,
  Text,
  VStack,
  ZStack,
  useState,
} from "scripting"

import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { CoverImage } from "../../components/CoverImage"
import { Chevron, rowSeparatorInset } from "../../design/rows"
import { EmptyState } from "../../design/status"
import {
  cardBackground,
  fill,
  hairlineStroke,
  neutral,
  palette,
  radius,
  rect,
  rowPadding,
} from "../../design/tokens"
import { formatBytes } from "../../engine/format"
import {
  chaptersForReader,
  comicGroupKey,
  listChapters,
  statusOf,
  subscribeOffline,
  type OfflineChapter,
} from "../../engine/offline"
import { ReaderScreen } from "../shared/ReaderScreen"

/** 一部漫畫的離線內容（畫面要的統計都在這裡算好）。 */
interface ComicGroup {
  sourceKey: string
  comicId: string
  title: string
  cover?: string
  sourceName: string
  chapters: OfflineChapter[]
  totalBytes: number
  completedChapters: number
  updatedAt: number
}

function groupId(sourceKey: string, comicId: string): string {
  return comicGroupKey({ sourceKey, comicId })
}

/** 把離線章節按漫畫分組，最近有人下載的排前面。 */
function groupByComic(): ComicGroup[] {
  const groups = new Map<string, ComicGroup>()

  for (const chapter of listChapters()) {
    const id = groupId(chapter.key.sourceKey, chapter.key.comicId)
    let group = groups.get(id)
    if (!group) {
      const source = comicLibrary().source(chapter.key.sourceKey)
      group = {
        sourceKey: chapter.key.sourceKey,
        comicId: chapter.key.comicId,
        title: chapter.comicTitle ?? t("bookshelf.unknownComic"),
        cover: chapter.cover,
        sourceName: source?.name ?? t("bookshelf.sourceRemoved"),
        chapters: [],
        totalBytes: 0,
        completedChapters: 0,
        updatedAt: 0,
      }
      groups.set(id, group)
    }
    const status = statusOf(chapter.key)
    group.chapters.push(chapter)
    group.totalBytes += status.bytes
    if (status.state === "done") group.completedChapters++
    group.updatedAt = Math.max(group.updatedAt, chapter.updatedAt)
  }

  for (const group of groups.values()) {
    group.chapters.sort((a, b) => b.updatedAt - a.updatedAt)
  }
  return [...groups.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function OfflineLibraryScreen() {
  // 下載完成／刪除都會讓這裡重繪；資料在 render 裡重讀（每次重繪重讀）。
  // 語言也是訂閱源：manifest 的資料名與我們自己的字都在 render 時取自 `t()`
  // （`groupByComic()` 是 render 裡叫的，不是 import 時算好的常數）。
  useSubscription(subscribeOffline, subscribeLocale)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const groups = groupByComic()
  if (groups.length === 0) {
    return (
      <EmptyState
        variant="page"
        icon="arrow.down.circle"
        title={t("bookshelf.emptyOfflineTitle")}
        detail={t("bookshelf.emptyOfflineDetail")}
      />
    )
  }

  return (
    <LazyVStack spacing={12} padding={{ horizontal: 16, vertical: 12 }}>
      {groups.map(group => {
        const id = groupId(group.sourceKey, group.comicId)
        const isOpen = expanded[id] === true
        return (
          <VStack
            key={id}
            spacing={0}
            background={cardBackground}
            clipShape={rect(radius.card)}
            shadow={{ color: "rgba(0, 0, 0, 0.28)", radius: 10, x: 0, y: 3 }}
            overlay={
              <RoundedRectangle
                cornerRadius={radius.card}
                stroke={hairlineStroke}
              />
            }
            frame={{ maxWidth: "infinity" }}
          >
            <ComicHeader
              group={group}
              isOpen={isOpen}
              onToggle={() => setExpanded(current => ({ ...current, [id]: !isOpen }))}
            />
            {isOpen ? (
              <VStack spacing={0} frame={{ maxWidth: "infinity" }}>
                {group.chapters.map((chapter, index) => (
                  <VStack key={chapter.key.epId} spacing={0} frame={{ maxWidth: "infinity" }}>
                    {index > 0 ? <Divider padding={{ leading: rowSeparatorInset }} /> : null}
                    <ChapterRow group={group} chapter={chapter} />
                  </VStack>
                ))}
              </VStack>
            ) : null}
          </VStack>
        )
      })}
    </LazyVStack>
  )
}

/** 漫畫卡片的表頭：封面 + 標題／來源／統計，整列可點＝展開／收合。 */
function ComicHeader({ group, isOpen, onToggle }: { group: ComicGroup; isOpen: boolean; onToggle: () => void }) {
  return (
    <HStack
      spacing={12}
      padding={rowPadding}
      alignment="center"
      frame={{ maxWidth: "infinity" }}
      contentShape={"rect"}
      onTapGesture={onToggle}
    >
      <ZStack
        frame={{ width: 60, height: 80 }}
        shadow={{ color: "rgba(0, 0, 0, 0.4)", radius: 6, x: 0, y: 3 }}
      >
        <CoverImage sourceKey={group.sourceKey} url={group.cover} width={60} height={80} cornerRadius={radius.cover} />
      </ZStack>

      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity" }}>
        <Text
          font="subheadline"
          fontWeight="semibold"
          foregroundStyle="label"
          lineLimit={2}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          {group.title}
        </Text>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
          {group.sourceName}
        </Text>
        <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1}>
          {t("bookshelf.chapterStats", {
            done: group.completedChapters,
            total: group.chapters.length,
            n: group.chapters.length,
            size: formatBytes(group.totalBytes),
          })}
        </Text>
      </VStack>

      <Image
        systemName={isOpen ? "chevron.down" : "chevron.right"}
        font="caption"
        fontWeight="semibold"
        foregroundStyle={neutral.tertiary}
      />
    </HStack>
  )
}

/** 一章：下載完的可以點進閱讀器，沒完成的不給點（也看不出完成）。 */
function ChapterRow({ group, chapter }: { group: ComicGroup; chapter: OfflineChapter }) {
  const status = statusOf(chapter.key)
  const isDone = status.state === "done"
  const title = chapter.epTitle ?? chapter.key.epId
  const detail = isDone
    ? t("bookshelf.downloadedStats", { n: status.completed, size: formatBytes(status.bytes) })
    : t("bookshelf.incompleteStats", { done: status.completed, total: status.total })

  const body = (
    <HStack spacing={12} padding={rowPadding} alignment="center" frame={{ maxWidth: "infinity" }}>
      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity" }}>
        <Text
          font="subheadline"
          foregroundStyle={isDone ? "label" : "secondaryLabel"}
          lineLimit={1}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          {title}
        </Text>
        <Text
          font="caption2"
          foregroundStyle={isDone ? "tertiaryLabel" : palette.orange}
          lineLimit={1}
        >
          {detail}
        </Text>
      </VStack>
      <Image
        systemName={isDone ? "checkmark.circle.fill" : "exclamationmark.circle"}
        foregroundStyle={isDone ? palette.green : palette.orange}
      />
      {isDone ? <Chevron /> : null}
    </HStack>
  )

  if (!isDone) return body

  // 進閱讀器時把「這部所有下載完的章」一起帶進去，換話才有東西可切。
  return (
    <NavigationLink
      destination={
        <ReaderScreen
          sourceKey={chapter.key.sourceKey}
          comicId={chapter.key.comicId}
          epId={chapter.key.epId}
          chapters={chaptersForReader(chapter.key.sourceKey, chapter.key.comicId)}
          comicTitle={chapter.comicTitle ?? group.title}
          comicCover={chapter.cover ?? group.cover}
          offlineMode={true}
        />
      }
    >
      {body}
    </NavigationLink>
  )
}
