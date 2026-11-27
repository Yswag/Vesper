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
  useSubscription(library.onChange, subscribeLocale)

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
        <LazyVStack spacing={12} padding={{ horizontal: 16, vertical: 12 }} swipeActionsContainer={true}>
          {comics.map(comic => {
            const title = comic.title ?? t("bookshelf.unknownComic")
            const zoomID = `offline:${comicIdOf(comic)}`

            return (
              <VStack
                key={comicIdOf(comic)}
                spacing={0}
                clipShape={cardShape}
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
