// 來源回傳結構適配層：將漫畫源的多樣化列表、章節與分區格式正規化為標準領域結構。

import { t } from "../i18n"

export interface ComicListItem {
  id: string
  title: string
  subtitle?: string
  cover?: string
  tags: string[]
  description?: string
  updateTime?: string
  /** 單行本/全冊頁數（源的 maxPage 或 pagesCount，非分頁頁數）。 */
  pageCount?: number
}

export interface ComicListPage {
  comics: ComicListItem[]
  maxPage?: number
  next?: string | null
}

/** 探索回傳裡的「查看更多」跳轉目標（Venera 的 viewMore）。 */
export interface JumpTarget {
  page: "category" | "search"
  attributes: {
    category?: string
    param?: string
    options?: string[]
  }
}

/** 探索的一個區塊。multiPartPage / singlePageWithMultiPart 都是這種結構。 */
export interface ComicSection {
  title: string
  comics: ComicListItem[]
  more?: JumpTarget
}

export interface SectionPage {
  sections: ComicSection[]
  maxPage?: number
  next?: string | null
}

/**
 * 解析章節清單（支援巢狀 Map、扁平 Map 與物件結構，epId 統一轉字串）。
 */
export function chapterEntries(chapters: unknown): Array<{ group: string; id: string; title: string }> {
  if (chapters == null) return []
  const out: Array<{ group: string; id: string; title: string }> = []

  const fromMap = (map: Map<unknown, unknown>, group: string) => {
    for (const [id, title] of map.entries()) {
      out.push({ group, id: String(id), title: String(title ?? "") })
    }
  }

  const entries: Array<[string, unknown]> = chapters instanceof Map
    ? [...chapters.entries()].map(([k, v]) => [String(k), v])
    : Object.entries(chapters as Record<string, unknown>)

  const nested = entries.some(([, value]) => value instanceof Map)
  if (nested) {
    for (const [group, value] of entries) {
      if (value instanceof Map) fromMap(value, group)
    }
    return out
  }

  for (const [id, value] of entries) {
    if (value instanceof Map) fromMap(value, id)
    else out.push({ group: "", id, title: String(value ?? "") })
  }
  return out
}

export function firstChapterId(chapters: unknown): string | null {
  const list = chapterEntries(chapters)
  return list.length > 0 ? list[0].id : null
}

/**
 * 單章漫畫（無 chapters 陣列）自動補齊單一合成章節（epId = comicId）。
 */
export function resolveChapters(chapters: unknown, comicId: string): Array<{ group: string; id: string; title: string }> {
  const list = chapterEntries(chapters)
  if (list.length > 0) return list
  return [{ group: "", id: comicId, title: "" }]
}

/** `tags` 有三種：`Map<string, string[]>`、`{ns: string[]}`、`string[]`。 */
export function normalizeTags(tags: unknown): Array<{ namespace: string; values: string[] }> {
  if (tags == null) return []
  if (Array.isArray(tags)) {
    return tags.length > 0 ? [{ namespace: "", values: tags.map(String) }] : []
  }
  const entries: Array<[string, unknown]> = tags instanceof Map
    ? [...tags.entries()].map(([k, v]) => [String(k), v])
    : Object.entries(tags as Record<string, unknown>)
  return entries
    .map(([namespace, values]) => ({
      namespace,
      values: Array.isArray(values) ? values.map(String) : values == null ? [] : [String(values)],
    }))
    .filter(group => group.values.length > 0)
}

/** 追更日期的 tag 命名空間（照上游 `models.dart:298` 的 acceptedNamespaces）。 */
const UPDATE_NAMESPACES = ["更新", "最後更新", "最后更新", "update", "last update"]

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/**
 * 日期字串 → 補零的 `YYYY-MM-DD`。後面的時間會被丟掉。
 * 上游只吃 `-`；這裡多接受 `/`、`.`（既有 `parseUpdateTime` 就吃）。不合格回 undefined——
 * 寧可沒有日期退回短 TTL，也不要拿亂猜的日期把追更冷卻拉長。
 */
export function normalizeUpdateTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const head = value.trim().split(/\s+/)[0] ?? ""
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(head)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 2000 || year > 3000) return undefined
  if (month < 1 || month > 12) return undefined
  if (day < 1 || day > 31) return undefined
  return `${year}-${pad2(month)}-${pad2(day)}`
}

/**
 * 詳情的更新日期：`updateTime` 優先，**有值就不退 tags**（照上游 `findUpdateTime`）；
 * 沒有才取「更新／最後更新／update…」命名空間的第一個標籤。
 */
export function findUpdateTime(
  rawUpdateTime: unknown,
  tags: Array<{ namespace: string; values: string[] }>
): string | undefined {
  if (typeof rawUpdateTime === "string" && rawUpdateTime.trim() !== "") {
    return normalizeUpdateTime(rawUpdateTime)
  }
  for (const group of tags) {
    if (group.values.length === 0) continue
    if (UPDATE_NAMESPACES.includes(group.namespace.trim().toLowerCase())) {
      return normalizeUpdateTime(group.values[0])
    }
  }
  return undefined
}

/** `Comic` 物件可能少了 id 或 cover，這裡統一補齊成 UI 好用的形狀。 */
export function toListItem(raw: any): ComicListItem | null {
  if (!raw || typeof raw !== "object") return null
  const id = raw.id
  if (id == null || id === "") return null
  return {
    id: String(id),
    title: String(raw.title ?? raw.name ?? t("common.untitled")),
    subtitle: raw.subtitle ?? raw.subTitle ?? undefined,
    cover: raw.cover ?? undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    description: raw.description ?? undefined,
    updateTime: raw.updateTime ?? undefined,
    // Comic 物件上的 `maxPage` 是「這本幾頁」（不是分頁）——只有 picacg / nhentai 之類會給。
    pageCount: typeof raw.maxPage === "number" && raw.maxPage > 0 ? raw.maxPage : undefined,
  }
}

/** 把一串原始漫畫物件轉成正規化的清單，壞掉或沒有 id 的直接丟掉。 */
export function collectItems(raw: unknown[]): ComicListItem[] {
  const comics: ComicListItem[] = []
  for (const entry of raw) {
    const item = toListItem(entry)
    if (item) comics.push(item)
  }
  return comics
}

/**
 * 正規化探索分區頁面，保留 multiPart 區塊與 viewMore 跳轉資訊。
 */
export function normalizeListSections(result: unknown): SectionPage {
  if (Array.isArray(result)) {
    const sections: ComicSection[] = []
    for (const part of result) {
      const group = (part as any)?.comics
      if (Array.isArray(group)) {
        const comics: ComicListItem[] = []
        for (const raw of group) {
          const item = toListItem(raw)
          if (item) comics.push(item)
        }
        sections.push({
          title: String((part as any)?.title ?? ""),
          comics,
          more: normalizeJumpTarget((part as any)?.viewMore),
        })
      } else {
        const item = toListItem(part)
        if (item) sections.push({ title: "", comics: [item] })
      }
    }
    return { sections }
  }

  const source = (result ?? {}) as Record<string, any>
  if (Array.isArray(source.comics)) {
    const comics: ComicListItem[] = []
    for (const raw of source.comics) {
      const item = toListItem(raw)
      if (item) comics.push(item)
    }
    return {
      sections: [{ title: "", comics }],
      maxPage: typeof source.maxPage === "number" ? source.maxPage : undefined,
      next: source.next ?? undefined,
    }
  }

  // `mixed` 型（nhentai）：`{data: [{title, comics, viewMore} | Comic[]], maxPage}`。
  // 第 1 頁的 data 是「有標題的區塊」，第 2 頁以後是單純的漫畫陣列，兩種都要吃。
  if (Array.isArray(source.data)) {
    const sections: ComicSection[] = []
    for (const entry of source.data) {
      if (Array.isArray(entry)) {
        const comics = collectItems(entry)
        if (comics.length > 0) sections.push({ title: "", comics })
        continue
      }
      const group = (entry as any)?.comics
      const comics = collectItems(Array.isArray(group) ? group : [])
      if (comics.length > 0) {
        sections.push({
          title: String((entry as any)?.title ?? ""),
          comics,
          more: normalizeJumpTarget((entry as any)?.viewMore),
        })
      }
    }
    return {
      sections,
      maxPage: typeof source.maxPage === "number" ? source.maxPage : undefined,
      next: source.next ?? undefined,
    }
  }

  const sections: ComicSection[] = []
  for (const [title, value] of Object.entries(source)) {
    if (!Array.isArray(value)) continue
    const comics: ComicListItem[] = []
    for (const raw of value) {
      const item = toListItem(raw)
      if (item) comics.push(item)
    }
    if (comics.length > 0) sections.push({ title, comics })
  }
  return { sections }
}

/**
 * 正規化探索區塊的跳轉目標（相容 {page, attributes} 與舊版 {action, keyword, param}）。
 */
export function normalizeJumpTarget(raw: unknown): JumpTarget | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const value = raw as Record<string, any>
  const page = value.page ?? value.action
  if (page !== "category" && page !== "search") return undefined
  const attributes = (value.attributes ?? value) as Record<string, any>
  const label = attributes.category ?? attributes.keyword
  return {
    page,
    attributes: {
      category: label != null ? String(label) : undefined,
      param: attributes.param != null ? String(attributes.param) : undefined,
      options: Array.isArray(attributes.options) ? attributes.options.map(String) : undefined,
    },
  }
}

/**
 * 正規化分頁列表（將各類分區或分節資料平鋪為單一漫畫清單）。
 */
export function normalizeListPage(result: unknown): ComicListPage {
  let page = normalizeByShape(result)
  // mixed 型：{data: [...]}，每個元素本身又是上述某種形狀。
  if (page.comics.length === 0 && result && typeof result === "object" && Array.isArray((result as any).data)) {
    for (const entry of (result as any).data) {
      const inner = normalizeByShape(entry)
      page = { ...page, comics: page.comics.concat(inner.comics) }
    }
  }
  return page
}

function normalizeByShape(result: unknown): ComicListPage {
  if (Array.isArray(result)) {
    const comics: ComicListItem[] = []
    for (const part of result) {
      const group = (part as any)?.comics
      const raw = Array.isArray(group) ? group : [part]
      for (const entry of raw) {
        const item = toListItem(entry)
        if (item) comics.push(item)
      }
    }
    return { comics }
  }

  const source = (result ?? {}) as Record<string, any>
  const comics: ComicListItem[] = []

  if (Array.isArray(source.comics)) {
    for (const raw of source.comics) {
      const item = toListItem(raw)
      if (item) comics.push(item)
    }
  } else {
    // 分節物件：值是漫畫陣列就當成一節（singlePageWithMultiPart）。
    for (const value of Object.values(source)) {
      if (!Array.isArray(value)) continue
      for (const raw of value) {
        const item = toListItem(raw)
        if (item) comics.push(item)
      }
    }
  }

  return {
    comics,
    maxPage: typeof source.maxPage === "number" ? source.maxPage : undefined,
    next: source.next ?? undefined,
  }
}

/** 提取並過濾章節圖片 URL 清單（過濾無效空字串）。 */
export function normalizeImages(result: unknown): string[] {
  const images = (result as any)?.images
  if (!Array.isArray(images)) {
    throw new Error("loadEp 沒有回傳 {images: string[]}")
  }
  return images.map((value: unknown) => String(value ?? "")).filter(url => url.length > 0)
}
