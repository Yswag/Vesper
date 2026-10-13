// 離線閱讀的 ChapterSession：整條路只讀離線 manifest 與本機檔案。
//
// 為什麼不沿用 ComicLibrary 的 chapter()：那條路進來會先 requireSource 再問一次詳情，
// 飛航模式下不該有任何碰源的機會。這一話能不能讀，進來之前就由離線狀態決定了。
// 因此這裡不 import sources/*，也不發任何請求：頁面清單與位元組都來自引擎的離線層。
//
// 另外收了 `canResumeOffline`：續讀入口與歷史卡的標籤共用這一條判定（只讀離線層，也一樣不碰源）。

import type { ChapterSession } from "../../app/comic"
import { readBytes } from "../../engine/fs"
import { chapterOf, offlinePagePath, statusOf, type OfflineKey } from "../../engine/offline"
import { isSafeForUpscale, sharpenImage } from "../../engine/upscale"
import { getReaderSettings } from "../../library/readerSettings"
import { log } from "../../engine/log"
import { t } from "../../i18n"

/** 這一章下載完了沒（目錄能列、閱讀器能開的都必須是 `done`）。 */
export function isOfflineReadable(key: OfflineKey): boolean {
  return statusOf(key).state === "done"
}

/**
 * 續讀時要走離線嗎：**上次是在離線模式讀的**（書架上的 `Progress.offline`），而且那一話還在下載裡。
 *
 * 只看「有沒有下載」是不夠的：線上看過的作品只要下載過就會被拉進離線（目錄只剩已下載的章，是退化）。
 * 反過來，下載被刪掉就別再走離線——退回線上那條路（源還在的話）。
 * 歷史卡（顯示什麼標籤）與續讀入口（真的走哪條路）共用這一條，顯示與行為才不會不一致。
 */
export function canResumeOffline(key: OfflineKey, offline: boolean | undefined): boolean {
  return offline === true && isOfflineReadable(key)
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

  let hardwareSharpenEnabled = getReaderSettings().hardwareSharpen

  const loadPageBytes = async (index: number): Promise<Uint8Array> => {
    // 圖片鍵對不上（源換過這一章的圖）或檔案被刪掉，`offlinePagePath` 都會回 null。
    const path = offlinePagePath(key, index, imageKeyOf(index))
    const bytes = path ? readBytes(path) : null
    if (!bytes) throw new Error(t("sources.pageUnreadable", { n: index + 1 }))
    return bytes
  }

  return {
    ref: key,
    title: chapter.epTitle ?? key.epId,
    comicTitle: chapter.comicTitle ?? "",
    cover: chapter.cover,
    pageCount: imageKeys.length,
    offline: statusOf(key),
    imageKey: imageKeyOf,
    pageImage: loadPageBytes,
    loadPage: async (
      index: number,
      onSharpened?: (image: UIImage) => void,
      isCancelled?: () => boolean
    ) => {
      const bytes = await loadPageBytes(index)
      if (isCancelled && isCancelled()) return null

      const data = Data.fromUint8Array(bytes)
      if (!data) return null
      const decoded = UIImage.fromData(data)
      if (!decoded) return null

      // 漸進式超分：離線閱讀同樣享受 ACNet ONNX 超分
      if (hardwareSharpenEnabled && isSafeForUpscale(decoded.width, decoded.height)) {
        if (onSharpened) {
          const pageKey = `${key.epId}_p${index}`
          const t0 = Date.now()
          void sharpenImage(pageKey, data, isCancelled).then(result => {
            if (result && (!isCancelled || !isCancelled())) {
              const costMs = Date.now() - t0
              if (result.fromCache) {
                log("debug", "upscale", `第 ${index + 1} 頁 (離線) ACNet ONNX [快取命中]，0ms 直接顯示`)
              } else {
                log("info", "upscale", `第 ${index + 1} 頁 (離線) ACNet ONNX 超分完成，耗時 ${costMs}ms`)
              }
              onSharpened(result.image)
            }
          })
        }
      }

      return decoded
    },
    setHardwareSharpen: enabled => {
      hardwareSharpenEnabled = enabled
    },
    // 檔案就在本機、又沒有記憶體快取，所以沒有預取與清理可做。
    warm: () => {},
    dispose: () => {},
  }
}
