import { Button, Group, VStack, type VirtualNode } from "scripting"

import type { ResumeEntry } from "../../app/shelf"
import { t } from "../../i18n"
import type { Progress } from "../../library/bookshelf"
import { ComicDetailScreen } from "./ComicDetailScreen"

export function canOpenComicDetail(shown: Pick<ResumeEntry, "source">): boolean {
  return shown.source === "present"
}

export function progressZoomID(entry: Progress): string {
  return `progress:${entry.sourceKey}:${entry.comicId}`
}

export function ProgressMenuItems({
  onOpenDetail,
  onDelete,
}: {
  onOpenDetail?: () => void
  onDelete?: () => void
}): VirtualNode {
  return (
    <Group>
      {onOpenDetail ? <Button title={t("bookshelf.openDetail")} action={onOpenDetail} /> : null}
      {onDelete ? <Button title={t("common.delete")} role="destructive" action={onDelete} /> : null}
    </Group>
  )
}

export interface ProgressDetailDestination {
  content: VirtualNode
  isPresented: boolean
  onChanged: (presented: boolean) => void
}

export function progressDetailDestination({
  entry,
  onDismiss,
  zoomNamespace,
}: {
  entry: Progress | null
  onDismiss: () => void
  zoomNamespace?: NamespaceID
}): ProgressDetailDestination {
  return {
    content: entry ? (
      <ComicDetailScreen
        key={`${entry.sourceKey}:${entry.comicId}`}
        sourceKey={entry.sourceKey}
        comicId={entry.comicId}
        title={entry.title}
        zoomTransition={zoomNamespace ? { sourceID: progressZoomID(entry), namespace: zoomNamespace } : undefined}
      />
    ) : (
      <VStack />
    ),
    isPresented: entry !== null,
    onChanged: presented => {
      if (!presented) onDismiss()
    },
  }
}
