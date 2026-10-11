// 源的「選項字串」解析。分類的 `categoryComics.optionList`、排行榜的 `ranking.options`、
// 搜尋的 `search.optionList` 三處共用同一種寫法：`"值-顯示名"`。
//
// 上游 Venera-Next 的實作（`lib/features/comic_source/parser.dart`）：
//   var split = option.split("-");
//   var key = split.removeAt(0);   // 第一個 `-` 之前 = 值
//   var value = split.join("-");   // 其餘全部（含 `-`）= 顯示名
//   map[key] = value;              // LinkedHashMap：同一個值只留最後一個
// 也就是**值切第一個 `-`、顯示名是右邊整串**，而且含 0 個 `-` 的選項直接丟掉。
// komga 的 `metadata.titleSort,asc-标题(A-Z)` 與 ehentai 的 `8-Non-H`（值必須是純 id）都靠這條。
//
// 但有些源的寫法不是這樣：`-id-最新上架`（mycomic，它的 ordering 就是 `-views` 這種值）
// 照上游切會得到**空值**，而且三顆 chip 在 LinkedHashMap 裡塔成一顆（值都一樣）。
// 所以這裡刻意偏離上游：**值為空而且後面還有 `-` 時改切最後一個**。
// 影響範圍只有 mycomic 那 9 條（`-id-` / `-update-` / `-views-` / `-week-` / `-month-`）。
// 另外兩個細節也照上游：沒有 `-` 的選項（或空字串）不採用、同值的選項只留最後一個。

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

/** 源也可能寫 `{value, text}`（官方允許物件寫法）。
 *  字串沒带 `-`（或空字串）就不採用 —— 上游就是這樣跳過的。 */
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

/** 源宣告的 `options` 陣列 → 可畫的清單：跳過沒帶 `-` 的，同一個值只留最後一個。
 *  Map 的鍵順序＝第一次出現的位置、既有鍵再 `set` 只換值不搬家 —— 正好是上游 LinkedHashMap 的語意。 */
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
