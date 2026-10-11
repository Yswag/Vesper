// 離線閱讀的 ChapterSession：整條路只讀離線 manifest 與本機檔案。
//
// 為什麼不沿用 ComicLibrary 的 chapter()：那條路進來會先 requireSource 再問一次詳情，
// 飛航模式下不該有任何碰源的機會。這一話能不能讀，進來之前就由離線狀態決定了。
// 因此這裡不 import sources/*，也不發任何請求：頁面清單與位元組都來自引擎的離線層。

import type { ChapterSession } from "../../app/comic"
import { readBytes } from "../../engine/fs"
import { chapterOf, offlinePagePath, statusOf, type OfflineKey } from "../../engine/offline"
import { t } from "../../i18n"

/** 這一章下載完了沒（目錄能列、閱讀器能開的都必須是 `done`）。 */
export function isOfflineReadable(key: OfflineKey): boolean {
  return statusOf(key).state === "done"
}

/**
 * 用離線 manifest 開一個閱讀 session。
 *
 * 沒下載完的章不該走到這裡（呼叫端已先篩過）；真的走到了就讓 `pageImage` 在缺的那一頁拋錯，
 * ChapterImage 會把訊息顯示出來，不會崩潰。
 */
export function createOfflineSession(key: OfflineKey): ChapterSession {
  const chapter = chapterOf(key)
  if (!chapter) throw new Error(t("sources.notOffline"))

  const imageKeys = chapter.imageKeys
  /** 這一頁的圖片鍵；越界就拋（與線上 session 同一個守衛形狀）。 */
  const imageKeyOf = (index: number): string => {
    const imageKey = imageKeys[index]
    if (imageKey === undefined) throw new Error(t("common.pageMissing", { n: index + 1, total: imageKeys.length }))
    return imageKey
  }

  return {
    ref: key,
    title: chapter.epTitle ?? key.epId,
    comicTitle: chapter.comicTitle ?? "",
    cover: chapter.cover,
    pageCount: imageKeys.length,
    offline: statusOf(key),
    imageKey: imageKeyOf,
    pageImage: async (index: number) => {
      // 圖片鍵對不上（源換過這一章的圖）或檔案被刪掉，`offlinePagePath` 都會回 null。
      const path = offlinePagePath(key, index, imageKeyOf(index))
      const bytes = path ? readBytes(path) : null
      if (!bytes) throw new Error(t("sources.pageUnreadable", { n: index + 1 }))
      return bytes
    },
    // 檔案就在本機、又沒有記憶體快取，所以沒有預取與清理可做。
    warm: () => {},
    dispose: () => {},
  }
}
