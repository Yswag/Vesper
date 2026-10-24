// 離線書架：已下載內容的入口。整頁只讀離線層（標題／封面／頁數／大小都在 manifest 裡），
// 點一部漫畫推入它的離線章節頁（OfflineComicScreen），不經過詳情頁、不發任何請求。
//
// 純內容元件：自己的捲動區由書架那一頁提供（見票 04）。
//
// 長按刪除整部：先問一次（Dialog.confirm，跟下載頁同一條路），確認後逐章刪。
// 書架把它放在左右滑翻頁的容器裡，左滑會被刪除搶走，所以刪除收在長按選單。

import { Button, LazyVStack, NavigationLink, VStack } from "scripting"

import { isActive } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { ComicListRow } from "../../components/ComicListRow"
import { Card } from "../../design/layout"
import { EmptyState } from "../../design/status"
import { formatBytes } from "../../engine/format"
import {
  comicGroupKey,
  listChapters,
  statusOf,
  subscribeOffline,
  type OfflineChapter,
} from "../../engine/offline"
import { OfflineComicScreen } from "./OfflineComicScreen"

/** 一部漫畫的離線內容（清單要的統計都在這裡算好）。 */
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
        sourceName: source?.name ?? t("bookshelf.sourceRemovedTitle"),
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

  return [...groups.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function OfflineLibraryScreen() {
  // 下載完成／刪除都會讓這裡重繪；資料在 render 裡重讀（每次重繪重讀）。
  // 語言也是訂閱源：manifest 的資料名與我們自己的字都在 render 時取自 `t()`
  // （`groupByComic()` 是 render 裡叫的，不是 import 時算好的常數）。
  useSubscription(subscribeOffline, subscribeLocale)

  /** 刪掉整部：先問再刪，一次一章走刪除（下載中的任務也一併收掉）。 */
  async function deleteComic(group: ComicGroup) {
    const confirmed = await Dialog.confirm({
      title: t("common.delete"),
      message: t("bookshelf.deleteComicConfirm", { title: group.title, n: group.chapters.length }),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
    })
    if (!confirmed) return
    const library = comicLibrary()
    for (const chapter of group.chapters) library.deleteDownload(chapter.key)
  }

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
        // 還在下載的章不能直接刪（任務跑完手上那一張會把 manifest 寫回去）：只能先取消。
        const downloads = group.chapters.map(chapter => comicLibrary().downloadState(chapter.key))
        const active = group.chapters.filter((_, index) => isActive(downloads[index].state))

        return (
          // 長按選單掛在外層（點一下仍然是 NavigationLink 的推入）。
          <VStack
            key={groupId(group.sourceKey, group.comicId)}
            spacing={0}
            contextMenu={{
              menuItems:
                active.length > 0 ? (
                  <Button
                    title={t("settings.downloads.cancel")}
                    action={() => {
                      const library = comicLibrary()
                      for (const chapter of active) library.cancelDownload(chapter.key)
                    }}
                  />
                ) : (
                  <Button
                    title={t("common.delete")}
                    role="destructive"
                    action={() => void deleteComic(group)}
                  />
                ),
            }}
          >
            <NavigationLink
              destination={
                <OfflineComicScreen
                  sourceKey={group.sourceKey}
                  comicId={group.comicId}
                  title={group.title}
                  cover={group.cover}
                />
              }
            >
              <Card>
                <ComicListRow
                  sourceKey={group.sourceKey}
                  cover={group.cover}
                  title={group.title}
                  subtitle={group.sourceName}
                  detail={t("bookshelf.chapterStats", {
                    done: group.completedChapters,
                    total: group.chapters.length,
                    n: group.chapters.length,
                    size: formatBytes(group.totalBytes),
                  })}
                />
              </Card>
            </NavigationLink>
          </VStack>
        )
      })}
    </LazyVStack>
  )
}
