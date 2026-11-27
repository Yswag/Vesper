import { AbortController, type AbortSignal } from "scripting"

import { getPageCacheBytes, getPageCacheChapters } from "./cacheSetting"

import type { ComicListItem, ComicListPage, JumpTarget, SectionPage } from "../engine/adapt"
import { cachedImagePath, cachedThumbnailPath, toCacheSpec } from "../engine/imagecache"
import {
  cacheChapterList,
  cachedChapterList,
  chapterOf,
  comicCount,
  comicGroupKey,
  listChapters,
  mergeChapterList,
  readerImageBytes,
  saveChapterList,
  statusOf,
  totalBytes,
  type OfflineChapter,
  type OfflineStatus,
  type ReaderChapter,
} from "../engine/offline"
import { clearUpscaleCache, planUpscale, sharpenImage } from "../engine/upscale"
import {
  getPrefetchPages,
  getReaderSettings,
  getSourceViewer,
  setSourceViewer,
  type SourceViewer,
} from "../library/readerSettings"
import { t } from "../i18n"
import { getProgress, subscribeLibrary } from "../library/bookshelf"
import { log } from "../engine/log"
import { hasPro } from "../engine/pro"
import {
  createPageAspects,
  displayPixels,
  pageName,
  type PageFrame,
  type PageRender,
} from "../engine/pagefiles"
import { cachedChapterImageKeys, openChapterCache, sweepPageCache } from "../engine/pagecache"
import { readBytes } from "../engine/fs"
import { createPageCache } from "../engine/pageimages"
import { halfRect, halfSuffix, slotAspect, type SlotHalf } from "../engine/pageslots"
import { createPrefetchQueue } from "../engine/prefetch"
import {
  hasCategoryPage,
  loadCategoryOptionRows,
  loadCategoryParts,
  type CategoryChip,
  type CategoryOptionRow,
  type CategoryPart,
} from "../sources/category"
import {
  activeDownloadCount,
  cancelChapterDownload,
  chapterDownloadState,
  deleteChapterDownload,
  downloadChapters,
  isActive,
  listDownloads,
  subscribeDownloads,
  type ChapterDownloadState,
  type DownloadRecord,
} from "../sources/downloads"
import type { AidokuSettingsSpec } from "../sources/aidoku"
import {
  hasMoreComments,
  loadDetail,
  type ComicDetail,
  type ComicStatus,
  type ContentRating,
  type HomeChapter,
  type HomeChapterEntry,
  type HomeComponent,
  type HomeFilterItem,
  type HomeLink,
  type HomeLinkTarget,
  type HomeListing,
  type SourceComment,
  type SourceHome,
} from "../sources/operations"
import {
  accountSpec,
  enabledSources,
  findSource,
  isReady,
  sourceKindOf,
  sourcesRevision,
  subscribeSources,
  type InstalledSource,
  type SourceKind,
} from "../sources/registry"
import {
  openSource,
  type Cursor,
  type ExploreEntry,
  type ListTarget,
  type RankingOption,
  type SourceHandle,
} from "../sources/runner"
import { searchAll, searchOne, type SearchProgress, type SourceSearchResult } from "../sources/search"
import { searchOptionRows, type SearchOptionRow } from "../sources/searchOptions"
import { canResumeOffline, createOfflineSession, isOfflineReadable } from "./offlineReading"

export { isActive }
export type {
  CategoryChip,
  CategoryOptionRow,
  CategoryPart,
  ChapterDownloadState,
  DownloadRecord,
  ExploreEntry,
  HomeChapter,
  HomeChapterEntry,
  HomeComponent,
  HomeFilterItem,
  HomeLink,
  HomeLinkTarget,
  HomeListing,
  ListTarget,
  RankingOption,
  ReaderChapter,
  SearchOptionRow,
  SearchProgress,
  SectionPage,
  SourceComment,
  SourceHome,
}

export interface ComicRef {
  sourceKey: string
  comicId: string
}

export interface ChapterRef extends ComicRef {
  epId: string
}

export interface SearchQuery {
  keyword: string
  optionsOf?: (sourceKey: string) => Array<string | null>
}

export interface ComicPage {
  ref: ComicRef
  title: string
  cover?: string
  description?: string
  status?: ComicStatus
  contentRating?: ContentRating
  viewer?: SourceViewer
  stars?: number
  subId?: string
  tags: Array<{ namespace: string; values: string[] }>
  updateTime?: string
  uploadTime?: string
  uploader?: string
  artists?: string
  likesCount?: number
  url?: string
  recommend?: ComicListItem[]
  sourceName: string
  comments: boolean
  canPostComment: boolean
  chapters: Array<{ ref: ChapterRef; title: string; group: string; locked: boolean; lang?: string; download: ChapterDownloadState }>
}

export interface ChapterSession {
  readonly ref: ChapterRef
  readonly title: string
  readonly comicTitle: string
  readonly cover?: string
  readonly pageCount: number
  readonly offline: OfflineStatus
  readonly local: boolean
  imageKey(index: number): string
  aspectOf(index: number): number | null
  subscribeAspects(listener: (index: number, aspect: number) => void): () => void
  renderOf(index: number, half?: SlotHalf): PageRender | null
  pageImage(index: number): Promise<Uint8Array>
  loadPage(
    index: number,
    onSharpened?: (render: PageRender) => void,
    isCancelled?: () => boolean,
    frame?: PageFrame,
    half?: SlotHalf
  ): Promise<PageRender | null>
  setHardwareSharpen(enabled: boolean): void
  warm(page: number): void
  warmAhead(pages: number): Promise<void>
  dropCache(): void
  dispose(): void
}

export type { PageRender }

export interface ResumePoint {
  chapter: ChapterRef
  page: number
  offline: boolean
}

export interface ResumePlan {
  epId: string
  page?: number
  chapters: ReaderChapter[]
  refreshChapters: boolean
  comicTitle: string
  comicCover?: string
  viewer?: SourceViewer
}

export type ResumeFailure =
  | { reason: "noChapters" }
  | { reason: "allLocked" }
  | { reason: "unavailable"; message: string }

function readerChapterOf(
  id: string,
  chapter: { title?: string; group?: string; locked?: boolean }
): ReaderChapter {
  return {
    id,
    title: chapter.title || chapter.group || t("detail.singleChapter"),
    group: chapter.group,
    locked: chapter.locked === true ? true : undefined,
  }
}

function readerChaptersOf(chapters: ComicPage["chapters"]): ReaderChapter[] {
  return chapters.map(chapter => readerChapterOf(chapter.ref.epId, chapter))
}

function chapterListOf(chapters: ComicDetail["chapters"]): ReaderChapter[] {
  return chapters.map(chapter => readerChapterOf(chapter.id, chapter))
}

function resumePointOf(ref: ComicRef): ResumePoint | null {
  const progress = getProgress(ref.sourceKey, ref.comicId)
  if (!progress?.epId) return null
  const page = progress.page ?? 0
  const count = progress.pageCount
  return {
    chapter: { ...ref, epId: progress.epId },
    page: Math.max(0, count && count > 0 ? Math.min(page, count - 1) : page),
    offline: progress.offline === true,
  }
}

export interface ComicSourceInfo {
  key: string
  kind: SourceKind
  name: string
  version: string
  iconUrl?: string
  hasCategory: boolean
  hasRanking: boolean
  hasHome: boolean
  searchOptions: SearchOptionRow[]
  settingsSpec?: AidokuSettingsSpec
  needsLogin: boolean
  accountName?: string
}

export interface ComicCommentTarget extends ComicRef {
  subId?: string
}

export interface CommentPage {
  comments: SourceComment[]
  hasMore: boolean
}

export interface ChapterDownloadRequest extends ChapterRef {
  title?: string
}

export interface OfflineComic extends ComicRef {
  title?: string
  cover?: string
  sourceName?: string
  chapters: number
  completed: number
  active: number
  bytes: number
  updatedAt: number
}

export interface OfflineChapterRow {
  ref: ChapterRef
  title: string
  state: ChapterDownloadState
  pages: number
  bytes: number
}

export interface OfflineLibrary {
  comics(): OfflineComic[]
  comic(ref: ComicRef): OfflineComic | undefined
  chapters(ref: ComicRef): OfflineChapterRow[]
  readerChapters(ref: ComicRef): ReaderChapter[]
  deleteComic(ref: ComicRef): Promise<void>
  deleteChapter(ref: ChapterRef): Promise<void>
  cancelComic(ref: ComicRef): void
  comicCount(): number
  totalBytes(): number
  activeChapterCount(): number
}

export interface DownloadMeta {
  comicTitle?: string
  cover?: string
}

export interface ComicLibrary {
  sources(): ComicSourceInfo[]
  source(key: string): ComicSourceInfo | undefined
  search(
    query: SearchQuery,
    onProgress?: (progress: SearchProgress) => void,
    opts?: { signal?: AbortSignal }
  ): Promise<SourceSearchResult[]>
  searchSource(
    sourceKey: string,
    keyword: string,
    options: Array<string | null>,
    opts?: { signal?: AbortSignal; filters?: unknown[] }
  ): Promise<SourceSearchResult>
  explore(sourceKey: string): Promise<ExploreEntry[]>
  hasHome(sourceKey: string): boolean
  home(sourceKey: string, opts?: { reload?: boolean }): Promise<SourceHome>
  browse(sourceKey: string, target: ListTarget, cursor?: Cursor): Promise<SectionPage>
  rankingOptions(sourceKey: string): RankingOption[]
  ranking(sourceKey: string, option: string, page: number): Promise<ComicListPage>
  categoryParts(sourceKey: string): Promise<CategoryPart[]>
  categoryOptionRows(sourceKey: string, target: JumpTarget): Promise<CategoryOptionRow[]>
  comic(ref: ComicRef, opts?: { background?: boolean; fresh?: boolean }): Promise<ComicPage>
  chapter(ref: ChapterRef): Promise<ChapterSession>
  prefetchChapter(ref: ChapterRef, pages: number): Promise<void>
  releasePrefetched(): void
  resume(ref: ComicRef): ResumePoint | null
  resumePlan(ref: ComicRef): Promise<ResumePlan | ResumeFailure>
  readerChapters(page: ComicPage): ReaderChapter[]
  comments(target: ComicCommentTarget, page: number): Promise<CommentPage>
  postComment(target: ComicCommentTarget, content: string): Promise<void>
  thumbnailPath(sourceKey: string, url: string): Promise<string>
  thumbnailDisplayPath(sourceKey: string, url: string): Promise<string>
  download(chapters: ChapterDownloadRequest[], meta?: DownloadMeta): Promise<void>
  downloadState(ref: ChapterRef): ChapterDownloadState
  cancelDownload(ref: ChapterRef): void
  listDownloads(): DownloadRecord[]
  offline: OfflineLibrary
  onChange(listener: () => void): () => void
}

function requireSource(key: string): InstalledSource {
  const source = findSource(key)
  if (!source) throw new Error(t("sources.notFound", { key }))
  if (!isReady(source)) throw new Error(source.error ?? t("sources.notLoaded", { name: source.stored.name }))
  return source
}

function handleOf(key: string): { source: InstalledSource; handle: SourceHandle } {
  const source = requireSource(key)
  return { source, handle: openSource(source) }
}

let infoCacheRevision = -1
let infoCache = new WeakMap<InstalledSource, ComicSourceInfo>()

function browsableSources(): InstalledSource[] {
  return enabledSources()
}

function infoOf(source: InstalledSource): ComicSourceInfo {
  const revision = sourcesRevision()
  if (revision !== infoCacheRevision) {
    infoCacheRevision = revision
    infoCache = new WeakMap()
  }
  const cached = infoCache.get(source)
  if (cached) return cached

  const account = accountSpec(source)
  const info: ComicSourceInfo = {
    key: source.stored.key,
    kind: sourceKindOf(source),
    name: source.meta?.name ?? source.stored.name,
    version: source.meta?.version ?? source.stored.version,
    iconUrl: source.stored.iconUrl,
    settingsSpec: source.settingsSpec,
    hasCategory: hasCategoryPage(source),
    hasRanking: openSource(source).hasRanking(),
    hasHome: openSource(source).hasHome(),
    searchOptions: searchOptionRows(source),
    needsLogin: account != null && source.stored.loggedIn !== true,
    accountName: source.stored.accountName,
  }
  infoCache.set(source, info)
  return info
}

function sourceNameOf(sourceKey: string): string | undefined {
  const source = findSource(sourceKey)
  return source ? source.meta?.name ?? source.stored.name : undefined
}

function offlineComics(): OfflineComic[] {
  const groups = new Map<string, OfflineComic>()

  for (const chapter of listChapters()) {
    const id = comicGroupKey(chapter.key)
    let group = groups.get(id)
    if (!group) {
      group = {
        sourceKey: chapter.key.sourceKey,
        comicId: chapter.key.comicId,
        sourceName: sourceNameOf(chapter.key.sourceKey),
        chapters: 0,
        completed: 0,
        active: 0,
        bytes: 0,
        updatedAt: 0,
      }
      groups.set(id, group)
    }
    const status = statusOf(chapter.key)
    group.chapters++
    if (status.state === "done") group.completed++
    if (isActive(chapterDownloadState(chapter.key).state)) group.active++
    group.bytes += status.bytes
    group.updatedAt = Math.max(group.updatedAt, chapter.updatedAt)
    group.title ??= chapter.comicTitle
    group.cover ??= chapter.cover
  }

  return [...groups.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

function offlineChapterRows(ref: ComicRef): OfflineChapterRow[] {
  const rowOf = (chapter: OfflineChapter): OfflineChapterRow => {
    const status = statusOf(chapter.key)
    return {
      ref: { ...ref, epId: chapter.key.epId },
      title: chapter.epTitle ?? chapter.key.epId,
      state: chapterDownloadState(chapter.key),
      pages: status.total,
      bytes: status.bytes,
    }
  }

  const rows: OfflineChapterRow[] = []
  const listed = new Set<string>()
  for (const item of mergeChapterList(cachedChapterList(ref.sourceKey, ref.comicId), ref.sourceKey, ref.comicId)) {
    const chapter = chapterOf({ ...ref, epId: item.id })
    if (!chapter) continue
    rows.push(rowOf(chapter))
    listed.add(item.id)
  }
  const rest = listChapters()
    .filter(chapter => chapter.key.sourceKey === ref.sourceKey && chapter.key.comicId === ref.comicId)
    .filter(chapter => !listed.has(chapter.key.epId))
    .sort((a, b) => a.updatedAt - b.updatedAt)
  for (const chapter of rest) rows.push(rowOf(chapter))
  return rows
}

export async function resumePlan(
  ref: ComicRef,
  loadComic: (ref: ComicRef) => Promise<ComicPage>
): Promise<ResumePlan | ResumeFailure> {
  const progress = getProgress(ref.sourceKey, ref.comicId)
  const resumed = resumePointOf(ref)
  const wantedEpId = resumed?.chapter.epId

  if (wantedEpId !== undefined && canResumeOffline({ ...ref, epId: wantedEpId }, resumed?.offline)) {
    return {
      epId: wantedEpId,
      page: resumed?.page,
      chapters: mergeChapterList(cachedChapterList(ref.sourceKey, ref.comicId), ref.sourceKey, ref.comicId),
      refreshChapters: true,
      comicTitle: progress?.title ?? wantedEpId,
      comicCover: progress?.cover,
      viewer: getSourceViewer(ref),
    }
  }

  if (wantedEpId !== undefined && progress) {
    const viewer = getSourceViewer(ref)
    const cached = cachedChapterList(ref.sourceKey, ref.comicId)
    if (cached) {
      const merged = mergeChapterList(cached, ref.sourceKey, ref.comicId)
      const wanted = merged.find(chapter => chapter.id === wantedEpId)
      if (wanted && !wanted.locked) {
        return {
          epId: wantedEpId,
          page: resumed?.page,
          chapters: merged,
          refreshChapters: true,
          comicTitle: progress.title || wantedEpId,
          comicCover: progress.cover,
          viewer,
        }
      }
      const fallback = merged.find(chapter => !chapter.locked)
      if (fallback) {
        return {
          epId: fallback.id,
          page: undefined,
          chapters: merged,
          refreshChapters: true,
          comicTitle: progress.title || wantedEpId,
          comicCover: progress.cover,
          viewer,
        }
      }
      return { reason: "allLocked" }
    }
    return {
      epId: wantedEpId,
      page: resumed?.page,
      chapters: [{ id: wantedEpId, title: progress.epTitle || wantedEpId }],
      refreshChapters: true,
      comicTitle: progress.title || wantedEpId,
      comicCover: progress.cover,
      viewer,
    }
  }

  let page: ComicPage
  try {
    page = await loadComic(ref)
  } catch (error) {
    return { reason: "unavailable", message: error instanceof Error ? error.message : String(error) }
  }

  const chapters = readerChaptersOf(page.chapters)
  if (chapters.length === 0) return { reason: "noChapters" }
  const target = chapters.some(chapter => chapter.id === wantedEpId && !chapter.locked)
    ? wantedEpId
    : chapters.find(chapter => !chapter.locked)?.id
  if (target === undefined) return { reason: "allLocked" }

  setSourceViewer(ref, page.viewer)

  return {
    epId: target,
    page: target === wantedEpId ? resumed?.page : undefined,
    chapters,
    refreshChapters: false,
    comicTitle: progress?.title ?? page.title,
    comicCover: progress?.cover ?? page.cover,
    viewer: page.viewer,
  }
}

export function createComicLibrary(): ComicLibrary {
  function onChange(listener: () => void): () => void {
    const stops = [subscribeSources(listener), subscribeDownloads(listener), subscribeLibrary(listener)]
    return () => stops.forEach(stop => stop())
  }

  const loadComic = async (ref: ComicRef, opts?: { background?: boolean; fresh?: boolean }): Promise<ComicPage> => {
    const { source, handle } = handleOf(ref.sourceKey)
    const background = opts?.background === true
    const fresh = opts?.fresh === true
    const scope = background || fresh ? { background, fresh } : undefined
    const detail = await loadDetail(source, ref.comicId, scope)
    cacheChapterList(ref.sourceKey, ref.comicId, chapterListOf(detail.chapters))
    return {
      ref,
      title: detail.title,
      cover: detail.cover,
      description: detail.description,
      status: detail.status,
      contentRating: detail.contentRating,
      viewer: detail.viewer,
      stars: detail.stars,
      subId: detail.subId,
      tags: detail.tags,
      updateTime: detail.updateTime,
      uploadTime: detail.uploadTime,
      uploader: detail.uploader,
      artists: detail.artists,
      likesCount: detail.likesCount,
      url: detail.url,
      recommend: detail.recommend,
      sourceName: source.meta?.name ?? source.stored.name,
      comments: handle.capabilities?.comments === true,
      canPostComment: handle.canPostComment(),
      chapters: detail.chapters.map(chapter => {
        const chapterRef: ChapterRef = { ...ref, epId: chapter.id }
        return {
          ref: chapterRef,
          title: chapter.title,
          group: chapter.group,
          locked: chapter.locked === true,
          lang: chapter.lang,
          download: chapterDownloadState(chapterRef),
        }
      }),
    }
  }

  let activeChapterDir: string | null = null

  async function openChapter(ref: ChapterRef): Promise<ChapterSession> {
    const key = { sourceKey: ref.sourceKey, comicId: ref.comicId, epId: ref.epId }
    if (isOfflineReadable(key)) return createOfflineSession(key)

    const { handle } = handleOf(ref.sourceKey)
    const cachedKeys = cachedChapterImageKeys(key)
    const usableKeys = cachedKeys !== null && (handle.acceptsImageKeys?.(cachedKeys) ?? true) ? cachedKeys : null
    if (cachedKeys && usableKeys === null) log("debug", "reader", `${ref.epId} 的磁碟圖片鍵是舊格式，重問源`)
    if (usableKeys) log("debug", "reader", `${ref.epId} 整話命中磁碟（${usableKeys.length} 頁），不問源`)
    const imageKeys = usableKeys ?? (await handle.chapter(ref.comicId, ref.epId))
    const chapterCache = openChapterCache(key, imageKeys)
    const renderDir = chapterCache.dir
    const pageIndex = chapterCache.pages
    activeChapterDir = renderDir
    let sweepAfterFirstPage: (() => void) | null = () => {
      sweepAfterFirstPage = null
      setTimeout(() => {
        void sweepPageCache(() => activeChapterDir, {
          chapters: getPageCacheChapters(),
          bytes: getPageCacheBytes(),
        })
      }, 0)
    }
    const markFirstPage = () => sweepAfterFirstPage?.()
    const controller = new AbortController()
    const pageCache = createPageCache()
    const imageKeyOf = (index: number): string => {
      const imageKey = imageKeys[index]
      if (imageKey === undefined) throw new Error(t("common.pageMissing", { n: index + 1, total: imageKeys.length }))
      return imageKey
    }
    const retry = handle.imageRetry({ signal: controller.signal })
    const loadPageBytes = async (index: number) => {
      const name = pageName(index, imageKeyOf(index))
      const hit = pageIndex.find(name)
      const cached = hit ? readBytes(hit) : null
      if (cached) {
        markFirstPage()
        log("debug", "image", `正文命中磁碟（第 ${index + 1} 頁）`)
        return cached
      }
      if (hit) pageIndex.forget(name)
      const bytes = await readerImageBytes(
        {
          ...key,
          pageIndex: index,
          imageKey: imageKeyOf(index),
          comicModule: handle.comicModule,
          retry,
        },
        pageCache,
        controller.signal
      )
      markFirstPage()
      return bytes
    }
    const aspects = createPageAspects()
    const prefetch = createPrefetchQueue({
      total: imageKeys.length,
      signal: controller.signal,
      load: async page => {
        if (!renders.has(String(page))) await loadPage(page)
      },
      ahead: getPrefetchPages,
      onError: (page, error) => log("debug", "reader", `${ref.epId} 預取第 ${page + 1} 頁失敗`, error),
    })

    let hardwareSharpenEnabled = getReaderSettings().hardwareSharpen && hasPro()

    const renders = new Map<string, PageRender>()
    const memoRender = (index: number, render: PageRender | null): PageRender | null => {
      if (render) renders.set(`${index}${halfSuffix(render.half)}`, render)
      return render
    }
    const renderOf = (index: number, half?: SlotHalf): PageRender | null =>
      (half ? renders.get(`${index}${halfSuffix(half)}`) : undefined) ?? renders.get(String(index)) ?? null
    let disposed = false

    const aspectOfFile = (path: string): number | null => {
      const decoded = UIImage.fromFile(path)
      if (!decoded || !decoded.width || !decoded.height) return null
      return decoded.width / decoded.height
    }

    const loadPage = async (
      index: number,
      onSharpened?: (render: PageRender) => void,
      isCancelled?: () => boolean,
      frame?: PageFrame,
      half?: SlotHalf
    ): Promise<PageRender | null> => {
      if (!hardwareSharpenEnabled) {
        const ready = renders.get(String(index))
        if (ready) return ready
        const name = pageName(index, imageKeyOf(index))
        const hit = pageIndex.find(name)
        const aspect = hit ? aspectOfFile(hit) : null
        if (hit && aspect !== null) {
          aspects.set(index, aspect)
          return memoRender(index, { path: hit, aspect })
        }
        if (hit) pageIndex.forget(name)
      }

      const bytes = await loadPageBytes(index)
      if (isCancelled && isCancelled()) return null

      const data = Data.fromUint8Array(bytes)
      if (!data) return null
      const decoded = UIImage.fromData(data)
      if (!decoded) return null
      const aspect = decoded.width / decoded.height
      aspects.set(index, aspect)

      const name = pageName(index, imageKeyOf(index))
      const target = hardwareSharpenEnabled && frame
        ? planUpscale(halfRect(decoded.width, decoded.height, half), displayPixels(frame, slotAspect(aspect, half)))
        : null
      const sharpenedName = target ? `${name}${halfSuffix(half)}-${target.outWidth}x${target.outHeight}` : ""
      const sizes = `${decoded.width}×${decoded.height}${halfSuffix(half)}→${target ? `${target.outWidth}×${target.outHeight}` : ""}`
      if (hardwareSharpenEnabled && frame && !target) {
        log("debug", "upscale", `第 ${index + 1} 頁不超分（${decoded.width}×${decoded.height}，沒有放大效益或縮後超過上限）`)
      }
      if (target) {
        const cached = pageIndex.findSharpened(sharpenedName, aspect)
        if (cached) return memoRender(index, { ...cached, half })
      }

      if (disposed) return null
      const existed = pageIndex.find(name) !== null
      const render = pageIndex.write(name, bytes, aspect)
      if (!render) return null
      if (!existed) chapterCache.account(bytes.byteLength)

      if (target) {
        if (onSharpened) {
          const pageKey = `${ref.epId}_p${index}`
          const t0 = Date.now()
          void sharpenImage(pageKey, data, isCancelled, target).then(result => {
            if (!result || disposed || (isCancelled && isCancelled())) return
            const costMs = Date.now() - t0
            const engineLabel = result.backend === "coreml" ? "Core ML" : "ONNX"
            if (result.fromCache) {
              log("debug", "upscale", `第 ${index + 1} 頁 ${engineLabel} [快取命中]，0ms 直接顯示`)
            } else {
              log("info", "upscale", `第 ${index + 1} 頁 ${engineLabel} 超分完成 ${sizes}，耗時 ${costMs}ms`)
            }
            const size = result.data.size
            const limit = getPageCacheBytes()
            if (limit > 0 && chapterCache.bytes() + size > limit) {
              log("debug", "cache", `第 ${index + 1} 頁超分圖不落地（這一話已達正文快取上限）`)
              return
            }
            const hadSharpened = pageIndex.findSharpened(sharpenedName, aspect) !== null
            const sharpened = pageIndex.writeSharpened(sharpenedName, result.data, aspect)
            if (sharpened) {
              if (!hadSharpened) chapterCache.account(size)
              const render = { ...sharpened, half }
              memoRender(index, render)
              onSharpened(render)
            }
          })
        }
      }

      if (!frame) return renders.get(String(index)) ?? memoRender(index, render)
      return memoRender(index, render)
    }

    return {
      ref,
      title: ref.epId,
      comicTitle: "",
      pageCount: imageKeys.length,
      offline: statusOf(key),
      local: false,
      imageKey: index => imageKeyOf(index),
      aspectOf: index => aspects.get(index),
      subscribeAspects: aspects.subscribe,
      renderOf,
      pageImage: loadPageBytes,
      loadPage,
      setHardwareSharpen: enabled => {
        hardwareSharpenEnabled = enabled && hasPro()
      },
      warm: page => prefetch.focus(page),
      warmAhead: async pages => {
        const count = Math.min(Math.max(pages, 0), imageKeys.length)
        let next = 0
        const workers = Array.from({ length: Math.min(2, count) }, async () => {
          while (next < count) {
            const index = next++
            try {
              await loadPage(index)
            } catch (error) {
              if (!disposed) log("debug", "reader", `${ref.epId} 預取第 ${index + 1} 頁失敗`, error)
            }
          }
        })
        await Promise.all(workers)
      },
      dispose: () => {
        disposed = true
        prefetch.clear()
        controller.abort()
        pageCache.clear()
        chapterCache.close()
        pageIndex.clear()
        if (activeChapterDir === renderDir) activeChapterDir = null
      },
      dropCache: () => pageCache.dropBytes(),
    }
  }

  let handoff: {
    id: string
    session: Promise<ChapterSession | null>
    warmed: number
    tail: Promise<void>
  } | null = null
  const chapterIdOf = (ref: ChapterRef): string => `${ref.sourceKey}\n${ref.comicId}\n${ref.epId}`
  function releasePrefetched(): void {
    const pending = handoff
    handoff = null
    void pending?.session.then(session => session?.dispose())
  }

  const api: ComicLibrary = {
    sources: () => browsableSources().map(infoOf),

    source: key => {
      const found = findSource(key)
      return found ? infoOf(found) : undefined
    },

    search: (query, onProgress, opts) =>
      searchAll(
        browsableSources(),
        query.keyword,
        source => query.optionsOf?.(source.stored.key) ?? [],
        onProgress ?? (() => {}),
        opts?.signal
      ),

    searchSource: (sourceKey, keyword, options, opts) =>
      searchOne(requireSource(sourceKey), keyword, options, { signal: opts?.signal, filters: opts?.filters }),

    explore: async sourceKey => {
      const { handle } = handleOf(sourceKey)
      if (handle.kind !== "venera") await handle.ready()
      return handle.explore()
    },

    browse: (sourceKey, target, cursor) => handleOf(sourceKey).handle.list(target, cursor ?? { page: 1 }),

    hasHome: sourceKey => handleOf(sourceKey).handle.hasHome(),

    home: (sourceKey, opts) => handleOf(sourceKey).handle.home(opts),

    rankingOptions: sourceKey => handleOf(sourceKey).handle.rankingOptions(),

    ranking: (sourceKey, option, page) => handleOf(sourceKey).handle.ranking(option, page),

    categoryParts: sourceKey => loadCategoryParts(requireSource(sourceKey)),

    categoryOptionRows: (sourceKey, target) => loadCategoryOptionRows(requireSource(sourceKey), target),

    onChange,

    comic: async (ref, opts) => {
      const page = await loadComic(ref, opts)
      setSourceViewer(ref, page.viewer)
      return page
    },

    resumePlan: ref => resumePlan(ref, loadComic),

    readerChapters: page => readerChaptersOf(page.chapters),

    chapter: async ref => {
      if (handoff && handoff.id === chapterIdOf(ref)) {
        const pending = handoff.session
        handoff = null
        const taken = await pending
        if (taken) return taken
      }
      return openChapter(ref)
    },

    prefetchChapter: async (ref, pages) => {
      const id = chapterIdOf(ref)
      const count = Math.max(0, Math.round(pages))
      if (handoff?.id === id) {
        const pending = handoff
        if (count <= pending.warmed) return
        pending.warmed = count
        pending.tail = pending.tail
          .then(async () => {
            const opened = await pending.session
            if (!opened) return
            await opened.warmAhead(pending.warmed)
          })
          .catch(() => {})
        return pending.tail
      }
      releasePrefetched()
      const session = openChapter(ref).catch(error => {
        log("debug", "reader", `${ref.epId} 跨章預取失敗`, error)
        return null
      })
      const entry = { id, session, warmed: count, tail: Promise.resolve() }
      handoff = entry
      entry.tail = session
        .then(async opened => {
          if (!opened) {
            if (handoff === entry) handoff = null
            return
          }
          await opened.warmAhead(entry.warmed)
        })
        .catch(() => {})
      return entry.tail
    },

    releasePrefetched,

    resume: resumePointOf,

    comments: async (target, page) => {
      const { handle } = handleOf(target.sourceKey)
      const result = await handle.comments(target.comicId, target.subId, page)
      return { comments: result.comments, hasMore: hasMoreComments(result.maxPage, page) }
    },

    postComment: async (target, content) => {
      await handleOf(target.sourceKey).handle.postComment(target.comicId, target.subId, content)
    },

    thumbnailPath: async (sourceKey, url) => {
      const { handle } = handleOf(sourceKey)
      const request = await handle.thumbnailRequest(url)
      return cachedImagePath(toCacheSpec(request), sourceKey)
    },

    thumbnailDisplayPath: async (sourceKey, url) => {
      const { handle } = handleOf(sourceKey)
      const request = await handle.thumbnailRequest(url)
      return cachedThumbnailPath(toCacheSpec(request), sourceKey)
    },

    download: async (chapters, meta) => {
      const groups = new Map<string, { sourceKey: string; comicId: string; requests: ChapterDownloadRequest[] }>()
      for (const request of chapters) {
        const id = `${request.sourceKey}\u0000${request.comicId}`
        const group = groups.get(id) ?? { sourceKey: request.sourceKey, comicId: request.comicId, requests: [] }
        group.requests.push(request)
        groups.set(id, group)
      }
      for (const group of groups.values()) {
        const source = requireSource(group.sourceKey)
        const incomplete = meta?.comicTitle === undefined || group.requests.some(request => request.title === undefined)
        const detail = incomplete ? await openSource(source).detail(group.comicId) : undefined
        if (detail) saveChapterList(group.sourceKey, group.comicId, chapterListOf(detail.chapters))
        await downloadChapters(
          source,
          group.comicId,
          group.requests.map(request => ({
            epId: request.epId,
            epTitle: request.title ?? detail?.chapters.find(chapter => chapter.id === request.epId)?.title,
          })),
          { comicTitle: meta?.comicTitle ?? detail?.title, cover: meta?.cover ?? detail?.cover }
        )
      }
    },

    downloadState: ref => chapterDownloadState(ref),

    cancelDownload: ref => cancelChapterDownload(ref),

    offline: {
      comics: offlineComics,

      comic: ref =>
        offlineComics().find(comic => comic.sourceKey === ref.sourceKey && comic.comicId === ref.comicId),

      chapters: offlineChapterRows,

      readerChapters: ref => mergeChapterList(cachedChapterList(ref.sourceKey, ref.comicId), ref.sourceKey, ref.comicId),

      deleteComic: async ref => {
        for (const row of offlineChapterRows(ref)) await deleteChapterDownload(row.ref)
      },

      deleteChapter: ref => deleteChapterDownload(ref),

      cancelComic: ref => {
        for (const row of offlineChapterRows(ref)) {
          if (isActive(row.state.state)) cancelChapterDownload(row.ref)
        }
      },

      comicCount: () => comicCount(),

      totalBytes: () => totalBytes(),

      activeChapterCount: () => activeDownloadCount(),
    },

    listDownloads: () => listDownloads(),
  }

  return api
}
