// ComicLibrary：UI 與 source／offline／download／書架之間的領域中介層（domain seam）。
// 集中提供 UI 所需的 domain model（ComicPage、ChapterSession、下載狀態等），不洩露底層實例細節。

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
  findPage,
  findSharpenedPage,
  pageName,
  writePage,
  writeSharpenedPage,
  type PageFrame,
  type PageRender,
} from "../engine/pagefiles"
import { openChapterCache, sweepPageCache } from "../engine/pagecache"
import { readBytes } from "../engine/fs"
import { createPageCache } from "../engine/pageimages"
import { readImageSize } from "../engine/imagesize"
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
import { canResumeOffline, createOfflineSession, isOfflineReadable } from "./offlineReading"

/** 「還在跑」是下載語意的一部分（畫面判斷要不要給取消／左滑下載都用它）。 */
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
  /** 閱讀器／章節清單快取共用的章節形狀（`readerChapters()` 給的就是這個）。 */
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
  /** 每個源要帶的篩選值（沒提供就不帶）。 */
  optionsOf?: (sourceKey: string) => Array<string | null>
}

export interface ComicPage {
  ref: ComicRef
  title: string
  cover?: string
  description?: string
  /** 源的連載狀態；沒給就沒有。 */
  status?: ComicStatus
  /** 內容分級；只有 `suggestive`／`nsfw` 會顯示。 */
  contentRating?: ContentRating
  /** 源宣告的閱讀方式；沒宣告就沒有（退全域）。 */
  viewer?: SourceViewer
  /** 源給的星等（0–5，可為小數）；源沒給就沒有。只讀顯示，不寫入。 */
  stars?: number
  /** 源自己的子識別碼（留言 API 要用）。 */
  subId?: string
  tags: Array<{ namespace: string; values: string[] }>
  updateTime?: string
  uploadTime?: string
  uploader?: string
  /** 作畫（與 `uploader` 的作者分開）。 */
  artists?: string
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
  chapters: Array<{ ref: ChapterRef; title: string; group: string; locked: boolean; lang?: string; download: ChapterDownloadState }>
}

export interface ChapterSession {
  readonly ref: ChapterRef
  /** 這一話的標題。線上 session 不為此抓詳情（標題在呼叫端的清單裡），就是 `epId`。 */
  readonly title: string
  readonly comicTitle: string
  readonly cover?: string
  readonly pageCount: number
  readonly offline: OfflineStatus
  /** 這一話是不是從本機檔案讀的（離線 session）；進度的 `offline` 旗標就照這個寫。 */
  readonly local: boolean
  /**
   * 圖片鍵清單中索引對應的鍵值（0 起算）。離線 manifest 與下載共用此鍵。
   */
  imageKey(index: number): string
  /**
   * 這一頁的寬高比（寬 / 高）；還沒解碼過就是 null。
   * 同步查詢——畫面在 render 期間就要拿它定尺寸，不能等 `loadPage`。
   */
  aspectOf(index: number): number | null
  /** 量到新的比例就通知（預取讀檔頭或解碼）。 */
  subscribeAspects(listener: (index: number, aspect: number) => void): () => void
  /**
   * 已經備好的頁面渲染（路徑 + 比例）；還沒載過就是 null。
   * 重掛的頁拿它當初始值，第一帧就是圖，不必先出佔位再換。
   */
  renderOf(index: number, half?: SlotHalf): PageRender | null
  /**
   * 取得指定索引的圖片原始位元組（離線 ➔ 記憶體 LRU ➔ 網路）。
   */
  pageImage(index: number): Promise<Uint8Array>
  /**
   * 載入並渲染頁面圖片（含解碼與可選的 AI 超解析度管線）。
   * 原圖先見：直接 resolve 原圖；若開啟超分且處理成功，透過 onSharpened 回調推送超分圖。
   * `frame`＝這一頁的顯示框（點，與 `ChapterImage` 的 `size` 同一份）；沒給就不超分。
   * `half`＝寬圖切割的半邊：原圖照樣回整張，超分只算這一半、回來的渲染帶 `half`。
   */
  loadPage(
    index: number,
    onSharpened?: (render: PageRender) => void,
    isCancelled?: () => boolean,
    frame?: PageFrame,
    half?: SlotHalf
  ): Promise<PageRender | null>
  /** 動態更新當前會話是否啟用 AI 超解析度。 */
  setHardwareSharpen(enabled: boolean): void
  /**
   * 預取：以這一頁為中心往前 3 頁（當前頁最優先）。畫面只負責在時機點呼叫——
   * 只有 session 知道「第幾頁 ↔ 取圖請求」，畫面不自己算 URL。
   */
  warm(page: number): void
  /**
   * 把前 `pages` 頁先抓到磁碟（不解碼、不渲染）；跨章預取用。
   * 換到那一話時磁碟已經有檔，第一頁不必等一輪往返。
   */
  warmAhead(pages: number): Promise<void>
  /**
   * 放掉記憶體裡的正文快取，session 仍然可用：畫面上的圖不動，回捲時從磁碟重讀一次。
   * 連續模式接了很多話時用來壓記憶體（`dispose` 會讓 session 失效，不能用在這）。
   */
  dropCache(): void
  /**
   * 換話或離開閱讀器：取消請求、清空預取佇列並釋放快取與暫存檔案。
   */
  dispose(): void
}

/** 一頁可直接交給 Canvas 渲染的路徑與寬高比。 */
export type { PageRender }

export interface ResumePoint {
  chapter: ChapterRef
  /** 領先可見頁，0 起算；已 clamp 到合法範圍。 */
  page: number
  /** 上次那一話是不是從本機檔讀的（決定續讀要不要先開再補）。 */
  offline: boolean
}

/** 續讀要開的東西：畫面拿到就只是「開」，不必再挑話或決定清單怎麼來。 */
export interface ResumePlan {
  /** 要開的那一話。 */
  epId: string
  /** 從第幾頁（0 起算）；換話就沒有（從頭）。 */
  page?: number
  /** 開場的章節清單（本機合併清單或線上清單）。 */
  chapters: ReaderChapter[]
  /** 先開再補：清單是手上的本機版本，背景再向源更新。 */
  refreshChapters: boolean
  comicTitle: string
  comicCover?: string
  /** 源宣告的閱讀方式（離線那條路沒有，就退全域設定）。 */
  viewer?: SourceViewer
}

/** 續讀開不了的原因（字串由畫面挑；`unavailable` 帶下層原文）。 */
export type ResumeFailure =
  | { reason: "noChapters" }
  | { reason: "allLocked" }
  | { reason: "unavailable"; message: string }

/** 來源的一章 → 閱讀器／清單快取的形狀（標題缺了沿用詳情頁章節列的替代字）。 */
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

/** 詳情頁的章節清單 → 閱讀器的章節清單（全 App 一份轉換，詳情頁與續讀共用）。 */
function readerChaptersOf(chapters: ComicPage["chapters"]): ReaderChapter[] {
  return chapters.map(chapter => readerChapterOf(chapter.ref.epId, chapter))
}

/** 源的章節清單 → 顯示／快取的形狀。 */
function chapterListOf(chapters: ComicDetail["chapters"]): ReaderChapter[] {
  return chapters.map(chapter => readerChapterOf(chapter.id, chapter))
}

/** 續讀點（未讀或沒有紀錄就 null；越界自動 clamp）。 */
function resumePointOf(ref: ComicRef): ResumePoint | null {
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
}

/**
 * 一個可用來源的 domain 描述。畫面只認得這個（與它的 key），不碰 registry，
 * 也不碰源的原始 instance——能力、篩選列、登入狀態都在這裡收斂好了。
 */
export interface ComicSourceInfo {
  key: string
  /** Venera 的 JS 源或 Aidoku 的 WASM 源。 */
  kind: "venera" | "aidoku"
  name: string
  version: string
  /** 源自己給的圖示（本機路徑或網址；沒有就讓畫面用首字徽章）。 */
  iconUrl?: string
  /** 源有沒有宣告分類頁 / 排行榜（決定瀏覽頁的選單要不要給入口）。 */
  hasCategory: boolean
  hasRanking: boolean
  /** 源有沒有首頁（Aidoku 的 `get_home`）；Venera 一律沒有。載入過才可能為 true。 */
  hasHome: boolean
  /** 這個源宣告的搜尋篩選列（沒宣告就是空陣列）。 */
  searchOptions: SearchOptionRow[]
  /** Aidoku 源宣告的設定（`settings.json`）；不是 Aidoku 或沒有這個檔就是 undefined。 */
  settingsSpec?: AidokuSettingsSpec
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

/** 一部有離線內容的漫畫（離線書架的一列）。 */
export interface OfflineComic extends ComicRef {
  /** manifest 記下來的書名；舊下載可能沒有（畫面挑替代字）。 */
  title?: string
  cover?: string
  /** 源的顯示名稱；源被移除就沒有。 */
  sourceName?: string
  /** 手機上有幾章（含沒抓完的）。 */
  chapters: number
  /** 其中下載完的章數。 */
  completed: number
  /** 還在下載（排隊中或進行中）的章數。 */
  active: number
  bytes: number
  /** 這部最近一次下載的時間（最近有人下載的排前面）。 */
  updatedAt: number
}

/** 離線章節列的一章：只有真的在手機上的章才會列出來。 */
export interface OfflineChapterRow {
  ref: ChapterRef
  title: string
  /** 下載狀態（完成／未完成／下載中／失敗），與詳情頁的章節列同一份語意。 */
  state: ChapterDownloadState
  /** 已落地的張數與大小（manifest 為準）。 */
  pages: number
  bytes: number
}

/**
 * 離線內容的統一入口：分組好的清單、章節狀態、集中／單章刪除與總量。
 * 畫面的左滑與長按只要說「刪這部／刪這章」，取消任務、等它收尾、再刪檔都在這裡。
 */
export interface OfflineLibrary {
  /** 已分組的離線漫畫，最近有人下載的排前面。 */
  comics(): OfflineComic[]
  /** 單一部的統計；這部沒有離線內容就沒有。 */
  comic(ref: ComicRef): OfflineComic | undefined
  /** 一部的離線章節列，順序同 `offline-chapter-list` 的合併清單。 */
  chapters(ref: ComicRef): OfflineChapterRow[]
  /** 閱讀器要的章節清單：本機快取（源原本的順序）＋不在快取裡但已下載的章。 */
  readerChapters(ref: ComicRef): ReaderChapter[]
  /** 刪掉整部（下載中的先取消、等任務收尾再刪檔）。 */
  deleteComic(ref: ComicRef): Promise<void>
  /** 刪掉一章（下載中的先取消、等任務收尾再刪檔）。 */
  deleteChapter(ref: ChapterRef): Promise<void>
  /** 只停下載、留著已抓到的頁（長按選單的「取消」）。 */
  cancelComic(ref: ComicRef): void
  /** 有離線內容的漫畫數（書架入口列）。 */
  comicCount(): number
  /** 離線內容總共佔多少位元組（書架入口列、設定頁）。 */
  totalBytes(): number
  /** 排隊中＋下載中的章數（書架入口列）。 */
  activeChapterCount(): number
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
    opts?: { signal?: AbortSignal; filters?: unknown[] }
  ): Promise<SourceSearchResult>
  /**
   * 源的探索分頁（雜誌流的來源）。
   * Aidoku 的 listings 要先載入源才拿得到，所以這裡是非同步；畫面不必知道自己拿的是哪一種。
   */
  explore(sourceKey: string): Promise<ExploreEntry[]>
  /** 源有沒有首頁（Aidoku 的 `get_home`）；先 `explore()` 載入過才準。 */
  hasHome(sourceKey: string): boolean
  /** 源的首頁；`reload` 是下拉刷新（丟掉快取重讀）。沒有首頁的源會拋。 */
  home(sourceKey: string, opts?: { reload?: boolean }): Promise<SourceHome>
  browse(sourceKey: string, target: ListTarget, cursor?: Cursor): Promise<SectionPage>
  rankingOptions(sourceKey: string): RankingOption[]
  /** 排行榜一頁（平舖清單，形狀與 browse 的 SectionPage 不同）。 */
  ranking(sourceKey: string, option: string, page: number): Promise<ComicListPage>
  /** 源宣告的分類 chips（`category.parts`）。 */
  categoryParts(sourceKey: string): Promise<CategoryPart[]>
  /** 分類頁的篩選列（`categoryComics.optionList`／`optionLoader`）。 */
  categoryOptionRows(sourceKey: string, target: JumpTarget): Promise<CategoryOptionRow[]>
  comic(ref: ComicRef): Promise<ComicPage>
  /**
   * 開一話的 session。**逐話選來源**：這一話下載完就讀本機檔（先查本機、不碰源，
   * 源被移除或飛航模式也開得起來），否則走線上。
   */
  chapter(ref: ChapterRef): Promise<ChapterSession>
  /**
   * 跨章預取：先開好那一話的 session，把前 `pages` 頁抓進磁碟快取，留著給下一次 `chapter()` 接手。
   * 同時只留一份；預取是加分項，失敗不抛。**resolve 時這幾頁已經在磁碟上**（呼叫端可以 `void` 掉）。
   */
  prefetchChapter(ref: ChapterRef, pages: number): Promise<void>
  /** 放掉沒被接手的預取 session（離開閱讀器時）。 */
  releasePrefetched(): void
  /**
   * 取得續讀進度點（未讀回傳 null，越界自動 clamp）。
   */
  resume(ref: ComicRef): ResumePoint | null
  /** 續讀計畫：挑哪一話、從第幾頁、開場的清單（本機或線上）與要不要背景再補；開不了就回原因。 */
  resumePlan(ref: ComicRef): Promise<ResumePlan | ResumeFailure>
  /** 詳情頁的章節清單 → 閱讀器的章節形狀（全 App 一份轉換）。 */
  readerChapters(page: ComicPage): ReaderChapter[]
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
   * 同上，但回降採樣後的小圖（長邊 1024）：網格、列、詳情頁封面用這條；
   * 要看原圖（例如封面檢視）才用 `thumbnailPath`。
   */
  thumbnailDisplayPath(sourceKey: string, url: string): Promise<string>
  /**
   * 送出下載。已下載的章節由下載管理員跳過；排程與 partial／failed／done 語意都在那裡，
   * 這裡只負責把「哪些章、叫什麼名字」翻成下載管理員收得下的說法。
   */
  download(chapters: ChapterDownloadRequest[], meta?: DownloadMeta): Promise<void>
  /** 一章現在的下載狀態（畫面每次重繪重讀，才會跟著下載進度動）。 */
  downloadState(ref: ChapterRef): ChapterDownloadState
  cancelDownload(ref: ChapterRef): void
  listDownloads(): DownloadRecord[]
  /** 離線內容：清單、章節、刪除與總量（離線書架、下載頁、設定頁都走這裡）。 */
  offline: OfflineLibrary
  /** 源的安裝/變更、下載、書架進度合併成一個訂閱。 */
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

/**
 * 漫畫源描述快取：依 revision 與 InstalledSource 快取 domain 描述，避免 render 重繪頻繁重新解析。
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
    kind: source.stored.kind === "aidoku" ? "aidoku" : "venera",
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

/** 來源的顯示名稱；源被移除就沒有（離線內容照樣看得到，只是不知道本來叫什麼）。 */
function sourceNameOf(sourceKey: string): string | undefined {
  const source = findSource(sourceKey)
  return source ? source.meta?.name ?? source.stored.name : undefined
}

/** 把離線章節按漫畫分組，最近有人下載的排前面。 */
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
    // 書名與封面缺了就往後面的章找（早期的 manifest 不一定有）。
    group.title ??= chapter.comicTitle
    group.cover ??= chapter.cover
  }

  return [...groups.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 離線章節列的一章（只有真的在手機上的章才會列出來）。 */
function offlineChapterRows(ref: ComicRef): OfflineChapterRow[] {
  /** 一章的列：標題照 manifest（跟線上清單的取代字無關）。 */
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
  // 順序同 `offline-chapter-list` 的合併清單（源原本的順序，缺的附在最後）。
  for (const item of mergeChapterList(cachedChapterList(ref.sourceKey, ref.comicId), ref.sourceKey, ref.comicId)) {
    const chapter = chapterOf({ ...ref, epId: item.id })
    if (!chapter) continue
    rows.push(rowOf(chapter))
    listed.add(item.id)
  }
  // 沒抓完的章不會進合併清單（那份只挑下載完的）：照下載時間附在最後，不然下載中／失敗的章會整個不見。
  const rest = listChapters()
    .filter(chapter => chapter.key.sourceKey === ref.sourceKey && chapter.key.comicId === ref.comicId)
    .filter(chapter => !listed.has(chapter.key.epId))
    .sort((a, b) => a.updatedAt - b.updatedAt)
  for (const chapter of rest) rows.push(rowOf(chapter))
  return rows
}

/**
 * 續讀計畫：上次那一話可讀就續、被鎖或不在清單就退第一個沒鎖的章；本機讀得到就秒開不連網。
 * 清單從哪裡來由呼叫端給（production 就是 `comic()`；探針餵 stub 才驗得到「有沒有連網」）。
 * 畫面拿到這個就直接開閱讀器，不必自己挑話、也不必自己決定要不要補清單。
 */
export async function resumePlan(
  ref: ComicRef,
  loadComic: (ref: ComicRef) => Promise<ComicPage>
): Promise<ResumePlan | ResumeFailure> {
  const progress = getProgress(ref.sourceKey, ref.comicId)
  const resumed = resumePointOf(ref)
  const wantedEpId = resumed?.chapter.epId

  // 先開再補：上次是從本機檔讀的、那一話也還在下載裡 → 不等網路，用本機清單直接開。
  // 這是「下載了卻被續讀拉回線上（飛航模式下甚至拉不起來）」的那個修正。
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

  // 線上續讀也先開：點下去不等整份詳情。有快取清單就用，沒有就先放正在讀的這一話，背景再補。
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
      // 上次那一話被鎖了：跟走完詳情那條一樣退第一個沒鎖的章；全鎖就別開。
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
    // 沒有本機清單（沒下載過的漫畫）就先只放這一話；`ResumeReader` 之後把詳情的完整清單補進來。
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
    // 源不在、沒網路、詳情失敗：原文是下層給的錯誤訊息，照舊給畫面 toast。
    return { reason: "unavailable", message: error instanceof Error ? error.message : String(error) }
  }

  const chapters = readerChaptersOf(page.chapters)
  if (chapters.length === 0) return { reason: "noChapters" }
  const target = chapters.some(chapter => chapter.id === wantedEpId && !chapter.locked)
    ? wantedEpId
    : chapters.find(chapter => !chapter.locked)?.id
  if (target === undefined) return { reason: "allLocked" }

  // 詳情拿到的 viewer 記下來：下次續讀的快速路徑不抓詳情也沿用同一個方向。
  setSourceViewer(ref, page.viewer)

  return {
    epId: target,
    // 續讀同一話才帶頁碼；換話一律從頭。
    page: target === wantedEpId ? resumed?.page : undefined,
    chapters,
    refreshChapters: false,
    comicTitle: progress?.title ?? page.title,
    comicCover: progress?.cover ?? page.cover,
    viewer: page.viewer,
  }
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

  /**
   * 詳情（`comic()` 與 `resumePlan()` 共用）；來源名稱與留言能力都由這裡給，呼叫端不必再碰 registry。
   */
  const loadComic = async (ref: ComicRef): Promise<ComicPage> => {
    const { source, handle } = handleOf(ref.sourceKey)
    const detail = await handle.detail(ref.comicId)
    // 線上拿到清單就覆寫快取（只在這部有離線內容時留檔，見 engine/offline 的 cacheChapterList）。
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

  async function openChapter(ref: ChapterRef): Promise<ChapterSession> {
    const key = { sourceKey: ref.sourceKey, comicId: ref.comicId, epId: ref.epId }
    // 先查本機：這一話在手機上就讀離線 manifest，整條路不碰源（源被移除也開得起來）。
    if (isOfflineReadable(key)) return createOfflineSession(key)

    const { handle } = handleOf(ref.sourceKey)
    // 只拿這一話的頁面清單。詳情不在這裡抓：每個入口進來之前都已經抓過一輪
    // （詳情頁的 `comic()`、續讀的 `resumePlan()`），擋在這裡等它只會把首圖往後推一個往返；
    // 畫面顯示的章節標題也來自呼叫端的 `chapters`，不是這一份。
    const imageKeys = await handle.chapter(ref.comicId, ref.epId)
    // 這一話的跨 session 快取目錄：同一話重開就是這個目錄，命中就不必問源、不必下載。
    // 開章順手淘汰一次（背景），保留話數與容量都在設定裡。
    const chapterCache = openChapterCache(key, imageKeys)
    const renderDir = chapterCache.dir
    void sweepPageCache(renderDir, {
      chapters: getPageCacheChapters(),
      bytes: getPageCacheBytes(),
    })
    // 一個 session 包含獨立取消範圍、預取佇列與正文記憶體快取，生命週期隨 session dispose 釋放。
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
    const loadPageBytes = async (index: number) => {
      // 磁碟命中就不必問源、不必下載。放在這一層而不是 `loadPage`：預取也吃這條路，
      // 不然重開同一話時 ahead 的預取還是會全部重抓一次。
      const hit = findPage(renderDir, pageName(index, imageKeyOf(index)))
      const cached = hit ? readBytes(hit) : null
      if (cached) {
        log("debug", "image", `正文命中磁碟（第 ${index + 1} 頁）`)
        return cached
      }
      return readerImageBytes(
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
    }
    // 解碼過的頁比例：頁面重掛時可以直接沿用，不必先出佔位再跳成真尺寸。
    const aspects = createPageAspects()
    const prefetch = createPrefetchQueue({
      total: imageKeys.length,
      signal: controller.signal,
      // 預取到的頁先讀檔頭記比例：畫廊切寬圖要在翻到之前就知道。
      load: async page => {
        const size = readImageSize(await loadPageBytes(page))
        if (size && aspects.get(page) === null) aspects.set(page, size.width / size.height)
      },
      ahead: getPrefetchPages,
      // 預取失敗是靜默的：只留一筆 debug（使用者沒看到那一頁，不該被打擾）。
      onError: (page, error) => log("debug", "reader", `${ref.epId} 預取第 ${page + 1} 頁失敗`, error),
    })

    // 沒有 Scripting Pro 就沒有本機 HttpServer，超分根本跑不起來：不要每頁白試兩次再降級。
    let hardwareSharpenEnabled = getReaderSettings().hardwareSharpen && hasPro()

    // 已經備好的頁：重掛時直接拿來當初始值（省掉一次 loadPage 與佔位→圖的交換）。
    // key＝頁索引＋半張尾碼（整張沒有尾碼）。
    const renders = new Map<string, PageRender>()
    /** 記住這頁的渲染結果再回傳（所有成功路徑都要經過）。 */
    const memoRender = (index: number, render: PageRender | null): PageRender | null => {
      if (render) renders.set(`${index}${halfSuffix(render.half)}`, render)
      return render
    }
    /** 半張先找切好的超分圖，沒有就用整張。 */
    const renderOf = (index: number, half?: SlotHalf): PageRender | null =>
      (half ? renders.get(`${index}${halfSuffix(half)}`) : undefined) ?? renders.get(String(index)) ?? null
    let disposed = false

    /** 檔案寬高比；只讀檔頭（`fromFile` 是惰性的），讀不出來回 null。 */
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
      // 沒有超分要跑（預設）時，磁碟命中就是最終結果：session 記過的直接回；
      // 沒記過（跨 session 重開）就用檔案量比例——`fromFile` 只讀檔頭，
      // 不必把整張讀回來再 `fromData` 解一次。
      if (!hardwareSharpenEnabled) {
        const ready = renders.get(String(index))
        if (ready) return ready
        const hit = findPage(renderDir, pageName(index, imageKeyOf(index)))
        const aspect = hit ? aspectOfFile(hit) : null
        if (hit && aspect !== null) {
          aspects.set(index, aspect)
          return memoRender(index, { path: hit, aspect })
        }
      }

      const bytes = await loadPageBytes(index)
      if (isCancelled && isCancelled()) return null

      // 解碼只是為了量長寬（惰性，幾乎免費），而且只做這一次：寫檔與超分都沿用這個比例。
      const data = Data.fromUint8Array(bytes)
      if (!data) return null
      const decoded = UIImage.fromData(data)
      if (!decoded) return null
      const aspect = decoded.width / decoded.height
      aspects.set(index, aspect)

      const name = pageName(index, imageKeyOf(index))
      // 有放大效益、縮後放得下才超分；輸出按這一格的顯示框算（半張只算那一半）。
      const target = hardwareSharpenEnabled && frame
        ? planUpscale(halfRect(decoded.width, decoded.height, half), displayPixels(frame, slotAspect(aspect, half)))
        : null
      // 檔名帶半邊與輸出尺寸：框變了不拿舊的小圖。
      const sharpenedName = target ? `${name}${halfSuffix(half)}-${target.outWidth}x${target.outHeight}` : ""
      const sizes = `${decoded.width}×${decoded.height}${halfSuffix(half)}→${target ? `${target.outWidth}×${target.outHeight}` : ""}`
      if (hardwareSharpenEnabled && frame && !target) {
        log("debug", "upscale", `第 ${index + 1} 頁不超分（${decoded.width}×${decoded.height}，沒有放大效益或縮後超過上限）`)
      }
      // 超分圖已經算過就先給它（回捲／重新掛載不必重跑，也不會先閃原圖再換）。
      if (target) {
        const cached = findSharpenedPage(renderDir, sharpenedName, aspect)
        if (cached) return memoRender(index, { ...cached, half })
      }

      if (disposed) return null
      // 已經在磁碟上就不必再寫（命中時走的就是這條路），只有新寫入的才算進這一話的用量。
      const existed = findPage(renderDir, name) !== null
      const render = writePage(renderDir, name, bytes, aspect)
      if (!render) return null
      if (!existed) chapterCache.account(bytes.byteLength)

      // 漸進式超分：在背景排入超分推論並透過 callback 回傳
      if (target) {
        if (onSharpened) {
          const pageKey = `${ref.epId}_p${index}`
          const t0 = Date.now()
          void sharpenImage(pageKey, data, isCancelled, target).then(result => {
            // `disposed` 一起擋：晚到的結果再寫檔會把 dispose 剛刪掉的目錄又建回來。
            if (!result || disposed || (isCancelled && isCancelled())) return
            const costMs = Date.now() - t0
            if (result.fromCache) {
              log("debug", "upscale", `第 ${index + 1} 頁 ACNet ONNX [快取命中]，0ms 直接顯示`)
            } else {
              log("info", "upscale", `第 ${index + 1} 頁 ACNet ONNX 超分完成 ${sizes}，耗時 ${costMs}ms`)
            }
            const payload = new Uint8Array(result.data.toArrayBuffer())
            const limit = getPageCacheBytes()
            // 單章自己就把上限吃滿時，超分圖不落地（這就是「一話超過 1GB」的保命符）：
            // 原圖照留，重開同一話仍然零網路，只是超分要重算。
            if (limit > 0 && chapterCache.bytes() + payload.byteLength > limit) {
              log("debug", "cache", `第 ${index + 1} 頁超分圖不落地（這一話已達正文快取上限）`)
              return
            }
            const hadSharpened = findSharpenedPage(renderDir, sharpenedName, aspect) !== null
            const sharpened = writeSharpenedPage(renderDir, sharpenedName, payload, aspect)
            if (sharpened) {
              if (!hadSharpened) chapterCache.account(payload.byteLength)
              // 超分圖也要記住：下次重掛直接顯示超分版，不會先閃原圖。
              const render = { ...sharpened, half }
              memoRender(index, render)
              onSharpened(render)
            }
          })
        }
      }

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
      // 跨章預取用：從第一頁往下數 `pages` 頁寫進這一話的磁碟快取，完成才 resolve。
      // 要走 `loadPage` 而不是 `loadPageBytes`：只有前者會寫檔，記憶體快取隨 dispose 就沒了。
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
        // 檔案不刪：那是這一話的跨 session 快取，下次進來直接命中；
        // 何時收掉由開章時的 sweepPageCache 決定（保留話數與容量）。
      },
      dropCache: () => pageCache.dropBytes(),
    }
  }

  /** 跨章預取開好、等著被 `chapter()` 接手的那一話；同時只留一份。 */
  let handoff: {
    id: string
    session: Promise<ChapterSession | null>
    /** 這次已經排進去要抓的頁數；後來要求更多頁就接著抓，不把已經開好的 session 丟掉。 */
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
    sources: () => enabledSources().map(infoOf),

    source: key => {
      const found = findSource(key)
      return found ? infoOf(found) : undefined
    },

    search: (query, onProgress, opts) =>
      searchAll(
        enabledSources(),
        query.keyword,
        source => query.optionsOf?.(source.stored.key) ?? [],
        onProgress ?? (() => {}),
        opts?.signal
      ),

    searchSource: (sourceKey, keyword, options, opts) =>
      searchOne(requireSource(sourceKey), keyword, options, { signal: opts?.signal, filters: opts?.filters }),

    explore: async sourceKey => {
      const { handle } = handleOf(sourceKey)
      // Aidoku 的 explore() 是同步的，但 listings 要先問源一次；Venera 的 explore 本來就隨實例一起載好。
      if (handle.kind === "aidoku") await handle.ready()
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

    // 詳情是「源現在怎麼宣告」的最新事實：順手更新，續讀的快速路徑才有新的方向可用。
    comic: async ref => {
      const page = await loadComic(ref)
      setSourceViewer(ref, page.viewer)
      return page
    },

    resumePlan: ref => resumePlan(ref, loadComic),

    readerChapters: page => readerChaptersOf(page.chapters),

    chapter: async ref => {
      // 跨章預取已經開好這一話：直接接手（頁面清單、比例、已備好的頁都在），不再問源一次。
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
      // 這一話已經在預載：頁數變多就接在後面抓，不要重開（重開會把抓到一半的圖丟掉）。
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
          // 抓圖失敗不該把後面的預熱鏈一起毒死。
          .catch(() => {})
        // 呼叫端等的是「這幾頁抓好」；回 tail 才跟原本的契約一致（`void` 的呼叫端不受影響）。
        return pending.tail
      }
      releasePrefetched()
      const session = openChapter(ref).catch(error => {
        log("debug", "reader", `${ref.epId} 跨章預取失敗`, error)
        return null
      })
      const entry = { id, session, warmed: count, tail: Promise.resolve() }
      handoff = entry
      // 被接手之後照跑：剩下的頁寫進同一個 session；接手方 dispose 時這裡會跟著被取消。
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
      // 「還有下一頁嗎」是源的 maxPage 規則，收在 facade 裡（畫面只讀布林値）。
      return { comments: result.comments, hasMore: hasMoreComments(result.maxPage, page) }
    },

    postComment: async (target, content) => {
      await handleOf(target.sourceKey).handle.postComment(target.comicId, target.subId, content)
    },

    thumbnailPath: async (sourceKey, url) => {
      const { handle } = handleOf(sourceKey)
      // 縮圖也走完整的快取規格（絕對化 URL、onResponse、modifyImage、onLoadFailed 重試）：
      // 封面、頭像、留言內文圖都是同一條路，不再各自拼一次。
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
        // 標題與漫畫資訊客戶端手上有就不必再問一次詳情；缺了才補（省一趟網路）。
        const incomplete = meta?.comicTitle === undefined || group.requests.some(request => request.title === undefined)
        const detail = incomplete ? await openSource(source).detail(group.comicId) : undefined
        // 開始下載就先把清單留下（第一話還沒落地，這裡直接寫，不走 cacheChapterList 的守衛）。
        if (detail) saveChapterList(group.sourceKey, group.comicId, chapterListOf(detail.chapters))
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

    offline: {
      comics: offlineComics,

      comic: ref =>
        offlineComics().find(comic => comic.sourceKey === ref.sourceKey && comic.comicId === ref.comicId),

      chapters: offlineChapterRows,

      readerChapters: ref => mergeChapterList(cachedChapterList(ref.sourceKey, ref.comicId), ref.sourceKey, ref.comicId),

      // 逐章刪：下載管理員會先取消、等任務收尾（不再寫回 manifest），再刪檔。
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
