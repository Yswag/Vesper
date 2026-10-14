// ComicLibrary：UI 與 source／offline／download／書架之間的唯一 domain seam。
//
// 畫面只認得這裡的 domain value（來源描述、ComicPage、ChapterSession、下載狀態），
// 不碰 registry、operations、raw `InstalledSource`、offline key 或縮圖快取路徑。
// 不 import JSX，也不擁有下載排程、manifest 格式或 HTML parsing。
// 四個內部依賴（Sources / Offline / Downloads / Shelf）暫時不抽 port ——
// 只有 production adapter 一個實作者時，seam 還不成立（Phase 2 再加 in-memory adapter）。

import { AbortController, type AbortSignal } from "scripting"

import type { ComicListItem, ComicListPage, JumpTarget, SectionPage } from "../engine/adapt"
import { cachedImagePath, toCacheSpec } from "../engine/imagecache"
import { resolveThumbnailRequest } from "../engine/images"
import { readerImageBytes, statusOf, totalBytes, type OfflineStatus } from "../engine/offline"
import { clearUpscaleCache, isSafeForUpscale, sharpenImage } from "../engine/upscale"
import { getReaderSettings } from "../library/readerSettings"
import { t } from "../i18n"
import { getProgress, subscribeLibrary } from "../library/bookshelf"
import { log } from "../engine/log"
import {
  closeRenderDir,
  findSharpenedPage,
  openRenderDir,
  writePage,
  writeSharpenedPage,
  type PageRender,
} from "../engine/pagefiles"
import { createPageCache } from "../engine/pageimages"
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
import { hasMoreComments, type SourceComment } from "../sources/operations"
import {
  accountSpec,
  allSources,
  findSource,
  sourcesRevision,
  subscribeSources,
  type InstalledSource,
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

/** 「還在跑」是下載語意的一部分（畫面判斷要不要給取消／左滑下載都用它）。 */
export { isActive }
export type {
  CategoryChip,
  CategoryOptionRow,
  CategoryPart,
  ChapterDownloadState,
  DownloadRecord,
  ExploreEntry,
  ListTarget,
  RankingOption,
  SearchOptionRow,
  SearchProgress,
  SectionPage,
  SourceComment,
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
  /** 每個源要帶的篩選值（沒提供就不帶）。 */
  optionsOf?: (sourceKey: string) => Array<string | null>
}

export interface ComicPage {
  ref: ComicRef
  title: string
  cover?: string
  description?: string
  /** 源給的星等（0–5，可為小數）；源沒給就沒有。只讀顯示，不寫入。 */
  stars?: number
  /** 源自己的子識別碼（留言 API 要用）。 */
  subId?: string
  tags: Array<{ namespace: string; values: string[] }>
  updateTime?: string
  uploadTime?: string
  uploader?: string
  likesCount?: number
  /** 該漫畫在來源網站上的原始網頁網址（若源有提供）。 */
  url?: string
  /** 相關/推薦漫畫清單（若源有提供）。 */
  recommend?: ComicListItem[]
  /** 來源的顯示名稱；畫面不必再查 registry。 */
  sourceName: string
  /** 源有沒有宣告讀留言（沒有就不出現留言入口）。 */
  comments: boolean
  /** 源有沒有宣告送出留言。 */
  canPostComment: boolean
  chapters: Array<{ ref: ChapterRef; title: string; group: string; download: ChapterDownloadState }>
}

export interface ChapterSession {
  readonly ref: ChapterRef
  readonly title: string
  readonly comicTitle: string
  readonly cover?: string
  readonly pageCount: number
  readonly offline: OfflineStatus
  /**
   * 這一頁的圖片鍵；契約（ticket 05 的 reader 與 download 都吃這一份）：
   * 頁索引 0 起算、連續無洞；鍵是源 `loadEp` 正規化清單的第 `index` 項
   * （`openChapterImages` 的產物，已下載的章優先吃離線層記下的清單）。
   * 離線 manifest 與下載的 `savePage` 都用同一組 (index, key)。越界就拋。
   */
  imageKey(index: number): string
  /**
   * 這一頁的圖片（就是 `imageKey(index)` 那一張）：離線（讀本機檔）→ 記憶體 LRU → 網路，
   * 回來的是**位元組**（正文不落地）。越界就抛。
   */
  pageImage(index: number): Promise<Uint8Array>
  /**
   * 載入並渲染頁面圖片（含解碼與可選的 AI 超解析度管線）。
   * 原圖先見：直接 resolve 原圖；若開啟超分且處理成功，透過 onSharpened 回調推送超分圖。
   */
  loadPage(
    index: number,
    onSharpened?: (render: PageRender) => void,
    isCancelled?: () => boolean
  ): Promise<PageRender | null>
  /** 動態更新當前會話是否啟用 AI 超解析度。 */
  setHardwareSharpen(enabled: boolean): void
  /**
   * 預取：以這一頁為中心往前 3 頁（當前頁最優先）。畫面只負責在時機點呼叫——
   * 只有 session 知道「第幾頁 ↔ 取圖請求」，畫面不自己算 URL。
   */
  warm(page: number): void
  /**
   * 換話／離開閱讀器：清掉預取佇列 + 中止在飛的請求（同一個 controller 也管 `pageImage`）
   * + 放掉**自己那一份**正文記憶體快取。
   *
   * 那一份快取只屬於這一話，所以不需要旗標：過期 session（連按兩話時舊的那一個才回來）
   * 被 dispose 時也碰不到當前那一話的位元組——那是另一份實例。
   */
  dispose(): void
}

/**
 * 一頁可以直接畫的東西。定義在 `engine/pagefiles.ts`（那裡說明為什麼不給 `UIImage`、
 * 以及這些檔案的生命週期）。這裡原樣轉出去，畫面照樣只從 `app/comic` 拿型別。
 */
export type { PageRender }

export interface ResumePoint {
  chapter: ChapterRef
  /** 領先可見頁，0 起算；已 clamp 到合法範圍。 */
  page: number
  /**
   * 這一筆上次是**在離線模式讀的**（`Progress.offline` 原樣帶出）。
   * 續讀要不要真的走離線還要看那一話還在不在下載裡——判定在 `screens/shared/offlineSession` 的
   * `canResumeOffline`（畫面端才有離線層的查詢權；這裡只負責把旗標帶出來）。
   */
  offline: boolean
}

/**
 * 一個可用來源的 domain 描述。畫面只認得這個（與它的 key），不碰 registry，
 * 也不碰源的原始 instance——能力、篩選列、登入狀態都在這裡收斂好了。
 */
export interface ComicSourceInfo {
  key: string
  name: string
  version: string
  /** 源有沒有宣告分類頁 / 排行榜（決定瀏覽頁的選單要不要給入口）。 */
  hasCategory: boolean
  hasRanking: boolean
  /** 這個源宣告的搜尋篩選列（沒宣告就是空陣列）。 */
  searchOptions: SearchOptionRow[]
  /** 留言要登入但還沒登入（留言頁據此給「前往登入」）。 */
  needsLogin: boolean
  /** 目前登入的帳號名稱（留言送出後的即時回音要用）。 */
  accountName?: string
}

/** 留言的目標：漫畫＋源自己的子識別碼（詳情帶回來的）。 */
export interface ComicCommentTarget extends ComicRef {
  subId?: string
}

/** 留言一頁。`hasMore` 是源的 `maxPage` 規則收斂後的結果，畫面不自己算。 */
export interface CommentPage {
  comments: SourceComment[]
  hasMore: boolean
}

/** 要下載的章節：呼叫端手上有標題就一起帶，省下 ComicLibrary 自己問一次詳情。 */
export interface ChapterDownloadRequest extends ChapterRef {
  title?: string
}

/** 整組下載共用的資訊（漫畫名與封面，下載頁要顯示）。 */
export interface DownloadMeta {
  comicTitle?: string
  cover?: string
}

export interface ComicLibrary {
  /** 已啟用且載入成功的來源，照安裝順序（搜尋側邊欄、瀏覽清單）。 */
  sources(): ComicSourceInfo[]
  /** 單一來源的描述；找不到回 undefined（沒載入成功時名稱還在、能力一律當沒有）。 */
  source(key: string): ComicSourceInfo | undefined
  /**
   * 跨源聚合搜尋。`opts.signal` 一給，取消就真的中止在飛的請求、排隊中的源不再派出，
   * 而且被取消的源不會產生結果也不會產生錯誤條目（AbortError 往上丟，畫面用 epoch 丟掉整輪）。
   */
  search(
    query: SearchQuery,
    onProgress?: (progress: SearchProgress) => void,
    opts?: { signal?: AbortSignal }
  ): Promise<SourceSearchResult[]>
  /** 只重跑一個源（使用者改完那一源的搜尋篩選之後）。 */
  searchSource(
    sourceKey: string,
    keyword: string,
    options: Array<string | null>,
    opts?: { signal?: AbortSignal }
  ): Promise<SourceSearchResult>
  /** 源的探索分頁（雜誌流的來源）。 */
  explore(sourceKey: string): ExploreEntry[]
  browse(sourceKey: string, target: ListTarget, cursor?: Cursor): Promise<SectionPage>
  rankingOptions(sourceKey: string): RankingOption[]
  /** 排行榜一頁（平舖清單，形狀與 browse 的 SectionPage 不同）。 */
  ranking(sourceKey: string, option: string, page: number): Promise<ComicListPage>
  /** 源宣告的分類 chips（`category.parts`）。 */
  categoryParts(sourceKey: string): Promise<CategoryPart[]>
  /** 分類頁的篩選列（`categoryComics.optionList`／`optionLoader`）。 */
  categoryOptionRows(sourceKey: string, target: JumpTarget): Promise<CategoryOptionRow[]>
  comic(ref: ComicRef): Promise<ComicPage>
  chapter(ref: ChapterRef): Promise<ChapterSession>
  /**
   * 續讀點：沒讀過回 null；越界的進度會 clamp 到合法頁索引。
   * 同步（書架本來就是記憶體內的同步查詢），畫面才能在 render 期間直接讀、
   * 不必把「每次重繪重讀」變成快照（見 app/useSubscription.ts 的語意）。
   */
  resume(ref: ComicRef): ResumePoint | null
  /** 留言一頁（不落地、不快取：每次進來重新讀）。 */
  comments(target: ComicCommentTarget, page: number): Promise<CommentPage>
  /** 送出留言（空白內容在源邊界就被擋下來）。 */
  postComment(target: ComicCommentTarget, content: string): Promise<void>
  /**
   * 封面／頭像／留言圖的本地檔路徑：源的縮圖管線（Referer、onResponse、modifyImage、
   * onLoadFailed 一次性重試）＋圖片磁碟快取。畫面拿到的是可以直接餵給 `UIImage.fromFile` 的路徑。
   */
  thumbnailPath(sourceKey: string, url: string): Promise<string>
  /**
   * 送出下載。已下載的章節由下載管理員跳過；排程與 partial／failed／done 語意都在那裡，
   * 這裡只負責把「哪些章、叫什麼名字」翻成下載管理員收得下的說法。
   */
  download(chapters: ChapterDownloadRequest[], meta?: DownloadMeta): Promise<void>
  /** 一章現在的下載狀態（畫面每次重繪重讀，才會跟著下載進度動）。 */
  downloadState(ref: ChapterRef): ChapterDownloadState
  cancelDownload(ref: ChapterRef): void
  deleteDownload(ref: ChapterRef): void
  listDownloads(): DownloadRecord[]
  /** 離線下載佔用的位元組數。 */
  downloadsSize(): number
  /** 源的安裝/變更、下載、書架進度合併成一個訂閱。 */
  onChange(listener: () => void): () => void
}

function requireSource(key: string): InstalledSource {
  const source = findSource(key)
  if (!source) throw new Error(t("sources.notFound", { key }))
  if (!source.instance) throw new Error(source.error ?? t("sources.notLoaded", { name: source.stored.name }))
  return source
}

function handleOf(key: string): { source: InstalledSource; handle: SourceHandle } {
  const source = requireSource(key)
  return { source, handle: openSource(source) }
}

/**
 * 源的 domain 描述；沒載入成功時只剩名字與版本（能力一律當沒有）。
 *
 * 算一份要 `openSource()` + 重新解析 `search.optionList` + 能力旗標，而 `sources()`／
 * `source(key)` 是**在 render 期間**被呼叫的（搜尋頁、瀏覽頁、書架的每張歷史卡、Bangumi 詳情）：
 * 30 個源的宣告每重繪就要重算一次。所以算過的留著，以 `InstalledSource` 物件為鍵
 * （註冊中心重載會換新物件）；revision 一對不上就整份丟掉，涵蓋「沒換物件但狀態變了」的重登。
 */
let infoCacheRevision = -1
let infoCache = new WeakMap<InstalledSource, ComicSourceInfo>()

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
    name: source.meta?.name ?? source.stored.name,
    version: source.meta?.version ?? source.stored.version,
    hasCategory: hasCategoryPage(source),
    hasRanking: openSource(source).hasRanking(),
    searchOptions: searchOptionRows(source),
    needsLogin: account != null && source.stored.loggedIn !== true,
    accountName: source.stored.accountName,
  }
  infoCache.set(source, info)
  return info
}

/** production instance：把既有模組的入口收成一個 domain interface。 */
export function createComicLibrary(): ComicLibrary {
  /**
   * 源的安裝/變更、下載、書架進度合併成一個訂閱。identity 固定（畫面只訂閱一次，
   * 換 identity 不該重新訂閱，見 app/useSubscription.ts）。
   */
  function onChange(listener: () => void): () => void {
    const stops = [subscribeSources(listener), subscribeDownloads(listener), subscribeLibrary(listener)]
    return () => stops.forEach(stop => stop())
  }

  return {
    sources: () => allSources().filter(source => source.enabled && source.instance).map(infoOf),

    source: key => {
      const found = findSource(key)
      return found ? infoOf(found) : undefined
    },

    search: (query, onProgress, opts) =>
      searchAll(
        allSources().filter(source => source.enabled && source.instance),
        query.keyword,
        source => query.optionsOf?.(source.stored.key) ?? [],
        onProgress ?? (() => {}),
        opts?.signal
      ),

    searchSource: (sourceKey, keyword, options, opts) =>
      searchOne(requireSource(sourceKey), keyword, options, { signal: opts?.signal }),

    explore: sourceKey => handleOf(sourceKey).handle.explore(),

    browse: (sourceKey, target, cursor) => handleOf(sourceKey).handle.list(target, cursor ?? { page: 1 }),

    rankingOptions: sourceKey => handleOf(sourceKey).handle.rankingOptions(),

    ranking: (sourceKey, option, page) => handleOf(sourceKey).handle.ranking(option, page),

    categoryParts: sourceKey => loadCategoryParts(requireSource(sourceKey)),

    categoryOptionRows: (sourceKey, target) => loadCategoryOptionRows(requireSource(sourceKey), target),

    onChange,

    comic: async ref => {
      const { source, handle } = handleOf(ref.sourceKey)
      const detail = await handle.detail(ref.comicId)
      return {
        ref,
        title: detail.title,
        cover: detail.cover,
        description: detail.description,
        stars: detail.stars,
        subId: detail.subId,
        tags: detail.tags,
        updateTime: detail.updateTime,
        uploadTime: detail.uploadTime,
        uploader: detail.uploader,
        likesCount: detail.likesCount,
        url: detail.url,
        recommend: detail.recommend,
        // 來源名稱與留言能力都由這裡給，呼叫端不必再碰 registry / raw source instance。
        sourceName: source.meta?.name ?? source.stored.name,
        comments: handle.capabilities?.comments === true,
        canPostComment: handle.canPostComment(),
        chapters: detail.chapters.map(chapter => {
          const chapterRef: ChapterRef = { ...ref, epId: chapter.id }
          return {
            ref: chapterRef,
            title: chapter.title,
            group: chapter.group,
            download: chapterDownloadState(chapterRef),
          }
        }),
      }
    },

    chapter: async ref => {
      const { source, handle } = handleOf(ref.sourceKey)
      const key = { sourceKey: ref.sourceKey, comicId: ref.comicId, epId: ref.epId }
      // 詳情只用來補標題。已下載的章在離線層就有頁面清單，斷網時詳情拿不到也要開得起來，
      // 所以那條路上把詳情的失敗收掉（標題退回 epId）；沒有離線檔時詳情照舊是必要條件。
      const offlineBefore = statusOf(key)
      const detailPromise = handle.detail(ref.comicId)
      const [detail, imageKeys] = await Promise.all([
        offlineBefore.state === "none" ? detailPromise : detailPromise.catch(() => undefined),
        handle.chapter(ref.comicId, ref.epId),
      ])
      const chapter = detail?.chapters.find(entry => entry.id === ref.epId)
      // 一個 session 一個取消範圍＋一條預取佇列＋**一份**正文記憶體快取（都是這一話的財產）；
      // 換話／離開時整組放掉（dispose）。下載管線那一份是另一個實例，互不影響。
      const controller = new AbortController()
      const pageCache = createPageCache()
      /** 這一頁的圖片鍵；越界就拋（`imageKey` 與 `pageImage` 共用同一個守衛）。 */
      const imageKeyOf = (index: number): string => {
        const imageKey = imageKeys[index]
        if (imageKey === undefined) throw new Error(t("common.pageMissing", { n: index + 1, total: imageKeys.length }))
        return imageKey
      }
      // 解析源的圖片請求本身也可能卡住（有的源在 onImageLoad 裡連網），所以重試的閉包也要帶 scope。
      const retry = handle.imageRetry({ signal: controller.signal })
      const loadPageBytes = async (index: number) =>
        readerImageBytes(
          {
            ...key,
            pageIndex: index,
            imageKey: imageKeyOf(index),
            comicModule: source.instance?.comic,
            retry,
          },
          pageCache,
          controller.signal
        )
      const prefetch = createPrefetchQueue({
        total: imageKeys.length,
        signal: controller.signal,
        load: loadPageBytes,
        // 預取失敗是靜默的：只留一筆 debug（使用者沒看到那一頁，不該被打擾）。
        onError: (page, error) => log("debug", "reader", `${ref.epId} 預取第 ${page + 1} 頁失敗`, error),
      })

      let hardwareSharpenEnabled = getReaderSettings().hardwareSharpen

      // 這一話的暫存檔目錄（每頁的原圖與超分圖），生命週期＝這個 session。
      // 開場順手清掉上一輪被系統殺掉時留下的孤兒。
      const renderDir = openRenderDir(ref.epId)
      let disposed = false

      const loadPage = async (
        index: number,
        onSharpened?: (render: PageRender) => void,
        isCancelled?: () => boolean
      ): Promise<PageRender | null> => {
        const bytes = await loadPageBytes(index)
        if (isCancelled && isCancelled()) return null

        // 解碼只是為了量長寬（惰性，幾乎免費），而且只做這一次：寫檔與超分都沿用這個比例。
        const data = Data.fromUint8Array(bytes)
        if (!data) return null
        const decoded = UIImage.fromData(data)
        if (!decoded) return null
        const aspect = decoded.width / decoded.height

        const name = `p${index}`
        // 超分圖已經算過就先給它（回捲／重新掛載不必重跑，也不會先閃原圖再換）。
        if (hardwareSharpenEnabled) {
          const cached = findSharpenedPage(renderDir, name, aspect)
          if (cached) return cached
        }

        if (disposed) return null
        const render = writePage(renderDir, name, bytes, aspect)
        if (!render) return null

        // 漸進式超分：若開關開啟且尺寸在 ACNet 安全範圍內，在背景排入超分推論並透過 callback 回傳
        if (hardwareSharpenEnabled && isSafeForUpscale(decoded.width, decoded.height)) {
          if (onSharpened) {
            const pageKey = `${ref.epId}_p${index}`
            const t0 = Date.now()
            void sharpenImage(pageKey, data, isCancelled).then(result => {
              // `disposed` 一起擋：晚到的結果再寫檔會把 dispose 剛刪掉的目錄又建回來。
              if (!result || disposed || (isCancelled && isCancelled())) return
              const costMs = Date.now() - t0
              if (result.fromCache) {
                log("debug", "upscale", `第 ${index + 1} 頁 ACNet ONNX [快取命中]，0ms 直接顯示`)
              } else {
                log("info", "upscale", `第 ${index + 1} 頁 ACNet ONNX 超分完成，耗時 ${costMs}ms`)
              }
              const sharpened = writeSharpenedPage(
                renderDir,
                name,
                new Uint8Array(result.data.toArrayBuffer()),
                aspect
              )
              if (sharpened) onSharpened(sharpened)
            })
          }
        }

        return render
      }

      return {
        ref,
        title: chapter?.title ?? ref.epId,
        comicTitle: detail?.title ?? "",
        cover: detail?.cover,
        pageCount: imageKeys.length,
        offline: statusOf(key),
        imageKey: index => imageKeyOf(index),
        pageImage: loadPageBytes,
        loadPage,
        setHardwareSharpen: enabled => {
          hardwareSharpenEnabled = enabled
        },
        warm: page => prefetch.focus(page),
        dispose: () => {
          disposed = true
          prefetch.clear()
          controller.abort()
          pageCache.clear()
          // 這一話畫過的所有暫存檔（原圖＋超分圖）一次收掉。
          closeRenderDir(renderDir)
        },
      }
    },

    resume: ref => {
      const progress = getProgress(ref.sourceKey, ref.comicId)
      if (!progress?.epId) return null
      const page = progress.page ?? 0
      const count = progress.pageCount
      // 兩種越界都收掉：負數歸 0；知道頁數時再往內收到最後一頁（舊資料沒有 pageCount，只能收下界）。
      return {
        chapter: { ...ref, epId: progress.epId },
        page: Math.max(0, count && count > 0 ? Math.min(page, count - 1) : page),
        offline: progress.offline === true,
      }
    },

    comments: async (target, page) => {
      const { handle } = handleOf(target.sourceKey)
      const result = await handle.comments(target.comicId, target.subId, page)
      // 「還有下一頁嗎」是源的 maxPage 規則，收在 facade 裡（畫面只讀布林値）。
      return { comments: result.comments, hasMore: hasMoreComments(result.maxPage, page) }
    },

    postComment: async (target, content) => {
      await handleOf(target.sourceKey).handle.postComment(target.comicId, target.subId, content)
    },

    thumbnailPath: (sourceKey, url) => {
      const { source } = handleOf(sourceKey)
      // 縮圖也走完整的快取規格（絕對化 URL、onResponse、modifyImage、onLoadFailed 重試）：
      // 封面、頭像、留言內文圖都是同一條路，不再各自拼一次。
      const request = resolveThumbnailRequest(source.instance?.comic, url)
      return cachedImagePath(toCacheSpec(request), sourceKey)
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
        // 標題與漫畫資訊客戶端手上有就不必再問一次詳情；缺了才補（省一趟網路）。
        const incomplete = meta?.comicTitle === undefined || group.requests.some(request => request.title === undefined)
        const detail = incomplete ? await openSource(source).detail(group.comicId) : undefined
        await downloadChapters(
          source,
          group.comicId,
          // 已下載的章由 downloadChapters 自己跳過。
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

    deleteDownload: ref => deleteChapterDownload(ref),

    listDownloads: () => listDownloads(),

    downloadsSize: () => totalBytes(),
  }
}
