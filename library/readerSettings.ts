// 閱讀器模式設定：閱讀模式（畫廊 / 連續）× 閱讀方向（左到右 / 右到左 / 上到下）× 翻頁手勢。
//
// 存在 Storage KV。閱讀器每次開啟都重讀，所以設定是全域一致的，
// 不需要跨畫面訂閱。UI 只有閱讀器頂部 HUD 的設定抽屜會改它。

import { kv } from "../engine/storage"

export type ReaderMode = "gallery" | "continuous"
export type ReaderDirection = "ltr" | "rtl" | "ttb"

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

export function getReaderSettings(): ReaderSettings {
  const raw = kv.get(KEY)
  if (!raw || typeof raw !== "object") return { ...DEFAULT }
  const { mode, direction, tapZones } = raw as Partial<ReaderSettings>
  return {
    mode: mode === "gallery" || mode === "continuous" ? mode : DEFAULT.mode,
    direction:
      direction === "ltr" || direction === "rtl" || direction === "ttb"
        ? direction
        : DEFAULT.direction,
    // 舊資料沒有這個欄位 → 用預設（開）。
    tapZones: typeof tapZones === "boolean" ? tapZones : DEFAULT.tapZones,
    hardwareSharpen: typeof (raw as any).hardwareSharpen === "boolean" ? (raw as any).hardwareSharpen : DEFAULT.hardwareSharpen,
  }
}

export function setReaderSettings(settings: ReaderSettings): void {
  kv.set(KEY, settings)
}

/** 閱讀方向決定捲動軸：左到右／右到左是橫向，上到下是縱向。 */
export function readerAxis(direction: ReaderDirection): "horizontal" | "vertical" {
  return direction === "ttb" ? "vertical" : "horizontal"
}
