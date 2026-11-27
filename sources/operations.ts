import type { AbortSignal } from "scripting"

import { isAbortError } from "../engine/http"
import { log } from "../engine/log"
import { withSourceScope } from "../engine/scope"
import { t } from "../i18n"

import { collectItems, findUpdateTime, normalizeImages, normalizeListPage, normalizeListSections, normalizeTags, resolveChapters, type ComicListItem, type ComicListPage, type JumpTarget, type SectionPage } from "../engine/adapt"
import type { SourceCallRetry } from "../engine/images"
import { readChapterImageKeys } from "../engine/offline"
import type { SourceViewer } from "../library/readerSettings"
import * as aidoku from "./aidoku"
import * as mihon from "./mihon"
import type { MihonFilterState } from "./mihonFilters"
import { splitOption } from "./options"
import type { InstalledSource } from "./registry"
import { ensureSourceReady, reloginSource, sourcesRevision, type ReloginOutcome } from "./registry"
import { sourceText } from "./translation"

export interface ExploreEntry {
  index: number
  title: string
  type: string
  supportsNext: boolean
}

export interface ComicDetail {
  id: string
  title: string
  cover?: string
  description?: string
  status?: ComicStatus
  contentRating?: ContentRating
  viewer?: SourceViewer
  stars?: number
  subId?: string
  tags: Array<{ namespace: string; values: string[] }>
  chapters: Array<{ group: string; id: string; title: string; locked?: boolean; lang?: string }>
  updateTime?: string
  uploadTime?: string
  uploader?: string
  artists?: string
  url?: string
  recommend?: ComicListItem[]
  likesCount?: number
}

export type ComicStatus = "ongoing" | "completed" | "cancelled" | "hiatus" | "notPublished"

export type ContentRating = "safe" | "suggestive" | "nsfw"

export function normalizeStars(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 5) return undefined
  return raw
}

async function requireInstance(source: InstalledSource): Promise<any> {
  if (!source.instance) {
    throw new Error(source.error ?? t("sources.notLoaded", { name: source.stored.name }))
  }
  await ensureSourceReady(source.stored.key)
  return source.instance
}


function isLoginExpired(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return message.toLowerCase().replace(/\s+/g, "").includes("loginexpired")
}

export type Relogin = (source: InstalledSource) => Promise<ReloginOutcome>

export interface SourceScope {
  signal?: AbortSignal
  filters?: unknown[]
  background?: boolean
  fresh?: boolean
}

async function withRelogin<T>(
  source: InstalledSource,
  call: () => T | Promise<T>,
  auth: Relogin = reloginSource
): Promise<T> {
  try {
    return await call()
  } catch (error) {
    if (!isLoginExpired(error)) throw error
    const outcome = await auth(source)
    if (outcome === "ok") return await call()
    if (outcome === "no-credentials" && source.stored.loggedIn) throw new Error(t("sources.login.expired"))
    throw error
  }
}

export function logFailure(scope: string, message: string, error: unknown): void {
  if (isAbortError(error)) return
  log("error", scope, message, error)
}

function callSource<T>(
  source: InstalledSource,
  scope: SourceScope | undefined,
  call: () => T | Promise<T>,
  auth?: Relogin
): Promise<T> {
  return withRelogin(source, () => withSourceScope(source.stored.key, scope?.signal, call), auth)
}

export function imageRetryFor(source: InstalledSource, auth?: Relogin, scope?: SourceScope): SourceCallRetry {
  return call => callSource(source, scope, call, auth)
}

function resolveUrl(base: string | undefined, url: string | undefined): string {
  if (!url) return ""
  if (/^(https?:)?\/\//i.test(url)) return url.startsWith("//") ? "https:" + url : url
  if (!base) return url
  if (url.startsWith("/")) return base.replace(/\/+$/, "") + url
  return url
}

export function exploreEntries(source: InstalledSource): ExploreEntry[] {
  const explore = source.instance?.explore
  if (!Array.isArray(explore)) return []
  return explore.map((entry: any, index: number) => ({
    index,
    title: entry?.title != null
      ? sourceText(source.instance, String(entry.title))
      : t("sources.exploreFallback", { n: index + 1 }),
    type: String(entry?.type ?? "multiPageComicList"),
    supportsNext: typeof entry?.loadNext === "function",
  }))
}

export async function loadExplorePage(
  source: InstalledSource,
  index: number,
  cursor: { page: number } | { next: string },
  scope?: SourceScope
): Promise<ComicListPage> {
  const instance = await requireInstance(source)
  const entry = instance.explore?.[index]
  if (!entry) {
    throw new Error(t("sources.unsupported.exploreIndex", { n: index + 1 }))
  }
  if (typeof entry.load !== "function" && typeof entry.loadNext !== "function") {
    throw new Error(t("sources.unsupported.explore", { title: String(entry.title ?? index + 1) }))
  }

  const started = Date.now()
  try {
    const raw = await callSource(source, scope, () =>
      "next" in cursor && typeof entry.loadNext === "function"
        ? entry.loadNext(cursor.next)
        : typeof entry.load === "function"
          ? entry.load("page" in cursor ? cursor.page : 1)
          : entry.loadNext(undefined)
    )
    const page = normalizeListPage(raw)
    log("debug", "explore", `${source.stored.key}/${entry.title ?? index} → ${page.comics.length} 筆 (${Date.now() - started}ms)`)
    return page
  } catch (error) {
    logFailure("explore", `${source.stored.key}/${entry.title ?? index} 失敗`, error)
    throw error
  }
}

function withCoverBase(source: InstalledSource, comics: ComicListItem[]): ComicListItem[] {
  return comics.map(item => ({ ...item, cover: resolveUrl(source.meta?.url, item.cover) || undefined }))
}

export async function loadExploreSections(
  source: InstalledSource,
  index: number,
  cursor: { page: number } | { next: string },
  scope?: SourceScope
): Promise<SectionPage> {
  const instance = await requireInstance(source)
  const entry = instance.explore?.[index]
  if (!entry) {
    throw new Error(t("sources.unsupported.exploreIndex", { n: index + 1 }))
  }
  if (typeof entry.load !== "function" && typeof entry.loadNext !== "function") {
    throw new Error(t("sources.unsupported.explore", { title: String(entry.title ?? index + 1) }))
  }
  const raw = await callSource(source, scope, () =>
    "next" in cursor && typeof entry.loadNext === "function"
      ? entry.loadNext(cursor.next)
      : typeof entry.load === "function"
        ? entry.load("page" in cursor ? cursor.page : 1)
        : entry.loadNext(undefined)
  )
  const page = normalizeListSections(raw)
  return { ...page, sections: page.sections.map(section => ({ ...section, comics: withCoverBase(source, section.comics) })) }
}

export async function loadCategorySections(
  source: InstalledSource,
  target: JumpTarget,
  cursor: { page: number },
  scope?: SourceScope
): Promise<SectionPage> {
  const instance = await requireInstance(source)
  const page = cursor.page
  let raw: unknown

  if (target.page === "category") {
    const module = instance.categoryComics
    if (typeof module?.load !== "function") throw new Error(t("sources.unsupported.category"))
    raw = await callSource(source, scope, () =>
      module.load(
        target.attributes.category ?? "",
        target.attributes.param ?? null,
        target.attributes.options ?? [],
        page
      )
    )
  } else {
    if (typeof instance.search?.load !== "function") throw new Error(t("sources.unsupported.search"))
    raw = await callSource(source, scope, () =>
      instance.search.load(target.attributes.category ?? "", target.attributes.options ?? [], page)
    )
  }

  const result = normalizeListSections(raw)
  return {
    ...result,
    sections: result.sections.map(section => ({ ...section, comics: withCoverBase(source, section.comics) })),
  }
}


export interface HomeListing {
  id: string
  name: string
  kind?: number
}

export interface HomeChapter {
  id: string
  title: string
  group?: string
  lang?: string
  uploadedAt?: number
}

export interface HomeLink {
  title: string
  subtitle?: string
  imageUrl?: string
  target?: HomeLinkTarget
}

export type HomeLinkTarget =
  | { type: "url"; url: string }
  | { type: "listing"; listing: HomeListing }
  | { type: "manga"; manga: ComicListItem }

interface HomeComponentHead {
  title?: string
  subtitle?: string
}

export type HomeComponent = HomeComponentHead &
  (
    | { type: "imageScroller"; links: HomeLink[]; autoScrollInterval?: number; width?: number; height?: number }
    | { type: "bigScroller"; entries: ComicListItem[]; autoScrollInterval?: number }
    | { type: "scroller"; entries: HomeLink[]; listing?: HomeListing }
    | { type: "mangaList"; ranking: boolean; pageSize?: number; entries: HomeLink[]; listing?: HomeListing }
    | { type: "mangaChapterList"; pageSize?: number; entries: HomeChapterEntry[]; listing?: HomeListing }
    | { type: "filters"; items: HomeFilterItem[] }
    | { type: "links"; links: HomeLink[] }
  )

export interface HomeChapterEntry {
  manga: ComicListItem
  chapter?: HomeChapter
}

export interface HomeFilterItem {
  title: string
  values?: unknown[]
}

export interface SourceHome {
  components: HomeComponent[]
}


export interface RankingOption {
  value: string
  label: string
}

function splitRankingOption(raw: string): RankingOption {
  return splitOption(raw)
}

export function hasRanking(source: InstalledSource): boolean {
  const ranking = source.instance?.categoryComics?.ranking
  return (
    typeof ranking?.load === "function" &&
    Array.isArray(ranking.options) &&
    ranking.options.length > 0 &&
    source.instance?.category?.enableRankingPage !== false
  )
}

export function rankingOptions(source: InstalledSource): RankingOption[] {
  const options = source.instance?.categoryComics?.ranking?.options
  if (!Array.isArray(options)) return []
  return options.map(item => splitRankingOption(String(item)))
}

export async function loadRankingPage(
  source: InstalledSource,
  option: string,
  page: number,
  scope?: SourceScope
): Promise<ComicListPage> {
  const instance = await requireInstance(source)
  const load = instance.categoryComics?.ranking?.load
  if (typeof load !== "function") throw new Error(t("sources.unsupported.ranking"))

  const started = Date.now()
  try {
    const result = normalizeListPage(await callSource(source, scope, () => load.call(instance, option, page)))
    log("debug", "ranking", `${source.stored.key} ${option} p${page} → ${result.comics.length} 筆 (${Date.now() - started}ms)`)
    return { ...result, comics: withCoverBase(source, result.comics) }
  } catch (error) {
    logFailure("ranking", `${source.stored.key} 排行榜載入失敗`, error)
    throw error
  }
}

interface SearchOptions {
  options?: Array<string | null>
  filters?: unknown[]
  page?: number
}

export async function searchSource(
  source: InstalledSource,
  keyword: string,
  options: SearchOptions = {},
  scope?: SourceScope
): Promise<ComicListPage> {
  if (aidoku.isAidoku(source)) return await aidoku.search(source, keyword, options.page ?? 1, options.filters ?? [])
  if (mihon.isMihon(source)) {
    return await mihon.searchPage(source, keyword, options.page ?? 1, (options.filters ?? []) as MihonFilterState[])
  }
  const instance = await requireInstance(source)
  const search = instance.search
  const canLoad = typeof search?.load === "function"
  const canLoadNext = typeof search?.loadNext === "function"
  if (!canLoad && !canLoadNext) throw new Error(t("sources.unsupported.search"))
  if (!canLoad && canLoadNext && (options.page ?? 1) > 1) throw new Error(t("sources.unsupported.searchPaging"))

  const page = options.page ?? 1
  const started = Date.now()
  try {
    const raw = await callSource(source, scope, () =>
      canLoad ? search.load(keyword, options.options ?? [], page) : search.loadNext(keyword, options.options ?? [], null)
    )
    const result = normalizeListPage(raw)
    log("debug", "search", `${source.stored.key}「${keyword}」→ ${result.comics.length} 筆 (${Date.now() - started}ms)`)
    return result
  } catch (error) {
    logFailure("search", `${source.stored.key} 搜尋失敗`, error)
    throw error
  }
}


export const DETAIL_CACHE_TTL_MS = 45_000

export const DETAIL_CACHE_LIMIT = 4

interface CachedDetail {
  source: InstalledSource
  revision: number
  at: number
  detail: ComicDetail
}

const detailCache = new Map<string, CachedDetail>()

function detailCacheKey(sourceKey: string, comicId: string): string {
  return `${sourceKey}\n${comicId}`
}

function copyDetail(detail: ComicDetail): ComicDetail {
  const copy: ComicDetail = {
    ...detail,
    tags: detail.tags.map(tag => ({ ...tag, values: [...tag.values] })),
    chapters: detail.chapters.map(chapter => ({ ...chapter })),
  }
  if (detail.recommend) copy.recommend = detail.recommend.map(item => ({ ...item, tags: [...item.tags] }))
  return copy
}

function readCachedDetail(source: InstalledSource, comicId: string): ComicDetail | undefined {
  const key = detailCacheKey(source.stored.key, comicId)
  const entry = detailCache.get(key)
  if (!entry) return undefined
  const valid =
    entry.source === source &&
    entry.revision === sourcesRevision() &&
    Date.now() - entry.at < DETAIL_CACHE_TTL_MS
  if (!valid) {
    detailCache.delete(key)
    return undefined
  }
  detailCache.delete(key)
  detailCache.set(key, entry)
  return copyDetail(entry.detail)
}

function writeCachedDetail(source: InstalledSource, comicId: string, detail: ComicDetail): void {
  const key = detailCacheKey(source.stored.key, comicId)
  detailCache.delete(key)
  detailCache.set(key, {
    source,
    revision: sourcesRevision(),
    at: Date.now(),
    detail: copyDetail(detail),
  })
  while (detailCache.size > DETAIL_CACHE_LIMIT) {
    const oldest = detailCache.keys().next().value
    if (oldest === undefined) break
    detailCache.delete(oldest)
  }
}

export async function loadDetail(source: InstalledSource, comicId: string, scope?: SourceScope): Promise<ComicDetail> {
  if (scope?.fresh !== true) {
    const cached = readCachedDetail(source, comicId)
    if (cached) return cached
  }
  const detail = await fetchDetail(source, comicId, scope)
  writeCachedDetail(source, comicId, detail)
  return detail
}

async function fetchDetail(source: InstalledSource, comicId: string, scope?: SourceScope): Promise<ComicDetail> {
  if (aidoku.isAidoku(source)) return await aidoku.detail(source, comicId, scope?.background === true)
  if (mihon.isMihon(source)) return await mihon.detail(source, comicId, scope?.background === true)
  const instance = await requireInstance(source)
  if (!instance.comic?.loadInfo) throw new Error(t("sources.unsupported.detail"))

  const started = Date.now()
  const raw = await callSource(source, scope, () => instance.comic.loadInfo(comicId))
  const tags = normalizeTags(raw?.tags)
  const detail: ComicDetail = {
    id: comicId,
    title: String(raw?.title ?? t("sources.untitled")),
    cover: resolveUrl(source.meta?.url, raw?.cover) || undefined,
    description: raw?.description ?? undefined,
    stars: normalizeStars(raw?.stars),
    subId: raw?.subId != null ? String(raw.subId) : undefined,
    tags,
    chapters: resolveChapters(raw?.chapters, comicId),
    updateTime: findUpdateTime(raw?.updateTime, tags),
    uploadTime: raw?.uploadTime ?? undefined,
    uploader: raw?.uploader ?? undefined,
    url: raw?.url ?? undefined,
    recommend: Array.isArray(raw?.recommend) ? collectItems(raw.recommend) : undefined,
    likesCount: typeof raw?.likesCount === "number" && Number.isFinite(raw.likesCount) ? raw.likesCount : undefined,
  }
  log("debug", "detail", `${source.stored.key}/${comicId} → ${detail.chapters.length} 章 (${Date.now() - started}ms)`)
  return detail
}

export async function loadChapterImages(
  source: InstalledSource,
  comicId: string,
  epId: string,
  scope?: SourceScope
): Promise<string[]> {
  if (aidoku.isAidoku(source) || mihon.isMihon(source)) {
    const started = Date.now()
    const images = mihon.isMihon(source)
      ? await mihon.chapterImageKeys(source, comicId, epId)
      : await aidoku.pages(source, comicId, epId)
    log("info", "reader", `${source.stored.key} 章節 ${epId} → ${images.length} 張 (${Date.now() - started}ms)`)
    return images
  }
  const instance = await requireInstance(source)
  if (!instance.comic?.loadEp) throw new Error(t("sources.unsupported.chapter"))

  const started = Date.now()
  const images = normalizeImages(await callSource(source, scope, () => instance.comic.loadEp(comicId, epId)))
  log("info", "reader", `${source.stored.key} 章節 ${epId} → ${images.length} 張 (${Date.now() - started}ms)`)
  if (images.length === 0) throw new Error(t("sources.emptyChapter"))
  return images
}

export async function openChapterImages(
  source: InstalledSource,
  comicId: string,
  epId: string,
  scope?: SourceScope
): Promise<string[]> {
  return readChapterImageKeys({ sourceKey: source.stored.key, comicId, epId }, () =>
    loadChapterImages(source, comicId, epId, scope)
  )
}

export function toListItems(source: InstalledSource, page: ComicListPage): ComicListItem[] {
  return page.comics.map(item => ({
    ...item,
    cover: resolveUrl(source.meta?.url, item.cover) || undefined,
  }))
}


export interface SourceComment {
  id: string
  userName: string
  avatar?: string
  content: string
  time?: string
  replyCount?: number
  isLiked?: boolean
  score?: number
  voteStatus?: number
}

export interface CommentPage {
  comments: SourceComment[]
  maxPage?: number
}

export function hasMoreComments(maxPage: number | undefined, page: number): boolean {
  return typeof maxPage === "number" && Number.isFinite(maxPage) && maxPage > page
}

export function canSendComment(source: InstalledSource): boolean {
  return typeof source.instance?.comic?.sendComment === "function"
}

function normalizeComment(raw: unknown, index: number): SourceComment | null {
  if (!raw || typeof raw !== "object") return null
  const item = raw as Record<string, any>
  return {
    id: item.id != null && item.id !== "" ? String(item.id) : `#${index}`,
    userName: item.userName != null ? String(item.userName) : "",
    avatar: item.avatar ? String(item.avatar) : undefined,
    content: item.content != null ? String(item.content) : "",
    time: item.time != null ? String(item.time) : undefined,
    replyCount: typeof item.replyCount === "number" ? item.replyCount : undefined,
    isLiked: typeof item.isLiked === "boolean" ? item.isLiked : undefined,
    score: typeof item.score === "number" ? item.score : undefined,
    voteStatus: typeof item.voteStatus === "number" ? item.voteStatus : undefined,
  }
}

function normalizeComments(raw: unknown): SourceComment[] {
  if (!Array.isArray(raw)) return []
  const out: SourceComment[] = []
  raw.forEach((entry, index) => {
    const comment = normalizeComment(entry, index)
    if (comment) out.push(comment)
  })
  return out
}

export async function loadComments(
  source: InstalledSource,
  comicId: string,
  subId: string | undefined,
  page: number,
  replyTo?: string,
  scope?: SourceScope
): Promise<CommentPage> {
  const instance = await requireInstance(source)
  const load = instance.comic?.loadComments
  if (typeof load !== "function") throw new Error(t("sources.unsupported.comments"))

  const started = Date.now()
  try {
    const raw = await callSource(source, scope, () => load.call(instance.comic, comicId, subId ?? null, page, replyTo ?? null))
    const comments = normalizeComments(raw?.comments).map(comment => ({
      ...comment,
      avatar: resolveUrl(source.meta?.url, comment.avatar) || undefined,
    }))
    const maxPage = typeof raw?.maxPage === "number" && Number.isFinite(raw.maxPage) ? raw.maxPage : undefined
    log("debug", "comments", `${source.stored.key}/${comicId} p${page} → ${comments.length} 則 (${Date.now() - started}ms)`)
    return { comments, maxPage }
  } catch (error) {
    logFailure("comments", `${source.stored.key} 讀取留言失敗`, error)
    throw error
  }
}

export async function sendComment(
  source: InstalledSource,
  comicId: string,
  subId: string | undefined,
  content: string,
  replyTo?: string,
  scope?: SourceScope
): Promise<void> {
  const instance = await requireInstance(source)
  const send = instance.comic?.sendComment
  if (typeof send !== "function") throw new Error(t("sources.unsupported.sendComment"))

  const text = content.trim()
  if (!text) throw new Error(t("sources.commentEmpty"))

  try {
    await callSource(source, scope, () => send.call(instance.comic, comicId, subId ?? null, text, replyTo ?? null))
    log("info", "comments", `${source.stored.key}/${comicId} 已送出留言（${text.length} 字）`)
  } catch (error) {
    logFailure("comments", `${source.stored.key} 送出留言失敗`, error)
    throw error
  }
}
