// 閱讀器模式設定：閱讀模式（畫廊 / 連續）× 閱讀方向（左到右 / 右到左 / 上到下）× 翻頁手勢。
//
// 存在 Storage KV：全域一份；某本漫畫可以有自己的獨立設定（HUD 的 per-comic 開關）。
// 開啟閱讀器時的順序：這本的獨立設定 → 源宣告的 viewer（只換模式與方向）→ 全域。
// 閱讀器每次開啟都重讀，所以改設定不用跨畫面訂閱。UI 只有閱讀器 HUD 的設定選單。

import { kv } from "../engine/storage"

export type ReaderMode = "gallery" | "continuous"
export type ReaderDirection = "ltr" | "rtl" | "ttb"

/** 源宣告的閱讀方式（Aidoku 的 viewer）；只決定模式與方向。 */
export type SourceViewer = "rtl" | "ltr" | "vertical" | "scroll"

/** 一本漫畫的識別（per-comic 設定與 viewer 的範圍）。 */
export interface ReaderScope {
  sourceKey: string
  comicId: string
}

export interface ReaderSettings {
  mode: ReaderMode
  direction: ReaderDirection
  /**
   * 點擊分區翻頁：左＝上一頁、中＝HUD、右＝下一頁。
   * 只在橫向閱讀方向（ltr / rtl）生效——rtl 時左右鏡像；由上到下（ttb）一律整頁點擊＝HUD。
   */
  tapZones: boolean
  /** 啟用 WebGL 硬體加速影像銳化（網點保護）。 */
  hardwareSharpen: boolean
}

/** 沒設定過時的預設：連續 + 上到下（webtoon）＋ 三分區翻頁 ＋ 銳化開啟。 */
const DEFAULT: ReaderSettings = { mode: "continuous", direction: "ttb", tapZones: true, hardwareSharpen: false }
const KEY = "venera:readerSettings"
/** 每本漫畫的獨立設定（per-comic 開關打開時才會寫）。 */
const PER_COMIC_PREFIX = `${KEY}:comic:`

function perComicKey(scope: ReaderScope): string {
  return `${PER_COMIC_PREFIX}${encodeURIComponent(scope.sourceKey)}:${encodeURIComponent(scope.comicId)}`
}

/** 把存下來的東西收成合法設定；不是物件就回 null（沒存過）。 */
function readSettings(raw: unknown): ReaderSettings | null {
  if (!raw || typeof raw !== "object") return null
  const { mode, direction, tapZones, hardwareSharpen } = raw as Partial<ReaderSettings>
  return {
    mode: mode === "gallery" || mode === "continuous" ? mode : DEFAULT.mode,
    direction:
      direction === "ltr" || direction === "rtl" || direction === "ttb"
        ? direction
        : DEFAULT.direction,
    // 舊資料沒有這個欄位 → 用預設（開）。
    tapZones: typeof tapZones === "boolean" ? tapZones : DEFAULT.tapZones,
    hardwareSharpen:
      typeof hardwareSharpen === "boolean" ? hardwareSharpen : DEFAULT.hardwareSharpen,
  }
}

export function getReaderSettings(): ReaderSettings {
  return readSettings(kv.get(KEY)) ?? { ...DEFAULT }
}

export function setReaderSettings(settings: ReaderSettings): void {
  kv.set(KEY, settings)
}

/** 這本漫畫的獨立設定；沒開 per-comic（或沒存過）回 null。 */
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

/** viewer 對我們兩個軸的對應（Aidoku：rtl/ltr/vertical 是分頁，scroll 是連續）。 */
const VIEWER_AXES: Record<SourceViewer, { mode: ReaderMode; direction: ReaderDirection }> = {
  rtl: { mode: "gallery", direction: "rtl" },
  ltr: { mode: "gallery", direction: "ltr" },
  vertical: { mode: "gallery", direction: "ttb" },
  scroll: { mode: "continuous", direction: "ttb" },
}

export function viewerAxes(viewer: SourceViewer | undefined): { mode: ReaderMode; direction: ReaderDirection } | null {
  return viewer ? VIEWER_AXES[viewer] ?? null : null
}

/**
 * 開啟閱讀器時的設定（順序）：這本的獨立設定 → 源的 viewer（只換模式與方向）→ 全域。
 * `perComic` 告訴畫面開關要不要打開；viewer 只有 Aidoku 源會給，Venera 源就是直接退全域。
 */
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

/** 閱讀方向決定捲動軸：左到右／右到左是橫向，上到下是縱向。 */
export function readerAxis(direction: ReaderDirection): "horizontal" | "vertical" {
  return direction === "ttb" ? "vertical" : "horizontal"
}
