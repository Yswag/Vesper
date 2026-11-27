export interface OptionItem {
  value: string
  label: string
}

export interface OptionRow {
  label?: string
  options: OptionItem[]
  initial: string
}

export function splitOption(raw: string): OptionItem {
  const at = raw.indexOf("-")
  if (at < 0) return { value: raw, label: raw }
  if (at === 0) {
    const last = raw.lastIndexOf("-")
    if (last > 0) return { value: raw.slice(0, last), label: raw.slice(last + 1) }
  }
  return { value: raw.slice(0, at), label: raw.slice(at + 1) }
}

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

export function optionItems(raw: unknown): OptionItem[] {
  const byValue = new Map<string, OptionItem>()
  for (const entry of Array.isArray(raw) ? raw : []) {
    const item = optionItem(entry)
    if (item != null) byValue.set(item.value, item)
  }
  return Array.from(byValue.values())
}

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

export function optionRows(raw: unknown, keep?: (row: Record<string, any>) => boolean): OptionRow[] {
  const list = Array.isArray(raw) ? raw : []
  const rows: Array<OptionRow | null> = list
    .filter((item: unknown) => item != null && typeof item === "object" && (keep ? keep(item as Record<string, any>) : true))
    .map((item: unknown) => optionRow(item))
  return rows.filter((row): row is OptionRow => row != null)
}
