import { normalizeJumpTarget, type JumpTarget } from "../engine/adapt"
import { t } from "../i18n"
import { logFailure } from "./operations"
import { optionRows, type OptionItem, type OptionRow } from "./options"
import { ensureSourceReady, type InstalledSource } from "./registry"
import { sourceText, translatedOptionRows } from "./translation"

export interface CategoryChip {
  label: string
  target: JumpTarget
}

export interface CategoryPart {
  index: number
  name: string
  kind: "fixed" | "random" | "dynamic"
  chips: CategoryChip[]
  error?: string
}

export function hasCategoryPage(source: InstalledSource): boolean {
  const parts = source.instance?.category?.parts
  return Array.isArray(parts) && parts.length > 0 && typeof source.instance?.categoryComics?.load === "function"
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown): string {
  if (value == null) return ""
  return typeof value === "string" ? value.trim() : String(value).trim()
}

function fixedChip(part: any, item: unknown, index: number, translate: (text: string) => string): CategoryChip | null {
  if (item && typeof item === "object") {
    const label = text((item as any).label ?? (item as any).title)
    const target = normalizeJumpTarget((item as any).target)
    return label && target ? { label: translate(label), target } : null
  }
  const label = text(item)
  if (!label) return null
  const param = asArray(part?.categoryParams)[index] ?? part?.groupParam
  return {
    label: translate(label),
    target: {
      page: part?.itemType === "search" ? "search" : "category",
      attributes: {
        category: label,
        param: param != null ? String(param) : undefined,
      },
    },
  }
}

function dynamicChips(items: any[], translate: (text: string) => string): CategoryChip[] {
  const chips: CategoryChip[] = []
  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const label = text(item.label ?? item.title)
    const target = normalizeJumpTarget(item.target)
    if (label && target) chips.push({ label: translate(label), target })
  }
  return chips
}

function randomIndexes(total: number, count: number): number[] {
  const all = Array.from({ length: total }, (_, index) => index)
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const swap = all[i]
    all[i] = all[j]
    all[j] = swap
  }
  return all
    .slice(0, Math.max(0, Math.min(count, total)))
    .sort((a, b) => a - b)
}


export type CategoryOption = OptionItem
export type CategoryOptionRow = OptionRow

function optionRowVisible(row: Record<string, any>, category: string): boolean {
  const hidden = asArray(row.notShowWhen ?? row.notshowWhen).map(String)
  if (hidden.includes(category)) return false
  const shown = asArray(row.showWhen).map(String)
  return shown.length === 0 || shown.includes(category)
}

export async function loadCategoryOptionRows(
  source: InstalledSource,
  target: JumpTarget
): Promise<CategoryOptionRow[]> {
  if (target.page !== "category") return []
  const module = source.instance?.categoryComics
  if (!module) return []
  const category = target.attributes.category ?? ""
  const param: string | null = target.attributes.param ?? null

  try {
    if (Array.isArray(module.optionList) && module.optionList.length > 0) {
      return translatedOptionRows(source.instance, optionRows(module.optionList, row => optionRowVisible(row, category)))
    }
    if (typeof module.optionLoader === "function") {
      await ensureSourceReady(source.stored.key)
      const loaded = await module.optionLoader.call(source.instance, category, param)
      return translatedOptionRows(source.instance, optionRows(loaded))
    }
  } catch (error) {
    logFailure("category", `${source.stored.key}／${category} 讀不到篩選列`, error)
  }
  return []
}

export function initialOptionValues(rows: CategoryOptionRow[]): string[] {
  return rows.map(row => row.initial)
}

export async function loadCategoryParts(source: InstalledSource): Promise<CategoryPart[]> {
  const parts = asArray(source.instance?.category?.parts)
  if (parts.length === 0) return []
  await ensureSourceReady(source.stored.key)

  const translate = (text: string) => sourceText(source.instance, text)
  const result: CategoryPart[] = []
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    const name = translate(text(part?.name)) || t("sources.categoryFallback", { n: index + 1 })
    const kind = part?.type === "dynamic" ? "dynamic" : part?.type === "random" ? "random" : "fixed"
    try {
      let chips: CategoryChip[]
      if (kind === "dynamic") {
        if (typeof part?.loader !== "function") throw new Error("dynamic 分類沒有 loader")
        chips = dynamicChips(asArray(await part.loader.call(source.instance)), translate)
      } else {
        const items = asArray(part?.categories)
        const used = kind === "random" ? randomIndexes(items.length, Number(part?.randomNumber) || 1) : items.map((_, i) => i)
        chips = used.map(i => fixedChip(part, items[i], i, translate)).filter((chip): chip is CategoryChip => chip != null)
      }
      result.push({ index, name, kind, chips })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logFailure("category", `${source.stored.key}／${name} 讀不到分類`, message)
      result.push({ index, name, kind, chips: [], error: message })
    }
  }
  return result
}
