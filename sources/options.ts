// 來源選項字串解析模組。
// 處理分類、排行榜與搜尋之 `"值-顯示名"` 選項字串或 `{value, text}` 物件格式。
// 若首字為 `-`（如 mycomic 的 ordering），則取最後一個 `-` 區分鍵值與標籤。

export interface OptionItem {
  /** 傳給源的值。 */
  value: string
  /** 顯示名稱。 */
  label: string
}

export interface OptionRow {
  /** 列名；空的就不顯示（源說 "The label will not be displayed if it is empty"）。 */
  label?: string
  options: OptionItem[]
  /** 這一列的初始值（源可用 `default` 指定，沒指定就是第一項）。 */
  initial: string
}

/** `"值-顯示名"` → 值／名。 */
export function splitOption(raw: string): OptionItem {
  const at = raw.indexOf("-")
  if (at < 0) return { value: raw, label: raw }
  if (at === 0) {
    const last = raw.lastIndexOf("-")
    if (last > 0) return { value: raw.slice(0, last), label: raw.slice(last + 1) }
  }
  return { value: raw.slice(0, at), label: raw.slice(at + 1) }
}

/** 解析單個選項（支援字串 "值-名" 或 {value, text} 物件格式）。 */
export function optionItem(raw: unknown): OptionItem | null {
  if (typeof raw === "string") {
    if (!raw || !raw.includes("-")) return null
    return splitOption(raw)
  }
  if (raw && typeof raw === "object") {
    const item = raw as Record<string, unknown>
    if (item.value == null) return null
    return { value: String(item.value), label: String(item.text ?? item.label ?? item.value) }
  }
  return null
}

/** 解析選項陣列，過濾無效項目並依鍵去重（同值保留最後出現者）。 */
export function optionItems(raw: unknown): OptionItem[] {
  const byValue = new Map<string, OptionItem>()
  for (const entry of Array.isArray(raw) ? raw : []) {
    const item = optionItem(entry)
    if (item != null) byValue.set(item.value, item)
  }
  return Array.from(byValue.values())
}

/** 一列 → 可畫的形狀；沒有選項的列直接丟掉。 */
export function optionRow(raw: unknown): OptionRow | null {
  const row = (raw ?? {}) as Record<string, unknown>
  const options = optionItems(row.options)
  if (options.length === 0) return null

  const preferred = row.default != null ? String(row.default) : ""
  const label = typeof row.label === "string" ? row.label.trim() : ""
  return {
    label: label || undefined,
    options,
    initial: options.some(item => item.value === preferred) ? preferred : options[0].value,
  }
}

/**
 * 把源宣告的列陣列正規化成可畫的形狀。
 * `keep` 可以再過濾（分類用 `showWhen` / `notShowWhen` 篩掉不屬於這個分類的列）。
 */
export function optionRows(raw: unknown, keep?: (row: Record<string, any>) => boolean): OptionRow[] {
  const list = Array.isArray(raw) ? raw : []
  const rows: Array<OptionRow | null> = list
    .filter((item: unknown) => item != null && typeof item === "object" && (keep ? keep(item as Record<string, any>) : true))
    .map((item: unknown) => optionRow(item))
  return rows.filter((row): row is OptionRow => row != null)
}
