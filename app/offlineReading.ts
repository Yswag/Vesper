import type { ChapterSession, PageRender } from "./comic"
import { readBytes } from "../engine/fs"
import { chapterOf, offlinePagePath, statusOf, type OfflineKey } from "../engine/offline"
import {
  closeRenderDir,
  createPageAspects,
  displayPixels,
  findSharpenedPage,
  openRenderDir,
  writeSharpenedPage,
  type PageFrame,
} from "../engine/pagefiles"
import { halfRect, halfSuffix, slotAspect, type SlotHalf } from "../engine/pageslots"
import { planUpscale, sharpenImage } from "../engine/upscale"
import { getReaderSettings } from "../library/readerSettings"
import { log } from "../engine/log"
import { hasPro } from "../engine/pro"
import { t } from "../i18n"

const WARM_AHEAD = 6
const WARM_BEHIND = 2

export function isOfflineReadable(key: OfflineKey): boolean {
  return statusOf(key).state === "done"
}

export function canResumeOffline(key: OfflineKey, offline: boolean | undefined): boolean {
  return offline === true && isOfflineReadable(key)
}

export function createOfflineSession(key: OfflineKey): ChapterSession {
  const chapter = chapterOf(key)
  if (!chapter) throw new Error(t("sources.notOffline"))

  const imageKeys = chapter.imageKeys
  const imageKeyOf = (index: number): string => {
    const imageKey = imageKeys[index]
    if (imageKey === undefined) throw new Error(t("common.pageMissing", { n: index + 1, total: imageKeys.length }))
    return imageKey
  }

  let hardwareSharpenEnabled = getReaderSettings().hardwareSharpen && hasPro()

  const renderDir = openRenderDir(key.epId)
  const aspects = createPageAspects()
  const renders = new Map<string, PageRender>()
  const memoRender = (index: number, render: PageRender | null): PageRender | null => {
    if (render) renders.set(`${index}${halfSuffix(render.half)}`, render)
    return render
  }
  let disposed = false

  const loadPageBytes = async (index: number): Promise<Uint8Array> => {
    const path = offlinePagePath(key, index, imageKeyOf(index))
    const bytes = path ? readBytes(path) : null
    if (!bytes) throw new Error(t("sources.pageUnreadable", { n: index + 1 }))
    return bytes
  }

  const sourcePath = (index: number): string | null => offlinePagePath(key, index, imageKeyOf(index))

  const prepare = (index: number): void => {
    if (index < 0 || index >= imageKeys.length || renders.has(String(index))) return
    const path = sourcePath(index)
    if (!path) return
    const decoded = UIImage.fromFile(path)
    if (!decoded || !decoded.width || !decoded.height) return
    const aspect = decoded.width / decoded.height
    aspects.set(index, aspect)
    renders.set(String(index), { path, aspect })
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
    subscribeAspects: aspects.subscribe,
    renderOf: (index, half) =>
      (half ? renders.get(`${index}${halfSuffix(half)}`) : undefined) ?? renders.get(String(index)) ?? null,
    pageImage: loadPageBytes,
    loadPage: async (
      index: number,
      onSharpened?: (render: PageRender) => void,
      isCancelled?: () => boolean,
      frame?: PageFrame,
      half?: SlotHalf
    ): Promise<PageRender | null> => {
      const ready = renders.get(String(index))
      if (ready && !hardwareSharpenEnabled) return ready

      const bytes = await loadPageBytes(index)
      if (isCancelled && isCancelled()) return null

      const decoded = UIImage.fromData(Data.fromUint8Array(bytes)!)
      if (!decoded) return null
      const aspect = decoded.width / decoded.height
      aspects.set(index, aspect)
      const name = `p${index}`
      const target = hardwareSharpenEnabled && frame
        ? planUpscale(halfRect(decoded.width, decoded.height, half), displayPixels(frame, slotAspect(aspect, half)))
        : null
      const sharpenedName = target ? `${name}${halfSuffix(half)}-${target.outWidth}x${target.outHeight}` : ""
      const sizes = `${decoded.width}×${decoded.height}${halfSuffix(half)}→${target ? `${target.outWidth}×${target.outHeight}` : ""}`
      if (hardwareSharpenEnabled && frame && !target) {
        log("debug", "upscale", `第 ${index + 1} 頁 (離線) 不超分（${decoded.width}×${decoded.height}，沒有放大效益或縮後超過上限）`)
      }

      if (target) {
        const cached = findSharpenedPage(renderDir, sharpenedName, aspect)
        if (cached) return memoRender(index, { ...cached, half })
      }

      if (target) {
        if (onSharpened) {
          const pageKey = `${key.epId}_p${index}`
          const t0 = Date.now()
          void sharpenImage(pageKey, Data.fromUint8Array(bytes)!, isCancelled, target).then(result => {
            if (!result || disposed || (isCancelled && isCancelled())) return
            const costMs = Date.now() - t0
            const engineLabel = result.backend === "coreml" ? "Core ML" : "ONNX"
            if (result.fromCache) {
              log("debug", "upscale", `第 ${index + 1} 頁 (離線) ${engineLabel} [快取命中]，0ms 直接顯示`)
            } else {
              log("info", "upscale", `第 ${index + 1} 頁 (離線) ${engineLabel} 超分完成 ${sizes}，耗時 ${costMs}ms`)
            }
            const sharpened = writeSharpenedPage(
              renderDir,
              sharpenedName,
              result.data,
              aspect
            )
            if (sharpened) {
              const render = { ...sharpened, half }
              memoRender(index, render)
              onSharpened(render)
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
    warmAhead: async pages => {
      const count = Math.min(Math.max(pages, 0), imageKeys.length)
      for (let i = 0; i < count; i++) prepare(i)
    },
    dispose: () => {
      disposed = true
      closeRenderDir(renderDir)
    },
    dropCache: () => {},
  }
}
