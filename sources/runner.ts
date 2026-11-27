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
import * as mihon from "./mihon"
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
  type HomeListing,
  type RankingOption,
  type Relogin,
  type SourceHome,
  type SourceScope,
} from "./operations"
import { ensureSourceReady, findSource, isReady, reloginSource, type InstalledSource, type ReloginOutcome } from "./registry"

export type {
  CommentPage,
  ComicDetail,
  ComicListPage,
  ExploreEntry,
  HomeListing,
  LoadedSource,
  RankingOption,
  Relogin,
  ReloginOutcome,
  SectionPage,
  SettingSpec,
  SourceCapabilities,
  SourceHome,
  SourceMeta,
  SourceScope,
}

export interface SourceHost {
  key: string
  settings?: Record<string, unknown>
  locale?: string
  loggedIn?: boolean
  ui?: HostUI
}

export interface RunnerDeps {
  auth?: Relogin
}

export type ListTarget =
  | { kind: "explore"; index: number }
  | { kind: "listing"; listing: HomeListing }
  | { kind: "category"; target: JumpTarget }
  | { kind: "search"; keyword: string; filters?: unknown[] }

export type Cursor = { page: number } | { next: string }

export type SourceKind = "venera" | "aidoku" | "mihon"

export interface SourceHandle {
  readonly key: string
  readonly kind: SourceKind
  readonly meta: SourceMeta | undefined
  readonly capabilities: SourceCapabilities | undefined
  readonly settingsSpecs: SettingSpec[]
  readonly settings: Readonly<Record<string, unknown>>
  readonly error: string | undefined
  ready(): Promise<void>
  explore(): ExploreEntry[]
  hasHome(): boolean
  home(opts?: { reload?: boolean }): Promise<SourceHome>
  ranking(option: string, page: number, scope?: SourceScope): Promise<ComicListPage>
  rankingOptions(): RankingOption[]
  hasRanking(): boolean
  list(target: ListTarget, cursor: Cursor, scope?: SourceScope): Promise<SectionPage>
  detail(comicId: string, scope?: SourceScope): Promise<ComicDetail>
  chapter(comicId: string, epId: string, scope?: SourceScope): Promise<string[]>
  acceptsImageKeys?(keys: string[]): boolean
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
  relogin(): Promise<ReloginOutcome>
  imageRetry(scope?: SourceScope): SourceCallRetry
  readonly comicModule: any
  thumbnailRequest(url: string): ImageRequest | Promise<ImageRequest>
}

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
    case "listing":
      throw new Error(t("sources.unsupported.explore", { title: target.listing.name }))
    case "search":
      throw new Error(t("sources.unsupported.search"))
    case "category":
      return loadCategorySections(source, target.target, "page" in cursor ? cursor : { page: 1 }, scope)
  }
}

export function openSource(source: InstalledSource, deps: RunnerDeps = {}): SourceHandle {
  if (aidoku.isAidoku(source)) return aidokuHandle(source)
  if (mihon.isMihon(source)) return mihonHandle(source)
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
    hasHome: () => false,
    home: () => Promise.reject(new Error(t("sources.unsupported.home"))),
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
    hasHome: () => aidoku.hasHome(source.stored.key),
    home: opts => aidoku.home(source, opts?.reload === true),
    ranking: () => Promise.reject(new Error(t("sources.unsupported.ranking"))),
    rankingOptions: () => [],
    hasRanking: () => false,
    list: (target, cursor) => aidokuList(source, target, cursor),
    detail: (comicId, scope) => loadDetail(source, comicId, scope),
    chapter: (comicId, epId) => openChapterImages(source, comicId, epId),
    comments: () => Promise.reject(new Error(t("sources.unsupported.comments"))),
    canPostComment: () => false,
    postComment: () => Promise.reject(new Error(t("sources.unsupported.sendComment"))),
    loggedIn: () => false,
    relogin: () => Promise.resolve("no-credentials"),
    imageRetry: () => call => Promise.resolve(call()),
    comicModule: aidoku.comicModule(source),
    thumbnailRequest: url => aidoku.coverRequest(source, url),
  }
}

function mihonHandle(source: InstalledSource): SourceHandle {
  return {
    key: source.stored.key,
    kind: "mihon",
    meta: source.meta,
    capabilities: source.capabilities,
    settingsSpecs: [],
    settings: {},
    error: source.error,
    ready: () => mihon.ready(source),
    explore: () => mihon.exploreOf(source),
    hasHome: () => false,
    home: () => Promise.reject(new Error(t("sources.unsupported.home"))),
    ranking: () => Promise.reject(new Error(t("sources.unsupported.ranking"))),
    rankingOptions: () => [],
    hasRanking: () => false,
    list: (target, cursor) => mihonList(source, target, cursor),
    detail: (comicId, scope) => loadDetail(source, comicId, scope),
    chapter: (comicId, epId) => openChapterImages(source, comicId, epId),
    acceptsImageKeys: keys => mihon.acceptsImageKeys(keys),
    comments: () => Promise.reject(new Error(t("sources.unsupported.comments"))),
    canPostComment: () => false,
    postComment: () => Promise.reject(new Error(t("sources.unsupported.sendComment"))),
    loggedIn: () => false,
    relogin: () => Promise.resolve("no-credentials"),
    imageRetry: () => call => Promise.resolve(call()),
    comicModule: mihon.comicModule(source),
    thumbnailRequest: url => mihon.coverRequest(source, url),
  }
}

function mihonList(source: InstalledSource, target: ListTarget, cursor: Cursor): Promise<SectionPage> {
  if (target.kind === "category" || target.kind === "listing") {
    return Promise.reject(new Error(t("sources.unsupported.category")))
  }
  const page = "page" in cursor ? cursor.page : 1
  const result =
    target.kind === "search"
      ? mihon.searchPage(source, target.keyword, page)
      : mihon.listPage(
          source,
          target.kind === "explore" && target.index === 1 ? "latest" : "popular",
          page
        )
  return result.then(list => ({ sections: [{ title: "", comics: list.comics }], maxPage: list.maxPage }))
}

function aidokuList(source: InstalledSource, target: ListTarget, cursor: Cursor): Promise<SectionPage> {
  if (target.kind === "category") return Promise.reject(new Error(t("sources.unsupported.category")))
  const page = "page" in cursor ? cursor.page : 1
  const list =
    target.kind === "search"
      ? aidoku.search(source, target.keyword, page, target.filters ?? [])
      : aidoku.listing(source, target.kind === "listing" ? target.listing : target.index, page)
  return list.then(result => ({
    sections: [{ title: "", comics: result.comics }],
    maxPage: result.maxPage,
  }))
}

export function sourceHandle(key: string): SourceHandle {
  const source = findSource(key)
  if (!source) throw new Error(t("sources.notFound", { key }))
  if (!isReady(source)) throw new Error(source.error ?? t("sources.notLoaded", { name: source.stored.name }))
  return openSource(source)
}
