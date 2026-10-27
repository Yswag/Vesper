// 來源分類頁解析：將 category.parts 解析為 UI 分類 chips（支援 fixed/random/dynamic），
// 並透過 categoryComics.optionList 或 optionLoader 讀取專屬篩選列。

import { normalizeJumpTarget, type JumpTarget } from "../engine/adapt"
import { t } from "../i18n"
import { logFailure } from "./operations"
import { optionRows, type OptionItem, type OptionRow } from "./options"
import { ensureSourceReady, type InstalledSource } from "./registry"
import { sourceText, translatedOptionRows } from "./translation"

export interface CategoryChip {
  /** 顯示文字；也是 `categoryComics.load` 的第一個參數。 */
  label: string
  target: JumpTarget
}

export interface CategoryPart {
  index: number
  name: string
  kind: "fixed" | "random" | "dynamic"
  chips: CategoryChip[]
  /** 讀不出來的原因（dynamic 的 loader 丟錯最常見）；有值時 chips 是空的。 */
  error?: string
}

/** 有宣告分類頁、而且真的載得動，才值得在 UI 上給入口。 */
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

/** 固定項 → chip。`categoryParams` 缺項時退回 `groupParam`（nhentai 的語言 part 就是這樣）。 */
function fixedChip(part: any, item: unknown, index: number, translate: (text: string) => string): CategoryChip | null {
  // `{label, target}`：源自己把目標寫好了，直接照用。
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
      // 送給源的是原文，只有顯示名換成譯文。
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

/** 隨機挑 `count` 個索引，回傳排序後的結果（`categoryParams` 要對得上原索引）。 */
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

// ---------------------------------------------------------------- 篩選列解析
// 依據 categoryComics.optionList 或 optionLoader 動態加載當前分類適用的篩選列。

export type CategoryOption = OptionItem
export type CategoryOptionRow = OptionRow

/** `showWhen` 是白名單、`notShowWhen` 是黑名單，比的是分類名（不是 param）。 */
function optionRowVisible(row: Record<string, any>, category: string): boolean {
  // zaimanhua 有一列把 notShowWhen 拼成 notshowWhen，兩種都吃。
  const hidden = asArray(row.notShowWhen ?? row.notshowWhen).map(String)
  if (hidden.includes(category)) return false
  const shown = asArray(row.showWhen).map(String)
  return shown.length === 0 || shown.includes(category)
}

/**
 * 載入指定分類項目的篩選列清單（未宣告或載入失敗時回傳空陣列）。
 */
export async function loadCategoryOptionRows(
  source: InstalledSource,
  target: JumpTarget
): Promise<CategoryOptionRow[]> {
  if (target.page !== "category") return []
  const module = source.instance?.categoryComics
  if (!module) return []
  const category = target.attributes.category ?? ""
  // 沒帶 param 的目標給 null（不是空字串）：源寫 `param ?? 'c'` 的會在空字串上壞掉（picacg）。
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

/** 每列的預設選項，攤平成 `load` 要的 `options`。 */
export function initialOptionValues(rows: CategoryOptionRow[]): string[] {
  return rows.map(row => row.initial)
}

export async function loadCategoryParts(source: InstalledSource): Promise<CategoryPart[]> {
  const parts = asArray(source.instance?.category?.parts)
  if (parts.length === 0) return []
  // dynamic 的 loader 常用到 init() 準備好的資料（komga 的書庫清單就是）。
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
