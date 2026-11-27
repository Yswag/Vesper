import { t } from "../i18n"

export interface ComicListItem {
  id: string
  title: string
  subtitle?: string
  cover?: string
  tags: string[]
  description?: string
  updateTime?: string
  pageCount?: number
}

export interface ComicListPage {
  comics: ComicListItem[]
  maxPage?: number
  next?: string | null
}

export interface JumpTarget {
  page: "category" | "search"
  attributes: {
    category?: string
    param?: string
    options?: string[]
  }
}

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

export function resolveChapters(chapters: unknown, comicId: string): Array<{ group: string; id: string; title: string }> {
  const list = chapterEntries(chapters)
  if (list.length > 0) return list
  return [{ group: "", id: comicId, title: "" }]
}

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

const UPDATE_NAMESPACES = ["更新", "最後更新", "最后更新", "update", "last update"]

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

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
    pageCount: typeof raw.maxPage === "number" && raw.maxPage > 0 ? raw.maxPage : undefined,
  }
}

export function collectItems(raw: unknown[]): ComicListItem[] {
  const comics: ComicListItem[] = []
  for (const entry of raw) {
    const item = toListItem(entry)
    if (item) comics.push(item)
  }
  return comics
}

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

export function normalizeListPage(result: unknown): ComicListPage {
  let page = normalizeByShape(result)
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

export function normalizeImages(result: unknown): string[] {
  const images = (result as any)?.images
  if (!Array.isArray(images)) {
    throw new Error("loadEp 沒有回傳 {images: string[]}")
  }
  return images.map((value: unknown) => String(value ?? "")).filter(url => url.length > 0)
}
