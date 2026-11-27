import { kv } from "../engine/storage"

export type ReaderMode = "gallery" | "continuous"
export type ReaderDirection = "ltr" | "rtl" | "ttb"

export type SourceViewer = "rtl" | "ltr" | "vertical" | "scroll"

export interface ReaderScope {
  sourceKey: string
  comicId: string
}

export interface ReaderSettings {
  mode: ReaderMode
  direction: ReaderDirection
  tapZones: boolean
  hardwareSharpen: boolean
  splitWide: boolean
  splitSwap: boolean
  cornerPage: boolean
  cornerTime: boolean
  seamlessNext: boolean
}

const DEFAULT: ReaderSettings = {
  mode: "continuous",
  direction: "ttb",
  tapZones: true,
  hardwareSharpen: false,
  splitWide: false,
  splitSwap: false,
  cornerPage: false,
  cornerTime: false,
  seamlessNext: false,
}
const KEY = "venera:readerSettings"
const PER_COMIC_PREFIX = `${KEY}:comic:`

function perComicKey(scope: ReaderScope): string {
  return `${PER_COMIC_PREFIX}${encodeURIComponent(scope.sourceKey)}:${encodeURIComponent(scope.comicId)}`
}

function readSettings(raw: unknown): ReaderSettings | null {
  if (!raw || typeof raw !== "object") return null
  const {
    mode,
    direction,
    tapZones,
    hardwareSharpen,
    splitWide,
    splitSwap,
    cornerPage,
    cornerTime,
    seamlessNext,
  } = raw as Partial<ReaderSettings>
  return {
    mode: mode === "gallery" || mode === "continuous" ? mode : DEFAULT.mode,
    direction:
      direction === "ltr" || direction === "rtl" || direction === "ttb"
        ? direction
        : DEFAULT.direction,
    tapZones: typeof tapZones === "boolean" ? tapZones : DEFAULT.tapZones,
    hardwareSharpen:
      typeof hardwareSharpen === "boolean" ? hardwareSharpen : DEFAULT.hardwareSharpen,
    splitWide: typeof splitWide === "boolean" ? splitWide : DEFAULT.splitWide,
    splitSwap: typeof splitSwap === "boolean" ? splitSwap : DEFAULT.splitSwap,
    cornerPage: typeof cornerPage === "boolean" ? cornerPage : DEFAULT.cornerPage,
    cornerTime: typeof cornerTime === "boolean" ? cornerTime : DEFAULT.cornerTime,
    seamlessNext: typeof seamlessNext === "boolean" ? seamlessNext : DEFAULT.seamlessNext,
  }
}

export function getReaderSettings(): ReaderSettings {
  return readSettings(kv.get(KEY)) ?? { ...DEFAULT }
}

export function setReaderSettings(settings: ReaderSettings): void {
  kv.set(KEY, settings)
}

const VIEWER_KEY = "venera:sourceViewer"
const VIEWER_CAP = 200

function viewerKey(scope: ReaderScope): string {
  return `${scope.sourceKey}\n${scope.comicId}`
}

function isSourceViewer(value: unknown): value is SourceViewer {
  return value === "rtl" || value === "ltr" || value === "vertical" || value === "scroll"
}

export function getSourceViewer(scope: ReaderScope): SourceViewer | undefined {
  const raw = kv.get(VIEWER_KEY)
  if (!raw || typeof raw !== "object") return undefined
  const value = (raw as Record<string, unknown>)[viewerKey(scope)]
  return isSourceViewer(value) ? value : undefined
}

export function setSourceViewer(scope: ReaderScope, viewer: SourceViewer | undefined): void {
  const raw = kv.get(VIEWER_KEY)
  const map: Record<string, SourceViewer> =
    raw && typeof raw === "object" ? { ...(raw as Record<string, SourceViewer>) } : {}
  const key = viewerKey(scope)
  if (!viewer) {
    if (!(key in map)) return
    delete map[key]
    kv.set(VIEWER_KEY, map)
    return
  }
  if (map[key] === viewer) return
  map[key] = viewer
  const keys = Object.keys(map)
  if (keys.length > VIEWER_CAP) {
    for (const stale of keys.slice(0, keys.length - VIEWER_CAP)) delete map[stale]
  }
  kv.set(VIEWER_KEY, map)
}

export function getPerComicSettings(scope: ReaderScope): ReaderSettings | null {
  return readSettings(kv.get(perComicKey(scope)))
}

export function savePerComicSettings(scope: ReaderScope, settings: ReaderSettings): void {
  kv.set(perComicKey(scope), settings)
}

export function clearPerComicSettings(scope: ReaderScope): void {
  const key = perComicKey(scope)
  if (kv.contains(key)) kv.remove(key)
}

const PREFETCH_KEY = "venera:readerPrefetch"
export const PREFETCH_MIN = 0
export const PREFETCH_MAX = 10
const PREFETCH_DEFAULT = 2

function clampPrefetch(value: number): number {
  return Math.min(PREFETCH_MAX, Math.max(PREFETCH_MIN, Math.round(value)))
}

export function getPrefetchPages(): number {
  const raw = kv.get(PREFETCH_KEY)
  return typeof raw === "number" && Number.isFinite(raw) ? clampPrefetch(raw) : PREFETCH_DEFAULT
}

export function setPrefetchPages(value: number): number {
  const next = clampPrefetch(value)
  kv.set(PREFETCH_KEY, next)
  return next
}

const VIEWER_AXES: Record<SourceViewer, { mode: ReaderMode; direction: ReaderDirection }> = {
  rtl: { mode: "gallery", direction: "rtl" },
  ltr: { mode: "gallery", direction: "ltr" },
  vertical: { mode: "gallery", direction: "ttb" },
  scroll: { mode: "continuous", direction: "ttb" },
}

export function viewerAxes(viewer: SourceViewer | undefined): { mode: ReaderMode; direction: ReaderDirection } | null {
  return viewer ? VIEWER_AXES[viewer] ?? null : null
}

export function resolveReaderSettings(
  scope: ReaderScope,
  viewer?: SourceViewer
): { settings: ReaderSettings; perComic: boolean } {
  const global = getReaderSettings()
  const perComic = getPerComicSettings(scope)
  if (perComic) return { settings: perComic, perComic: true }
  const axes = viewerAxes(viewer)
  return { settings: axes ? { ...global, ...axes } : global, perComic: false }
}

export function readerAxis(direction: ReaderDirection): "horizontal" | "vertical" {
  return direction === "ttb" ? "vertical" : "horizontal"
}
