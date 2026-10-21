// SourceRunner：漫畫源執行封裝層。
// 提供統一的 SourceHandle 門面，封裝探索、分區列表、詳情、章節與留言操作。

import type { ComicListPage, JumpTarget, SectionPage } from "../engine/adapt"
import type { HostUI } from "../engine/globals"
import { createHostContext } from "../engine/host"
import { resolveThumbnailRequest, type ImageRequest, type SourceCallRetry } from "../engine/images"
import {
  loadSource as loadSourceCode,
  type LoadedSource,
  type SettingSpec,
  type SourceCapabilities,
  type SourceMeta,
} from "../engine/loader"
import { t } from "../i18n"
import * as aidoku from "./aidoku"
import {
  canSendComment,
  exploreEntries,
  hasRanking,
  imageRetryFor,
  loadCategorySections,
  loadComments,
  loadDetail,
  loadExploreSections,
  loadRankingPage,
  openChapterImages,
  rankingOptions,
  sendComment,
  type CommentPage,
  type ComicDetail,
  type ExploreEntry,
  type RankingOption,
  type Relogin,
  type SourceScope,
} from "./operations"
import { ensureSourceReady, findSource, isReady, reloginSource, type InstalledSource, type ReloginOutcome } from "./registry"

export type {
  CommentPage,
  ComicDetail,
  ComicListPage,
  ExploreEntry,
  LoadedSource,
  RankingOption,
  Relogin,
  ReloginOutcome,
  SectionPage,
  SettingSpec,
  SourceCapabilities,
  SourceMeta,
  SourceScope,
}

/** 源看到的宿主。production 由 composition root 給（settings/loggedIn/ui＝app/hostUI）。 */
export interface SourceHost {
  key: string
  settings?: Record<string, unknown>
  locale?: string
  loggedIn?: boolean
  ui?: HostUI
}

export interface RunnerDeps {
  /** 登入過期時的重登；預設是 registry 的憑證重登。 */
  auth?: Relogin
}

/** 清單目標：探索的某個區塊，或 viewMore 跳過去的分類／搜尋頁。 */
export type ListTarget =
  | { kind: "explore"; index: number }
  | { kind: "category"; target: JumpTarget }

export type Cursor = { page: number } | { next: string }

/** 這一頁的源是哪一種；畫面用它顯示來源類型，不碰 `stored.kind`。 */
export type SourceKind = "venera" | "aidoku"

export interface SourceHandle {
  readonly key: string
  readonly kind: SourceKind
  readonly meta: SourceMeta | undefined
  readonly capabilities: SourceCapabilities | undefined
  readonly settingsSpecs: SettingSpec[]
  readonly settings: Readonly<Record<string, unknown>>
  /** 載入失敗的原因（成功時 undefined）。 */
  readonly error: string | undefined
  /** 執行來源非同步 init() 初始化（按需觸發，共用 Promise 不重複發起）。 */
  ready(): Promise<void>
  explore(): ExploreEntry[]
  /** 排行榜（平舖清單，形狀與 SectionPage 不同，所以不塞進 list）。 */
  ranking(option: string, page: number, scope?: SourceScope): Promise<ComicListPage>
  rankingOptions(): RankingOption[]
  hasRanking(): boolean
  list(target: ListTarget, cursor: Cursor, scope?: SourceScope): Promise<SectionPage>
  detail(comicId: string, scope?: SourceScope): Promise<ComicDetail>
  /** 章節的頁面清單：離線優先（已下載的章不必連網）。 */
  chapter(comicId: string, epId: string, scope?: SourceScope): Promise<string[]>
  comments(
    comicId: string,
    subId: string | undefined,
    page: number,
    replyTo?: string,
    scope?: SourceScope
  ): Promise<CommentPage>
  canPostComment(): boolean
  postComment(
    comicId: string,
    subId: string | undefined,
    content: string,
    replyTo?: string,
    scope?: SourceScope
  ): Promise<void>
  loggedIn(): boolean
  /** 重登：**不能取消**（它本來就是為了救回被登入過期擋下的呼叫）。 */
  relogin(): Promise<ReloginOutcome>
  /** 圖片解析（onImageLoad）要用的重試：登入過期就重登一次再試。`scope` 讓那一次的網路呼叫可取消。 */
  imageRetry(scope?: SourceScope): SourceCallRetry
  /** 正文取圖要問的模組（`engine/images.ts` 的 `onImageLoad`）：Venera 是源的 comic 區塊。 */
  readonly comicModule: any
  /** 縮圖要怎麼抓（Venera 同步；Aidoku 要問源，所以可能是 Promise）。 */
  thumbnailRequest(url: string): ImageRequest | Promise<ImageRequest>
}

/** 把一份源碼載進沙箱（純本地、不跑 init()）。 */
export function loadSource(code: string, host: SourceHost): LoadedSource {
  return loadSourceCode(
    code,
    createHostContext(host.key, {
      settings: host.settings ?? {},
      locale: host.locale,
      loggedIn: host.loggedIn,
      ui: host.ui,
    })
  )
}

async function loadList(
  source: InstalledSource,
  target: ListTarget,
  cursor: Cursor,
  scope?: SourceScope
): Promise<SectionPage> {
  switch (target.kind) {
    case "explore":
      return loadExploreSections(source, target.index, cursor, scope)
    case "category":
      return loadCategorySections(source, target.target, "page" in cursor ? cursor : { page: 1 }, scope)
  }
}

/** 把已載入的源包成 handle。operation 一律 delegate 給現有實作。 */
export function openSource(source: InstalledSource, deps: RunnerDeps = {}): SourceHandle {
  if (aidoku.isAidoku(source)) return aidokuHandle(source)
  return {
    key: source.stored.key,
    kind: "venera",
    meta: source.meta,
    capabilities: source.capabilities,
    settingsSpecs: source.settingsSpecs ?? [],
    settings: source.stored.settings ?? {},
    error: source.error,
    ready: () => ensureSourceReady(source.stored.key),
    explore: () => exploreEntries(source),
    ranking: (option, page, scope) => loadRankingPage(source, option, page, scope),
    rankingOptions: () => rankingOptions(source),
    hasRanking: () => hasRanking(source),
    list: (target, cursor, scope) => loadList(source, target, cursor, scope),
    detail: (comicId, scope) => loadDetail(source, comicId, scope),
    chapter: (comicId, epId, scope) => openChapterImages(source, comicId, epId, scope),
    comments: (comicId, subId, page, replyTo, scope) => loadComments(source, comicId, subId, page, replyTo, scope),
    canPostComment: () => canSendComment(source),
    postComment: (comicId, subId, content, replyTo, scope) =>
      sendComment(source, comicId, subId, content, replyTo, scope),
    loggedIn: () => source.stored.loggedIn === true,
    relogin: () => reloginSource(source),
    imageRetry: (scope?: SourceScope) => imageRetryFor(source, deps.auth, scope),
    comicModule: source.instance?.comic,
    thumbnailRequest: url => resolveThumbnailRequest(source.instance?.comic, url),
  }
}

/** Aidoku 源：四段查詢走 `sources/aidoku.ts`，沒有登入、排行、留言與離線。 */
function aidokuHandle(source: InstalledSource): SourceHandle {
  return {
    key: source.stored.key,
    kind: "aidoku",
    meta: source.meta,
    capabilities: source.capabilities,
    settingsSpecs: [],
    settings: {},
    error: source.error,
    ready: () => aidoku.ready(source),
    explore: () => aidoku.explore(source),
    ranking: () => Promise.reject(new Error(t("sources.unsupported.ranking"))),
    rankingOptions: () => [],
    hasRanking: () => false,
    list: (target, cursor) => aidokuList(source, target, cursor),
    detail: comicId => aidoku.detail(source, comicId),
    chapter: (comicId, epId) => openChapterImages(source, comicId, epId),
    comments: () => Promise.reject(new Error(t("sources.unsupported.comments"))),
    canPostComment: () => false,
    postComment: () => Promise.reject(new Error(t("sources.unsupported.sendComment"))),
    loggedIn: () => false,
    // v1 不做登入：重登永遠是「沒有憑證」，圖片重試就是直接再跑一次。
    relogin: () => Promise.resolve("no-credentials"),
    imageRetry: () => call => Promise.resolve(call()),
    comicModule: aidoku.comicModule(source),
    thumbnailRequest: url => aidoku.imageRequest(source, url),
  }
}

/** Aidoku 的「瀏覽」只有 listings（沒有分類頁）。 */
function aidokuList(source: InstalledSource, target: ListTarget, cursor: Cursor): Promise<SectionPage> {
  if (target.kind === "category") return Promise.reject(new Error(t("sources.unsupported.category")))
  const page = "page" in cursor ? cursor.page : 1
  return aidoku.listing(source, target.index, page).then(result => ({
    sections: [{ title: "", comics: result.comics }],
    maxPage: result.maxPage,
  }))
}

/**
 * 依 key 取得 handle（UI 與其他呼叫端只用這一個入口，不碰 `InstalledSource`）。
 * 找不到或沒載入成功就拋——訊息與 UI 以前自己判斷時看到的一致。
 */
export function sourceHandle(key: string): SourceHandle {
  const source = findSource(key)
  if (!source) throw new Error(t("sources.notFound", { key }))
  if (!isReady(source)) throw new Error(source.error ?? t("sources.notLoaded", { name: source.stored.name }))
  return openSource(source)
}
