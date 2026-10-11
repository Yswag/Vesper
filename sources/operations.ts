// 源的操作層：把「載入後的源實例」包成 UI 好用的動作。
// UI 不直接碰源的 explore / comic 物件，所有正規化與錯誤處理都收在這裡。

import type { AbortSignal } from "scripting"

import { isAbortError } from "../engine/http"
import { log } from "../engine/log"
import { withSourceScope } from "../engine/scope"
import { t } from "../i18n"

import { collectItems, normalizeImages, normalizeListPage, normalizeListSections, normalizeTags, resolveChapters, type ComicListItem, type ComicListPage, type JumpTarget, type SectionPage } from "../engine/adapt"
import type { SourceCallRetry } from "../engine/images"
import { readChapterImageKeys } from "../engine/offline"
import { splitOption } from "./options"
import type { InstalledSource } from "./registry"
import { ensureSourceReady, reloginSource, type ReloginOutcome } from "./registry"

export interface ExploreEntry {
  index: number
  title: string
  /** multiPageComicList / multiPartPage / singlePageWithMultiPart / mixed */
  type: string
  supportsNext: boolean
}

export interface ComicDetail {
  id: string
  title: string
  cover?: string
  description?: string
  /** 源給的星等（0–5、可為小數）；源沒給就沒有。只讀顯示，不寫入。 */
  stars?: number
  /** 源自己的子識別碼（多數源忽略）；原封不動保留，之後留言 API 要用。 */
  subId?: string
  tags: Array<{ namespace: string; values: string[] }>
  chapters: Array<{ group: string; id: string; title: string }>
  updateTime?: string
  uploadTime?: string
  uploader?: string
  url?: string
  recommend?: ComicListItem[]
  likesCount?: number
}

/** 源給的分數（`stars`）：0–5 的數字；不是可辨識的數字就當源沒給。 */
export function normalizeStars(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 5) return undefined
  return raw
}

/** 拿到可用的源實例；沒載入就抛，init（）還沒跑就現在跑（按需）。 */
async function requireInstance(source: InstalledSource): Promise<any> {
  if (!source.instance) {
    throw new Error(source.error ?? t("sources.notLoaded", { name: source.stored.name }))
  }
  await ensureSourceReady(source.stored.key)
  return source.instance
}

// ---------------------------------------------------------------- 登入過期自動重登

/**
 * 這個錯誤是不是「登入過期」訊號。上游契約是源 `throw "Login expired"`。
 * 比對時大小寫不敏感、去掉所有空白（源有時 throw 字串而不是 Error）。
 * 只認這一個訊號：網站掛了、找不到作品等一律不觸發重登。
 */
function isLoginExpired(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return message.toLowerCase().replace(/\s+/g, "").includes("loginexpired")
}

/** 重登動作；預設是 registry 的憑證重登，可由呼叫端換掉。 */
export type Relogin = (source: InstalledSource) => Promise<ReloginOutcome>

/**
 * 一次源呼叫的取消範圍（見 `engine/scope.ts`）。
 * **不傳就完全等於現在的行為**：沙箱的 `Network.*` 讀不到 signal，請求照舊發了就等。
 */
export interface SourceScope {
  signal?: AbortSignal
}

/**
 * 把一次源呼叫包上「登入過期 → 重登一次 → 重試一次」（套用到所有源操作）。
 *
 * 只重試一次：重登成功才重試。重登不了時——有登入紀錄但沒有憑證可重登的源
 * （只能瀏覽器登入的 nhentai / manga_dex）給看得懂的訊息；未登入的源、
 * 以及重登本身失敗的，都照舊丟出原本的錯誤。
 */
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

/**
 * 源操作失敗的日誌。**取消不算失敗**：被 abort 的呼叫不留紀錄，
 * 否則 LogScreen 會被「使用者自己按了返回」洗版（見 engine/scope.ts）。
 * 分類（`sources/category.ts`）也用同一支，兩邊的判定才會一致。
 */
export function logFailure(scope: string, message: string, error: unknown): void {
  if (isAbortError(error)) return
  log("error", scope, message, error)
}

/**
 * 把一次源呼叫包上 scope 與「登入過期 → 重登一次 → 重試一次」。
 *
 * 順序是刻意的：**重登在外、scope 在內**。重登本身不可取消（`reloginSource` 沒有 signal 可收），
 * 不讓 scope 漏進去；而重登後的**重試**仍在同一個 scope 裡。
 *
 * scope 也只包住「源的這一次呼叫」：`ensureSourceReady` 的 init 等待在它之外——那是每源一個
 * 共用 promise，取消只能「不再等」，不能真的殺掉（見 `sources/registry.ts`）。
 */
function callSource<T>(
  source: InstalledSource,
  scope: SourceScope | undefined,
  call: () => T | Promise<T>,
  auth?: Relogin
): Promise<T> {
  return withRelogin(source, () => withSourceScope(source.stored.key, scope?.signal, call), auth)
}

/**
 * 圖片解析（`engine/images.ts` 的 onImageLoad）要用的重試。engine 不可以 import sources，
 * 所以由呼叫端把這個閉包帶進圖片管線（`PageCache.bytes` 的 `retry`）。
 */
export function imageRetryFor(source: InstalledSource, auth?: Relogin, scope?: SourceScope): SourceCallRetry {
  return call => callSource(source, scope, call, auth)
}

/** 源沒給絕對網址時，用源宣告的網站當基準補起來。 */
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
    title: String(entry?.title ?? t("sources.exploreFallback", { n: index + 1 })),
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
    // 三種形狀都要吃：`load`（頁碼）、`loadNext`（游標）、以及只有 `loadNext` 的源——
    // 它的第一頁就是「沒有游標」（ehentai 的三個探索條目都是這種；上游明文允許）。
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

/** 封面若源給的是相對路徑，用源宣告的網站補成絶對網址。 */
function withCoverBase(source: InstalledSource, comics: ComicListItem[]): ComicListItem[] {
  return comics.map(item => ({ ...item, cover: resolveUrl(source.meta?.url, item.cover) || undefined }))
}

/**
 * 探索的分頁，但**保留區塊結構**。
 *
 * multiPartPage / singlePageWithMultiPart 的源只有一頁，更多內容的入口在每個區塊的
 * viewMore（跳分類頁/搜尋頁）——所以不能把區塊攤平掉。
 */
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

/** viewMore 跳過去的頁面：category（分類列表）或 search（帶預設選項的搜尋）。 */
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
    // `param` 要傳 **null**（不是空字串）給沒帶 param 的目標：源寫的是 `param ?? 'c'`（picacg），
    // 空字串會讓它拼出 `?page=1&=大濕推薦&s=dd` 這種壞 URL → 站方 400。上游的 Dart 也是 String?（null）。
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
    // 走 search 的跳轉目標（itemType: "search" 的分類 chip、帶預設選項的 viewMore）
    // 把 category 當關鍵字帶上；沒帶的話會變成空關鍵字搜尋。
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

// ---------------------------------------------------------------- 排行榜

export interface RankingOption {
  /** 傳給 `ranking.load` 的值。 */
  value: string
  /** 顯示名稱。 */
  label: string
}

/**
 * 排行榜的選項寫法是 `"值-顯示名"`，跟分類的一樣走 `options.ts`。
 * 有些源的「值」故意是空的（`"-全部"`）。
 */
function splitRankingOption(raw: string): RankingOption {
  return splitOption(raw)
}

/** 有 `ranking.load`、有選項，而且源沒有把它關掉（`enableRankingPage: false`）。 */
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
  /** 源自己的篩選選項（`search.optionList` 的值，照列順序；dropdown 可以是 null）。 */
  options?: Array<string | null>
  page?: number
}

export async function searchSource(
  source: InstalledSource,
  keyword: string,
  options: SearchOptions = {},
  scope?: SourceScope
): Promise<ComicListPage> {
  const instance = await requireInstance(source)
  const search = instance.search
  // ehentai 的 search 只有 loadNext（第一頁 = 沒有游標）；搜尋頁只取第一頁，所以這樣就夠。
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

export async function loadDetail(source: InstalledSource, comicId: string, scope?: SourceScope): Promise<ComicDetail> {
  const instance = await requireInstance(source)
  if (!instance.comic?.loadInfo) throw new Error(t("sources.unsupported.detail"))

  const started = Date.now()
  const raw = await callSource(source, scope, () => instance.comic.loadInfo(comicId))
  const detail: ComicDetail = {
    id: comicId,
    title: String(raw?.title ?? t("sources.untitled")),
    cover: resolveUrl(source.meta?.url, raw?.cover) || undefined,
    description: raw?.description ?? undefined,
    // 源給的分數與 subId 以前被這裡吃掉；原封不動帶出來（stars 只讀顯示、subId 留言要用）。
    stars: normalizeStars(raw?.stars),
    subId: raw?.subId != null ? String(raw.subId) : undefined,
    tags: normalizeTags(raw?.tags),
    // 單章漫畫（例如 hitomi）沒有 chapters：這裡就合成一章，epId = comicId，
    // 讓呼叫端不必各自記得補（否則每一頁都要重寫一次這個判斷）。
    chapters: resolveChapters(raw?.chapters, comicId),
    updateTime: raw?.updateTime ?? undefined,
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
  const instance = await requireInstance(source)
  if (!instance.comic?.loadEp) throw new Error(t("sources.unsupported.chapter"))

  const started = Date.now()
  const images = normalizeImages(await callSource(source, scope, () => instance.comic.loadEp(comicId, epId)))
  log("info", "reader", `${source.stored.key} 章節 ${epId} → ${images.length} 張 (${Date.now() - started}ms)`)
  if (images.length === 0) throw new Error(t("sources.emptyChapter"))
  return images
}

/**
 * 閱讀器開一章要的頁面清單。下載過的章直接從離線層拿（沒有網路也開得起來），
 * 其他章照舊問源；問不到但離線層有東西時退回離線。
 * 兩條路的清單都是 `loadEp` 那一次的產物（下載時就記在 manifest 裡），所以頁數與頁碼對得上。
 */
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

/** 搜尋頁用：把源的 Comic 轉成列表項（含封面絕對化）。 */
export function toListItems(source: InstalledSource, page: ComicListPage): ComicListItem[] {
  return page.comics.map(item => ({
    ...item,
    cover: resolveUrl(source.meta?.url, item.cover) || undefined,
  }))
}

// ---------------------------------------------------------------- 留言

/** 一則留言（形狀照上游的 `Comment`）。`content` 是受限 HTML，交給渲染層處理。 */
export interface SourceComment {
  id: string
  userName: string
  avatar?: string
  content: string
  time?: string
  replyCount?: number
  isLiked?: boolean
  score?: number
  /** 1：頂、-1：噓、0：沒投。 */
  voteStatus?: number
}

export interface CommentPage {
  comments: SourceComment[]
  /** 源回報的頁數原值；不是數字就當沒給。能不能翻頁一律問 `hasMoreComments`。 */
  maxPage?: number
}

/**
 * 有沒有下一頁。**只有「比目前頁大」的 maxPage 才算數**：
 * mxs 硬編 1（永遠單頁）、manhuaren 有留言時回 null、沒留言時回「目前頁」（方向相反），
 * 都不能當成「還有更多」；否則使用者會看到一顆按了沒反應的按鈕。
 */
export function hasMoreComments(maxPage: number | undefined, page: number): boolean {
  return typeof maxPage === "number" && Number.isFinite(maxPage) && maxPage > page
}

/** 源有沒有宣告「送出留言」—— 能力徽章與留言頁的輸入框都問這一個。 */
export function canSendComment(source: InstalledSource): boolean {
  return typeof source.instance?.comic?.sendComment === "function"
}

/** 源的留言物件 → UI 吃的形狀。沒有 id 的（上游允許）給一個穩定但可辨的代替鍵。 */
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

/**
 * 讀一頁留言。`subId` 用詳情帶回來的原值（沒有就是 null）；多數源忽略它，
 * 但 manhuaren / copy_manga 靠它。留言不落地，每次都要重新讀。
 */
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

/**
 * 送出留言。失敗照源的原話拋出去（`nhentai` 的 stub `throw "Not implemented"` 就是這樣
 * 被誠實顯示的）；UI 自己 catch 並顯示訊息。
 */
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
