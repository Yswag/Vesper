// Mihon（keiyoushi）倉庫索引：`index.pb`（gzip 的 protobuf）與 `index.json` 收斂成同一份 CatalogEntry。
//
// 讀法照 mihonapp/mihon main（f8e30a8，2026-11-22）：
//   data/src/main/java/mihon/data/extension/service/ExtensionStoreService.kt 的 fetchStore／getExtensions
//   data/src/main/java/mihon/data/extension/model/NetworkExtensionStore.kt 的 @ProtoNumber
//   data/src/main/java/mihon/data/extension/model/NetworkLegacyExtensionRepo.kt
//
// 格式看解壓後的第一個位元組，不看副檔名（Mihon 就是這樣判斷）：
//   `[` 舊式陣列：只認結尾 `/index.min.json` 的網址，內容不看，改讀同目錄 `repo.json`
//   `{` 先當 `repo.json`，解不成才當 `index.json`
//   其餘是 protobuf 的 index.pb
// `repo.json` 有 `index_v2` 就遞迴讀它；沒有才回頭讀舊式 `index.min.json` 陣列。
// 倉庫名稱取索引自己的 name（新格式第 1 欄）；舊式 repo 才用 meta.name。

import { fetch } from "scripting"

import { maybeGunzip } from "../engine/gzip"
import { decodeFields, signedDecimal, type ProtoField } from "../engine/protobuf"
import { t } from "../i18n"

import { catalogBaseOf, resolveRelative, type CatalogEntry } from "./catalog"
import { keyOf } from "./mihon"

export type MihonIndexSchema = "extension-list" | "array" | "legacy-repo"

/** 索引宣告的倉庫資訊；目前只存下來，不顯示也不驗簽。 */
export interface MihonIndexMeta {
  badgeLabel?: string
  signingKey?: string
  website?: string
  discord?: string
}

export interface MihonIndexResult {
  entries: CatalogEntry[]
  /** 被跳過的條目與原因。 */
  rejected: Array<{ index: number; reason: string }>
  /** 索引自己宣告的名稱（`NetworkExtensionStore.name`／舊式 `meta.name`）。 */
  name?: string
  meta?: MihonIndexMeta
}

/** Android 套件名稱。 */
const PACKAGE_PATTERN = /^[A-Za-z0-9._]+$/
const JSON_ARRAY = 0x5b
const JSON_OBJECT = 0x7b
/** repo.json → index_v2 只會一層；留餘裕擋壞資料的迴圈。 */
const MAX_FOLLOW = 4
/** `ContentWarning` 的 `@ProtoNumber`。 */
const CONTENT_WARNING_NSFW = 3
/** 舊式陣列的 nsfw 是數字，Mihon 把 1 當 R18。 */
const LEGACY_NSFW = 1
/** `ContentWarning.NSFW` 的序列化名稱與 `@JsonNames` 別名。 */
const JSON_NSFW_NAMES = ["NSFW", "CONTENT_WARNING_NSFW"]

const utf8 = new TextDecoder("utf-8")

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function textOfValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 這個 JSON 是不是 Mihon 的索引；不是就回 null。 */
export function mihonIndexSchema(raw: unknown): MihonIndexSchema | null {
  if (Array.isArray(raw)) {
    const records = raw
      .slice(0, 20)
      .map(recordOf)
      .filter((item): item is Record<string, unknown> => item !== null)
    return records.some(item => typeof item.pkg === "string" || typeof item.packageName === "string") ? "array" : null
  }
  const root = recordOf(raw)
  if (!root) return null
  const list = recordOf(root.extensionList)
  if (list && Array.isArray(list.extensions)) return "extension-list"
  const meta = recordOf(root.meta)
  if (meta && typeof meta.signingKeyFingerprint === "string") return "legacy-repo"
  return null
}

// ---------------------------------------------------------------- 索引的內部形狀

interface IndexExtension {
  name?: string
  packageName?: string
  versionName?: string
  apkUrl?: string
  iconUrl?: string
  extensionLib?: string
  nsfw: boolean
  languages: string[]
}

interface DecodedStore {
  name?: string
  meta: MihonIndexMeta
  extensionListUrl?: string
  extensions?: IndexExtension[]
}

// ---------------------------------------------------------------- protobuf 欄位

function fieldBytes(fields: ProtoField[], number: number): Uint8Array | undefined {
  return fields.find(field => field.number === number && field.wire === 2)?.bytes
}

function repeatedBytes(fields: ProtoField[], number: number): Uint8Array[] {
  const out: Uint8Array[] = []
  for (const field of fields) {
    if (field.number === number && field.wire === 2 && field.bytes) out.push(field.bytes)
  }
  return out
}

function fieldText(fields: ProtoField[], number: number): string | undefined {
  const bytes = fieldBytes(fields, number)
  return bytes ? utf8.decode(bytes) : undefined
}

function fieldInteger(fields: ProtoField[], number: number): bigint | undefined {
  return fields.find(field => field.number === number && field.wire === 0)?.integer
}

function messageOfBytes(bytes: Uint8Array | undefined): ProtoField[] {
  return bytes ? decodeFields(bytes) : []
}

function languagesOf(keys: Array<string | undefined>): string[] {
  const languages: string[] = []
  for (const key of keys) {
    if (key && !languages.includes(key)) languages.push(key)
  }
  return languages
}

function sourceLanguagesOfProtobuf(bytes: Uint8Array[]): string[] {
  return languagesOf(bytes.map(item => fieldText(decodeFields(item), 3)))
}

function extensionOfProtobuf(bytes: Uint8Array): IndexExtension {
  const fields = decodeFields(bytes)
  const resources = messageOfBytes(fieldBytes(fields, 3))
  const sources = repeatedBytes(fields, 8)
  return {
    name: fieldText(fields, 1),
    packageName: fieldText(fields, 2),
    apkUrl: fieldText(resources, 1),
    iconUrl: fieldText(resources, 2),
    extensionLib: fieldText(fields, 4),
    versionName: fieldText(fields, 6),
    nsfw: Number(fieldInteger(fields, 7) ?? 0n) === CONTENT_WARNING_NSFW,
    languages: sourceLanguagesOfProtobuf(sources),
  }
}

function storeOfProtobuf(bytes: Uint8Array): DecodedStore {
  const fields = decodeFields(bytes)
  const contact = messageOfBytes(fieldBytes(fields, 4))
  const list = fieldBytes(fields, 101)
  return {
    name: fieldText(fields, 1),
    meta: {
      badgeLabel: fieldText(fields, 2),
      signingKey: fieldText(fields, 3),
      website: fieldText(contact, 1),
      discord: fieldText(contact, 2),
    },
    extensionListUrl: fieldText(fields, 102),
    extensions: list ? repeatedBytes(decodeFields(list), 1).map(extensionOfProtobuf) : undefined,
  }
}

function protobufStoreOf(bytes: Uint8Array): DecodedStore {
  try {
    return storeOfProtobuf(bytes)
  } catch {
    throw new Error(t("sources.mihon.indexInvalid"))
  }
}

// ---------------------------------------------------------------- JSON 欄位

function extensionOfJson(value: unknown): IndexExtension {
  const item = recordOf(value) ?? {}
  const resources = recordOf(item.resources) ?? {}
  const sources = Array.isArray(item.sources) ? item.sources.map(recordOf).filter(isRecord) : []
  return {
    name: textOfValue(item.name),
    packageName: textOfValue(item.packageName),
    apkUrl: textOfValue(resources.apkUrl),
    iconUrl: textOfValue(resources.iconUrl),
    extensionLib: textOfValue(item.extensionLib),
    versionName: textOfValue(item.versionName),
    nsfw: JSON_NSFW_NAMES.includes(textOfValue(item.contentWarning) ?? ""),
    languages: languagesOf(sources.map(source => textOfValue(source.language))),
  }
}

function isRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return value !== null
}

function storeOfJson(raw: unknown): DecodedStore | null {
  const root = recordOf(raw)
  if (!root) return null
  const contact = recordOf(root.contact)
  const list = recordOf(root.extensionList)
  return {
    name: textOfValue(root.name),
    meta: {
      badgeLabel: textOfValue(root.badgeLabel),
      signingKey: textOfValue(root.signingKey),
      website: textOfValue(contact?.website),
      discord: textOfValue(contact?.discord),
    },
    extensionListUrl: textOfValue(root.extensionListUrl),
    extensions: Array.isArray(list?.extensions) ? list.extensions.map(extensionOfJson) : undefined,
  }
}

/** 舊式 `index.min.json`：apk 是檔名（掛在 `apk/` 下），icon 由套件名稱推。 */
function legacyExtensionOfJson(value: unknown, base: string): IndexExtension {
  const item = recordOf(value) ?? {}
  const packageName = textOfValue(item.pkg)
  const version = textOfValue(item.version)
  const apk = textOfValue(item.apk)
  const lang = textOfValue(item.lang)
  return {
    name: textOfValue(item.name)?.replace(/^Tachiyomi:\s*/, ""),
    packageName,
    versionName: version,
    apkUrl: apk ? resolveRelative(base, `apk/${apk}`) : undefined,
    iconUrl: packageName ? `${base}icon/${packageName}.png` : undefined,
    extensionLib: version ? version.split(".").slice(0, 2).join(".") : undefined,
    nsfw: Number(item.nsfw) === LEGACY_NSFW,
    languages: lang ? [lang] : [],
  }
}

// ---------------------------------------------------------------- 對外

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(utf8.decode(bytes))
  } catch {
    throw new Error(t("sources.mihon.indexInvalid"))
  }
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { timeout: 60, allowInsecureRequest: true } as any)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(t("sources.catalog.downloadFailed", { status: response.status }))
  }
  return maybeGunzip(new Uint8Array(await response.arrayBuffer()))
}

/** 索引指向的網址讀不到時，把網址與原因一起報出來（不是默默退回別份索引）。 */
async function followFetch(url: string): Promise<Uint8Array> {
  try {
    return await fetchBytes(url)
  } catch (error) {
    throw new Error(t("sources.mihon.followFailed", { url, reason: messageOf(error) }))
  }
}

function entriesOf(extensions: IndexExtension[], base: string): Pick<MihonIndexResult, "entries" | "rejected"> {
  const entries: CatalogEntry[] = []
  const rejected: Array<{ index: number; reason: string }> = []

  extensions.forEach((item, index) => {
    const packageName = item.packageName
    if (!packageName || !PACKAGE_PATTERN.test(packageName)) {
      rejected.push({ index, reason: t("sources.mihon.indexBadEntry") })
      return
    }
    if (!item.name || !item.versionName) {
      rejected.push({ index, reason: t("sources.mihon.indexBadEntry") })
      return
    }
    if (!item.apkUrl) {
      rejected.push({ index, reason: t("sources.mihon.indexNoApk") })
      return
    }
    entries.push({
      name: item.name,
      key: keyOf(packageName),
      version: item.versionName,
      url: resolveRelative(base, item.apkUrl),
      iconUrl: item.iconUrl ? resolveRelative(base, item.iconUrl) : undefined,
      languages: item.languages,
      nsfw: item.nsfw,
      extensionLib: item.extensionLib,
    })
  })

  return { entries, rejected }
}

async function extensionListOf(url: string, listUrl: string): Promise<IndexExtension[]> {
  const bytes = await followFetch(resolveRelative(url, listUrl))
  if (bytes[0] === JSON_OBJECT) {
    const root = recordOf(parseJson(bytes))
    const list = Array.isArray(root?.extensions) ? (root!.extensions as unknown[]) : []
    return list.map(extensionOfJson)
  }
  try {
    return repeatedBytes(decodeFields(bytes), 1).map(extensionOfProtobuf)
  } catch {
    throw new Error(t("sources.mihon.indexInvalid"))
  }
}

async function storeResult(store: DecodedStore, url: string): Promise<MihonIndexResult> {
  const extensions =
    store.extensions ?? (store.extensionListUrl ? await extensionListOf(url, store.extensionListUrl) : undefined)
  if (!extensions) throw new Error(t("sources.mihon.indexInvalid"))
  return { ...entriesOf(extensions, catalogBaseOf(url)), name: store.name, meta: store.meta }
}

/** 沒有 `index_v2` 的舊式 repo：清單還在本目錄的 `index.min.json`。 */
async function legacyResult(repo: Record<string, unknown>, repoUrl: string): Promise<MihonIndexResult> {
  const base = catalogBaseOf(repoUrl)
  const bytes = await followFetch(`${base}index.min.json`)
  if (bytes[0] !== JSON_ARRAY) throw new Error(t("sources.mihon.indexInvalid"))
  const list = parseJson(bytes)
  if (!Array.isArray(list)) throw new Error(t("sources.mihon.indexInvalid"))
  const meta = recordOf(repo.meta)
  const extensions = list.map(item => legacyExtensionOfJson(item, base))
  return {
    ...entriesOf(extensions, base),
    name: textOfValue(meta?.name),
    meta: {
      badgeLabel: textOfValue(meta?.shortName) ?? textOfValue(meta?.name),
      signingKey: textOfValue(meta?.signingKeyFingerprint),
      website: textOfValue(meta?.website),
    },
  }
}

async function follow(url: string, depth: number): Promise<MihonIndexResult> {
  return loadMihonIndex(url, await followFetch(url), depth + 1)
}

/**
 * 抓一份 Mihon 倉庫索引並解析。`body` 已經抓過（且解過 gzip）就傳進來，省一次下載。
 * 四種網址（`index.pb`、`index.json`、`index.min.json`、`repo.json`）都走這一個入口。
 */
export async function loadMihonIndex(url: string, body?: Uint8Array, depth = 0): Promise<MihonIndexResult> {
  if (depth > MAX_FOLLOW) throw new Error(t("sources.mihon.indexInvalid"))
  const bytes = maybeGunzip(body ?? (await fetchBytes(url)))
  const first = bytes[0]

  if (first === JSON_ARRAY) {
    if (!/\/index\.min\.json$/i.test(url)) throw new Error(t("sources.mihon.legacyUrl"))
    return follow(url.replace(/\/index\.min\.json$/i, "/repo.json"), depth)
  }

  if (first !== JSON_OBJECT) return storeResult(protobufStoreOf(bytes), url)

  const parsed = parseJson(bytes)
  if (mihonIndexSchema(parsed) === "legacy-repo") {
    const repo = recordOf(parsed)!
    const indexV2 = textOfValue(repo.index_v2)
    if (indexV2) return follow(resolveRelative(url, indexV2), depth)
    return legacyResult(repo, url)
  }

  const store = storeOfJson(parsed)
  if (!store) throw new Error(t("sources.mihon.indexInvalid"))
  return storeResult(store, url)
}
