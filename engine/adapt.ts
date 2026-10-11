// 把源的各種回傳形狀正規化成我們 UI 吃的樣子。
// 這裡每一條都是 spike 實測出來的落差（見 spike-report.md 第 4 節）。

import { t } from "../i18n"

export interface ComicListItem {
  id: string
  title: string
  subtitle?: string
  cover?: string
  tags: string[]
  description?: string
  updateTime?: string
  /**
   * 這本有幾頁（源的 `maxPage`）。**不是**分頁的頁數 ——
   * picacg 是 `comic.pagesCount`、nhentai 是 `item.num_pages`，上游把它畫在標題前綴（`[459P]`）。
   */
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
 * 章節形狀有三種：
 *   ① 巢狀 `Map<分組名, Map<epId, 標題>>`（多數源）
 *   ② 扁平 `Map<epId, 標題>`
 *   ③ 純物件（少數源根本不用 ComicDetails）
 * epId 一律轉字串（有源用整數鍵）。
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
 * 有些源是單章漫畫（例如 hitomi）：`loadInfo` 根本不回 `chapters`，`loadEp` 也忽略 epId。
 * Venera 對這種源就當作「只有一章」，所以我們也補一個合成章節，epId 用 comicId。
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
 * 把探索回傳拆成「區塊」。
 *
 * 為什麼不能只攤平：`multiPartPage` / `singlePageWithMultiPart` 的源**本來就只有一頁**，
 * 使用者要更多內容的入口是每個區塊的 `viewMore`（跳去分類頁或搜尋頁）。
 * 只回一串 comics 的話，那個入口就消失了，使用者只會看到「已經到底了」。
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
 * 源宣告的跳轉目標有兩種寫法：現在的 `{page, attributes}`，以及舊版的
 * `{action, keyword, param}`（manga_dex 的 dynamic 分類就是後者）。兩種都吃。
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
 * 攤平版本（搜尋結果與需要單一列表的地方用）；保留區塊結構的請用 normalizeListSections。
 *   ① `{comics, maxPage|next}`（最常見）
 *   ② `[{title, comics, viewMore}]`（`multiPartPage`）
 *   ③ `{"最近更新": Comic[], "完結": Comic[]}`（`singlePageWithMultiPart`，如 comick）
 *   ④ `{data: [...]}`（`mixed`）
 * 一律攤平成一串 comics。
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

/** `loadEp` 一定要回 `{images: string[]}`；空字串要當失敗（送去 fetch 會永久 hang）。 */
export function normalizeImages(result: unknown): string[] {
  const images = (result as any)?.images
  if (!Array.isArray(images)) {
    throw new Error("loadEp 沒有回傳 {images: string[]}")
  }
  return images.map((value: unknown) => String(value ?? "")).filter(url => url.length > 0)
}
