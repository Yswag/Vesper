export interface MihonPreference {
  key: string | null
  title: string | null
  summary: string | null
  defaultValue: string | number | boolean | null
  enabled: boolean
  visible: boolean
  kind: string | null
  entries: string[]
  entryValues: string[]
  defaultText: string | null
  defaultValues: string[]
  children: MihonPreference[]
}

export type MihonPreferenceControl = "select" | "multi" | "switch" | "text" | "info" | "screen" | "category"

export type MihonPreferenceValues = Record<string, unknown>

export function prefsFileOf(sourceId: string): string {
  return `source_${sourceId}`
}

export function controlOf(node: MihonPreference): MihonPreferenceControl {
  const kind = node.kind ?? ""
  if (node.kind === null) return "screen"
  if (kind.endsWith("MultiSelectListPreference")) return "multi"
  if (kind.endsWith("ListPreference")) return "select"
  if (kind.endsWith("EditTextPreference")) return "text"
  if (kind.endsWith("SwitchPreferenceCompat") || kind.endsWith("SwitchPreference")) return "switch"
  if (kind.endsWith("CheckBoxPreference")) return "switch"
  if (kind.endsWith("PreferenceScreen")) return "screen"
  if (kind.endsWith("PreferenceCategory")) return "category"
  return "info"
}

export function optionsOf(node: MihonPreference): Array<{ label: string; value: string }> {
  return node.entries.map((label, index) => ({ label, value: node.entryValues[index] ?? label }))
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : ""
}

export function switchValueOf(node: MihonPreference, values: MihonPreferenceValues): boolean {
  const stored = node.key ? values[node.key] : undefined
  if (typeof stored === "boolean") return stored
  return typeof node.defaultValue === "boolean" ? node.defaultValue : false
}

export function selectValueOf(node: MihonPreference, values: MihonPreferenceValues): string {
  const stored = node.key ? values[node.key] : undefined
  const text = textOf(stored)
  if (text) return text
  const declared = (node.defaultText ?? "").trim()
  if (declared) return declared
  const fallback = textOf(node.defaultValue)
  if (fallback) return fallback
  return optionsOf(node)[0]?.value ?? ""
}

export function textValueOf(node: MihonPreference, values: MihonPreferenceValues): string {
  const stored = node.key ? values[node.key] : undefined
  if (typeof stored === "string") return stored
  return node.defaultText ?? textOf(node.defaultValue)
}

export function multiValuesOf(node: MihonPreference, values: MihonPreferenceValues): string[] {
  const stored = node.key ? values[node.key] : undefined
  if (Array.isArray(stored)) return stored.filter((value): value is string => typeof value === "string")
  return node.defaultValues.slice()
}

export function multiStoredValue(values: string[]): string[] {
  return values.slice()
}

export function detailOf(node: MihonPreference, values: MihonPreferenceValues): string {
  switch (controlOf(node)) {
    case "select": {
      const current = selectValueOf(node, values)
      return optionsOf(node).find(option => option.value === current)?.label ?? current
    }
    case "multi": {
      const picked = multiValuesOf(node, values).length
      return picked > 0 ? String(picked) : ""
    }
    case "text":
      return textValueOf(node, values)
    case "switch":
      return ""
    default:
      return ""
  }
}

export function summaryOf(node: MihonPreference, values: MihonPreferenceValues): string {
  const summary = (node.summary ?? "").trim()
  if (!summary) return ""
  if (!summary.includes("%s")) return summary
  const detail = detailOf(node, values)
  return detail ? summary.replace(/%s/g, detail) : summary.replace(/\s*%s\s*/g, " ").trim()
}

export function editableOf(node: MihonPreference): boolean {
  return node.key !== null && node.enabled && controlOf(node) !== "info"
}

export interface MihonPreferenceSection {
  title: string
  nodes: MihonPreference[]
}

export function sectionsOf(nodes: MihonPreference[]): MihonPreferenceSection[] {
  const sections: MihonPreferenceSection[] = []
  let current: MihonPreferenceSection = { title: "", nodes: [] }
  sections.push(current)
  for (const node of nodes) {
    if (node.visible === false) continue
    if (controlOf(node) === "category") {
      current = { title: (node.title ?? "").trim(), nodes: [] }
      sections.push(current)
      continue
    }
    current.nodes.push(node)
  }
  return sections.filter(section => section.nodes.length > 0)
}

export function rootNodesOf(nodes: MihonPreference[]): MihonPreference[] {
  if (nodes.length === 1 && controlOf(nodes[0]) === "screen") return nodes[0].children ?? []
  return nodes
}

export function countOf(nodes: MihonPreference[]): number {
  let total = 0
  for (const node of nodes) {
    if (node.key) total += 1
    total += countOf(node.children ?? [])
  }
  return total
}
