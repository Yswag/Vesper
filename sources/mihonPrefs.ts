// Mihon 擴充設定的形狀與取值規則（不碰 VM、不碰磁碟）。
//
// `preferences` op 回的是擴充自己 `PreferenceScreen` 的節點樹：根節點 `kind` 是 null，
// 每一層的子節點在 `children`。`kind` 是類別描述子（`androidx.preference.ListPreference`…），
// 只認結尾，不認套件（擴充可以自帶同名的類別）。
//
// 取值順序照上游讀 SharedPreferences 的語意：`exportPrefs` 的值 → 節點自己宣告的預設 → 空值
// （開關就是 false）。`CheckBoxPreference`／`SwitchPreference` 通常沒宣告預設，所以沒改過的
// 就是 false；擴充自己在 `getBoolean(key, false)` 那頭也是這樣讀。

/** `preferences` op 的一個節點。 */
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

/** 畫面上要哪一種列。`screen` 是巢狀子頁、`category` 只是分組標題。 */
export type MihonPreferenceControl = "select" | "multi" | "switch" | "text" | "info" | "screen" | "category"

/** 一個子源的設定值：就是 `exportPrefs` 那一份（檔名 → key → 值）。 */
export type MihonPreferenceValues = Record<string, unknown>

/** 子源的 prefs 檔名（dexvm 的 `preference_file`：`source_<sourceId>`）。 */
export function prefsFileOf(sourceId: string): string {
  return `source_${sourceId}`
}

export function controlOf(node: MihonPreference): MihonPreferenceControl {
  const kind = node.kind ?? ""
  // 根節點是 `PreferenceScreen`，但 dexvm 對它不給 class 描述子（`kind: null`）。
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

/** 下拉的選項：左邊顯示 `entries`，寫回去的是 `entryValues`（沒給就同名）。 */
export function optionsOf(node: MihonPreference): Array<{ label: string; value: string }> {
  return node.entries.map((label, index) => ({ label, value: node.entryValues[index] ?? label }))
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : ""
}

/** 開關目前的狀態。 */
export function switchValueOf(node: MihonPreference, values: MihonPreferenceValues): boolean {
  const stored = node.key ? values[node.key] : undefined
  if (typeof stored === "boolean") return stored
  return typeof node.defaultValue === "boolean" ? node.defaultValue : false
}

/** 單選目前的 entryValue。 */
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

/** 文字目前的內容。 */
export function textValueOf(node: MihonPreference, values: MihonPreferenceValues): string {
  const stored = node.key ? values[node.key] : undefined
  if (typeof stored === "string") return stored
  return node.defaultText ?? textOf(node.defaultValue)
}

/**
 * 多選目前選了哪些。
 * dexvm 的 SharedPreferences 把字串集合存成換行相接的字串（`getStringSet` 再拆回去），
 * 所以這裡兩邊都走這個表示法。
 */
export function multiValuesOf(node: MihonPreference, values: MihonPreferenceValues): string[] {
  const stored = node.key ? values[node.key] : undefined
  if (typeof stored === "string") return stored.split("\n").filter(value => value.length > 0)
  return node.defaultValues.slice()
}

/** 多選寫回去的樣子（空集合就是空字串，跟「沒這個鍵」不同）。 */
export function multiStoredValue(values: string[]): string {
  return values.join("\n")
}

/** 列右側／副標要顯示的目前值。 */
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

/**
 * 副標：擴充常在 `summary` 裡放 `%s`（AndroidX 會換成目前的值）。
 * 沒有值可換就把佔位符拿掉，不要讓 `%s` 露在畫面上。
 */
export function summaryOf(node: MihonPreference, values: MihonPreferenceValues): string {
  const summary = (node.summary ?? "").trim()
  if (!summary) return ""
  if (!summary.includes("%s")) return summary
  const detail = detailOf(node, values)
  return detail ? summary.replace(/%s/g, detail) : summary.replace(/\s*%s\s*/g, " ").trim()
}

/** 這個節點可不可以操作（`enabled` 是擴充自己算的）。 */
export function editableOf(node: MihonPreference): boolean {
  return node.key !== null && node.enabled && controlOf(node) !== "info"
}

/**
 * 一張卡片要畫哪些列：`PreferenceCategory` 開一張新卡，其餘照原順序排在目前這張。
 * `visible: false` 的節點不出現。
 */
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

/**
 * `preferences` op 的根通常只有一個 `PreferenceScreen`：把它攤成第一層清單（畫面與探針都只看這一層）。
 * 更深的 `PreferenceScreen` 才當子頁。
 */
export function rootNodesOf(nodes: MihonPreference[]): MihonPreference[] {
  if (nodes.length === 1 && controlOf(nodes[0]) === "screen") return nodes[0].children ?? []
  return nodes
}

/** 整棵樹的節點數（源詳情頁那行「共 n 項」）。 */
export function countOf(nodes: MihonPreference[]): number {
  let total = 0
  for (const node of nodes) {
    if (node.key) total += 1
    total += countOf(node.children ?? [])
  }
  return total
}
