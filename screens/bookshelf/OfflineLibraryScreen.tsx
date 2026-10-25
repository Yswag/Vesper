// 離線書架：已下載內容的入口。整頁只讀離線層（標題／封面／頁數／大小都在 manifest 裡），
// 點一部漫畫推入它的離線章節頁（OfflineComicScreen），不經過詳情頁、不發任何請求。
//
// `OfflineLibraryPage` 是從書架入口推進來的整頁；`OfflineLibraryScreen` 是不帶捲動區的內容。
//
// 長按刪除整部：先問一次（Dialog.confirm，跟下載頁同一條路），確認後由 ComicLibrary 逐章刪
// （下載中的先取消、等任務收尾才刪檔）。只停下載的人用長按選單的「取消」。

import { Button, Group, LazyVStack, NamespaceReader, NavigationLink, ScrollView, VStack, ZStack } from "scripting"

import type { OfflineComic } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { PageBackground } from "../../app/theme"
import { useSubscription } from "../../app/useSubscription"
import { scrollTopBar } from "../../design/glass"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { ComicListRow } from "../../components/ComicListRow"
import { Card } from "../../design/layout"
import { EmptyState } from "../../design/status"
import { cardShape } from "../../design/tokens"
import { formatBytes } from "../../engine/format"
import { OfflineComicScreen } from "./OfflineComicScreen"

/** 這一部在這份清單裡的識別（推頁的 key 與封面 zoom 的 id）。 */
function comicIdOf(comic: OfflineComic): string {
  return `${comic.sourceKey}:${comic.comicId}`
}

export function OfflineLibraryPage() {
  return (
    <ZStack>
      <PageBackground />
      <ScrollView
        scrollContentBackground="hidden"
        navigationTitle={t("bookshelf.offlineTab")}
        navigationBarTitleDisplayMode="inline"
        {...scrollTopBar(null)}
      >
        <OfflineLibraryScreen />
      </ScrollView>
    </ZStack>
  )
}

export function OfflineLibraryScreen() {
  const library = comicLibrary()
  // 下載完成／刪除都會讓這裡重繪；資料在 render 裡重讀（每次重繪重讀）。
  // 語言也是訂閱源：manifest 的資料名與我們自己的字都在 render 時取自 `t()`。
  useSubscription(library.onChange, subscribeLocale)

  /** 刪掉整部：先問再刪（下載中的也刪得掉，資料層會先取消再等任務收尾）。 */
  async function deleteComic(comic: OfflineComic) {
    const title = comic.title ?? t("bookshelf.unknownComic")
    const confirmed = await Dialog.confirm({
      title: t("common.delete"),
      message: t("bookshelf.deleteComicConfirm", { title, n: comic.chapters }),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
    })
    if (confirmed) await library.offline.deleteComic(comic)
  }

  const comics = library.offline.comics()
  if (comics.length === 0) {
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
    <NamespaceReader>
      {offlineNs => (
        // 卡片的左滑要外層容器的 swipeActionsContainer（iOS 27）才生效。
        <LazyVStack spacing={12} padding={{ horizontal: 16, vertical: 12 }} swipeActionsContainer={true}>
          {comics.map(comic => {
            const title = comic.title ?? t("bookshelf.unknownComic")
            // 封面 zoom 進離線作品頁（跟收藏、歷史推詳情一樣）。
            const zoomID = `offline:${comicIdOf(comic)}`

            return (
              // 左滑與長按掛在外層（點一下仍然是 NavigationLink 的推入）；外層也裁成卡片形狀，滑動底才不露方角。
              <VStack
                key={comicIdOf(comic)}
                spacing={0}
                clipShape={cardShape}
                // 下載中也直接給刪除（先確認）；只想停下載的人走長按選單。
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button
                      key="swipe"
                      title={t("common.delete")}
                      systemImage="trash.fill"
                      role="destructive"
                      action={() => void deleteComic(comic)}
                    />,
                  ],
                }}
                contextMenu={{
                  menuItems: (
                    <Group>
                      {comic.active > 0 ? (
                        <Button
                          title={t("settings.downloads.cancel")}
                          action={() => library.offline.cancelComic(comic)}
                        />
                      ) : null}
                      <Button
                        title={t("common.delete")}
                        role="destructive"
                        action={() => void deleteComic(comic)}
                      />
                    </Group>
                  ),
                }}
              >
                <NavigationLink
                  destination={
                    <OfflineComicScreen
                      sourceKey={comic.sourceKey}
                      comicId={comic.comicId}
                      title={title}
                      cover={comic.cover}
                      zoomFrom={{ sourceID: zoomID, namespace: offlineNs }}
                    />
                  }
                >
                  <Card>
                    <ComicListRow
                      sourceKey={comic.sourceKey}
                      cover={comic.cover}
                      title={title}
                      subtitle={comic.sourceName ?? t("bookshelf.sourceRemovedTitle")}
                      coverTransition={{ id: zoomID, namespace: offlineNs }}
                      detail={t("bookshelf.chapterStats", {
                        done: comic.completed,
                        total: comic.chapters,
                        n: comic.chapters,
                        size: formatBytes(comic.bytes),
                      })}
                    />
                  </Card>
                </NavigationLink>
              </VStack>
            )
          })}
        </LazyVStack>
      )}
    </NamespaceReader>
  )
}
