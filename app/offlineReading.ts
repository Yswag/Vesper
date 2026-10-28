// 離線閱讀：一話能不能從本機讀、以及完全不碰源的 ChapterSession。
// 這是「這一話在不在手機上」的判斷，逐話選來源的入口在 `comicLibrary().chapter()`。
// （跟 `app/offlineSession.ts` 的下載背景工作無關。）

import type { ChapterSession, PageRender } from "./comic"
import { readBytes } from "../engine/fs"
import { chapterOf, offlinePagePath, statusOf, type OfflineKey } from "../engine/offline"
import { closeRenderDir, createPageAspects, findSharpenedPage, openRenderDir, writeSharpenedPage } from "../engine/pagefiles"
import { isSafeForUpscale, sharpenImage } from "../engine/upscale"
import { getReaderSettings } from "../library/readerSettings"
import { log } from "../engine/log"
import { hasPro } from "../engine/pro"
import { t } from "../i18n"

/** `warm(page)` 先量好的範圍：往後 6 頁、往前 2 頁（一頁約 1ms）。 */
const WARM_AHEAD = 6
const WARM_BEHIND = 2

/** 這一章下載完了沒（目錄能列、閱讀器能開的都必須是 `done`）。 */
export function isOfflineReadable(key: OfflineKey): boolean {
  return statusOf(key).state === "done"
}

/**
 * 判斷續讀是否先開本機（上次以離線閱讀且該章節仍保留於本機）。
 */
export function canResumeOffline(key: OfflineKey, offline: boolean | undefined): boolean {
  return offline === true && isOfflineReadable(key)
}

/**
 * 透過離線 manifest 建立閱讀會話。
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

  // 超分需要本機 HttpServer（Scripting Pro）；沒有就別排隊。
  let hardwareSharpenEnabled = getReaderSettings().hardwareSharpen && hasPro()

  // 原圖直接採用本地磁碟檔案路徑；超分圖產生後寫入 session 暫存目錄供 Canvas 渲染
  const renderDir = openRenderDir(key.epId)
  // 解碼過的頁比例：頁面重掛時可以直接沿用，不必先出佔位再跳成真尺寸。
  const aspects = createPageAspects()
  // 已經備好的頁：重掛時直接拿來當初始值（省掉一次 loadPage 與佔位→圖的交換）。
  const renders = new Map<number, PageRender>()
  /** 記住這頁的渲染結果再回傳。 */
  const memoRender = (index: number, render: PageRender | null): PageRender | null => {
    if (render) renders.set(index, render)
    return render
  }
  let disposed = false

  const loadPageBytes = async (index: number): Promise<Uint8Array> => {
    // 圖片鍵對不上（源換過這一章的圖）或檔案被刪掉，`offlinePagePath` 都會回 null。
    const path = offlinePagePath(key, index, imageKeyOf(index))
    const bytes = path ? readBytes(path) : null
    if (!bytes) throw new Error(t("sources.pageUnreadable", { n: index + 1 }))
    return bytes
  }

  /** 離線的原圖路徑（就是顯示要用的那一個）。拿不到就回 null。 */
  const sourcePath = (index: number): string | null => offlinePagePath(key, index, imageKeyOf(index))

  /**
   * 同步量好一頁的比例並記住原圖渲染：頁面掛上去時 `renderOf` 就有值，
   * 不必先出轉圈、高度也不會從估計值跳成真值。讀不到就略過，由 `loadPage` 報錯。
   */
  const prepare = (index: number): void => {
    if (index < 0 || index >= imageKeys.length || renders.has(index)) return
    const path = sourcePath(index)
    const bytes = path ? readBytes(path) : null
    if (!path || !bytes || bytes.length === 0) return
    const decoded = UIImage.fromData(Data.fromUint8Array(bytes)!)
    if (!decoded) return
    const aspect = decoded.width / decoded.height
    aspects.set(index, aspect)
    renders.set(index, { path, aspect })
  }

  return {
    ref: key,
    title: chapter.epTitle ?? key.epId,
    comicTitle: chapter.comicTitle ?? "",
    cover: chapter.cover,
    pageCount: imageKeys.length,
    offline: statusOf(key),
    local: true,
    imageKey: imageKeyOf,
    aspectOf: index => aspects.get(index),
    renderOf: index => renders.get(index) ?? null,
    pageImage: loadPageBytes,
    loadPage: async (
      index: number,
      onSharpened?: (render: PageRender) => void,
      isCancelled?: () => boolean
    ): Promise<PageRender | null> => {
      // 已經備好這頁、又沒有超分要跑（預設）：直接回，不再重讀一次檔。
      const ready = renders.get(index)
      if (ready && !hardwareSharpenEnabled) return ready

      const bytes = await loadPageBytes(index)
      if (isCancelled && isCancelled()) return null

      // 解碼只是為了量長寬；超分圖與寫檔都沿用這個比例。
      // `fromUint8Array` 宣告回 `Data | null`（空陣列才 null）；這裡的 bytes 剛從檔案讀出來，一定非空。
      const decoded = UIImage.fromData(Data.fromUint8Array(bytes)!)
      if (!decoded) return null
      const aspect = decoded.width / decoded.height
      aspects.set(index, aspect)
      const name = `p${index}`

      // 超分圖已經算過就先給它（回捲／重新掛載不必重跑，也不會先閃原圖再換）。
      if (hardwareSharpenEnabled) {
        const cached = findSharpenedPage(renderDir, name, aspect)
        if (cached) return memoRender(index, cached)
      }

      // 漸進式超分：離線閱讀同樣享受 ACNet ONNX 超分
      if (hardwareSharpenEnabled && isSafeForUpscale(decoded.width, decoded.height)) {
        if (onSharpened) {
          const pageKey = `${key.epId}_p${index}`
          const t0 = Date.now()
          void sharpenImage(pageKey, Data.fromUint8Array(bytes)!, isCancelled).then(result => {
            // `disposed` 一起擋：晚到的結果再寫檔會把 dispose 剛刪掉的目錄又建回來。
            if (!result || disposed || (isCancelled && isCancelled())) return
            const costMs = Date.now() - t0
            if (result.fromCache) {
              log("debug", "upscale", `第 ${index + 1} 頁 (離線) ACNet ONNX [快取命中]，0ms 直接顯示`)
            } else {
              log("info", "upscale", `第 ${index + 1} 頁 (離線) ACNet ONNX 超分完成，耗時 ${costMs}ms`)
            }
            const sharpened = writeSharpenedPage(
              renderDir,
              name,
              new Uint8Array(result.data.toArrayBuffer()),
              aspect
            )
            if (sharpened) {
              // 超分圖也要記住：下次重掛直接顯示超分版，不會先閃原圖。
              memoRender(index, sharpened)
              onSharpened(sharpened)
            }
          })
        }
      }

      const path = sourcePath(index)
      if (!path) return null
      return memoRender(index, { path, aspect })
    },
    setHardwareSharpen: enabled => {
      hardwareSharpenEnabled = enabled && hasPro()
    },
    warm: page => {
      if (disposed) return
      for (let i = page; i <= page + WARM_AHEAD; i++) prepare(i)
      for (let i = page - 1; i >= page - WARM_BEHIND; i--) prepare(i)
    },
    // 超分圖的暫存檔要收掉。
    dispose: () => {
      disposed = true
      closeRenderDir(renderDir)
    },
  }
}
