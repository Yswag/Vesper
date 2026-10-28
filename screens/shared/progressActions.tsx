// 閱讀紀錄的共用動作：首頁「繼續閱讀」卡片與閱讀歷史列用同一組長按選單與詳情推頁，
// 條件（有源才給詳情）、文案與 zoom 配對 id 都只寫在這裡。

import { Button, Group, VStack, type VirtualNode } from "scripting"

import type { ResumeEntry } from "../../app/shelf"
import { t } from "../../i18n"
import type { Progress } from "../../library/bookshelf"
import { ComicDetailScreen } from "./ComicDetailScreen"

/** 詳情頁要源才開得起來：源被移除、只剩離線內容的紀錄不給這個入口。 */
export function canOpenComicDetail(shown: Pick<ResumeEntry, "source">): boolean {
  return shown.source === "present"
}

/** 封面 → 詳情頁的 zoom 配對 id。兩邊都要用它，id 才對得上。 */
export function progressZoomID(entry: Progress): string {
  return `progress:${entry.sourceKey}:${entry.comicId}`
}

/** 長按選單：有源才給「前往詳情」，刪除一律給。 */
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

/**
 * 長按「前往詳情」的推頁。掛在畫面層（不放進 Lazy 容器裡的列）；
 * 給了 `zoomNamespace` 就讓封面縮放進詳情（封面要設 `progressZoomID` 的 matchedTransitionSource）。
 */
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
    // key 跟著漫畫換：同一個推頁位置會沿用上一本的狀態，先閃一下舊的詳情。
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
