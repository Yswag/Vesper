import { fetch } from "scripting"

import { maybeGunzip } from "../engine/gzip"
import { decodeFields, signedDecimal, type ProtoField } from "../engine/protobuf"
import { t } from "../i18n"

import { catalogBaseOf, resolveRelative, type CatalogEntry } from "./catalog"
import { keyOf } from "./mihon"

export type MihonIndexSchema = "extension-list" | "array" | "legacy-repo"

export interface MihonIndexMeta {
  badgeLabel?: string
  signingKey?: string
  website?: string
  discord?: string
}

export interface MihonIndexResult {
  entries: CatalogEntry[]
  rejected: Array<{ index: number; reason: string }>
  name?: string
  meta?: MihonIndexMeta
}

const PACKAGE_PATTERN = /^[A-Za-z0-9._]+$/
const JSON_ARRAY = 0x5b
const JSON_OBJECT = 0x7b
const MAX_FOLLOW = 4
const CONTENT_WARNING_NSFW = 3
const LEGACY_NSFW = 1
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
