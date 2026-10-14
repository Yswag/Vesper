// 頁面底色主題系統：構圖（COMPOSITIONS）與色盤（PALETTES）兩軸正交組合。
// 構圖採 4×4 均勻 MeshGradient 控制點，外圍錨定於 0/1 避免邊緣扭曲。
// 文本採 i18n key 宣告，於畫面渲染時動態求值。

import {
  Circle,
  Rectangle,
  ZStack,
  type Color,
  type DynamicShapeStyle,
  type MeshGradient,
  type ShapeStyle,
} from "scripting"

import { useSubscription } from "./useSubscription"
import { createEmitter } from "../engine/emitter"
import { kv } from "../engine/storage"
import { t, type MessageKey } from "../i18n"

const KEY = "venera:theme"
const CUSTOM_COLOR_KEY = "venera:theme:customColor"

/** 一個色盤的三個角色：底色、過渡、光。 */
export interface Tone {
  base: Color
  mid: Color
  accent: Color
}

export interface Palette {
  id: string
  /** 顯示名稱的 key（`t()` 在畫面 render 時才求值；這裡是模組層常數，不能先算好）。 */
  nameKey: MessageKey
  dark: Tone
  light: Tone
}

export interface Composition {
  id: string
  nameKey: MessageKey
  noteKey: MessageKey
  /** 把一組色排成 mesh（外圈點固定在 0/1）。 */
  build: (tone: Tone) => MeshGradient
}

/**
 * 4×4 均勻正交格線控制點（所有構圖共享相同幾何拓撲，切換時僅插值顏色）。
 */
const grid4: MeshGradient["points"] = [
  [0, 0], [0.333, 0], [0.667, 0], [1, 0],
  [0, 0.333], [0.333, 0.333], [0.667, 0.333], [1, 0.333],
  [0, 0.667], [0.333, 0.667], [0.667, 0.667], [1, 0.667],
  [0, 1], [0.333, 1], [0.667, 1], [1, 1],
]

function mesh4(colors: Color[]): MeshGradient {
  return { width: 4, height: 4, points: grid4, colors }
}

export const COMPOSITIONS: Composition[] = [
  {
    id: "flat",
    nameKey: "settings.theme.composition.flat.name",
    noteKey: "settings.theme.composition.flat.note",
    build: tone => mesh4(new Array(16).fill(tone.base) as Color[]),
  },
  {
    id: "center",
    nameKey: "settings.theme.composition.center.name",
    noteKey: "settings.theme.composition.center.note",
    build: tone =>
      mesh4([
        tone.base, tone.base, tone.base, tone.base,
        tone.base, tone.base, tone.mid, tone.base,
        tone.base, tone.mid, tone.accent, tone.mid,
        tone.base, tone.base, tone.mid, tone.base,
      ]),
  },
  {
    id: "diagonal",
    nameKey: "settings.theme.composition.diagonal.name",
    noteKey: "settings.theme.composition.diagonal.note",
    build: tone =>
      mesh4([
        tone.accent, tone.mid, tone.base, tone.base,
        tone.mid, tone.accent, tone.mid, tone.base,
        tone.base, tone.mid, tone.accent, tone.mid,
        tone.base, tone.base, tone.mid, tone.accent,
      ]),
  },
  {
    id: "twin",
    nameKey: "settings.theme.composition.twin.name",
    noteKey: "settings.theme.composition.twin.note",
    build: tone =>
      mesh4([
        tone.base, tone.base, tone.mid, tone.accent,
        tone.base, tone.base, tone.mid, tone.mid,
        tone.mid, tone.mid, tone.base, tone.base,
        tone.accent, tone.mid, tone.base, tone.base,
      ]),
  },
  {
    id: "edge",
    nameKey: "settings.theme.composition.edge.name",
    noteKey: "settings.theme.composition.edge.note",
    build: tone =>
      mesh4([
        tone.accent, tone.accent, tone.accent, tone.accent,
        tone.mid, tone.mid, tone.mid, tone.mid,
        tone.base, tone.base, tone.base, tone.base,
        tone.base, tone.base, tone.base, tone.base,
      ]),
  },
  {
    id: "spot",
    nameKey: "settings.theme.composition.spot.name",
    noteKey: "settings.theme.composition.spot.note",
    build: tone =>
      mesh4([
        tone.mid, tone.accent, tone.mid, tone.base,
        tone.accent, tone.accent, tone.mid, tone.base,
        tone.mid, tone.mid, tone.base, tone.base,
        tone.base, tone.base, tone.base, tone.base,
      ]),
  },
  {
    id: "field",
    nameKey: "settings.theme.composition.field.name",
    noteKey: "settings.theme.composition.field.note",
    build: tone =>
      mesh4([
        tone.base, tone.mid, tone.accent, tone.mid,
        tone.mid, tone.accent, tone.mid, tone.base,
        tone.accent, tone.mid, tone.base, tone.mid,
        tone.mid, tone.base, tone.mid, tone.accent,
      ]),
  },
]

export const PALETTES: Palette[] = [
  {
    id: "blue",
    nameKey: "settings.theme.palette.blue",
    dark: { base: "#0b0f18", mid: "#101a2c", accent: "#24406e" },
    light: { base: "#f2f4f8", mid: "#e8ecf3", accent: "#b9c9de" },
  },
  {
    id: "ink",
    nameKey: "settings.theme.palette.ink",
    dark: { base: "#15171c", mid: "#1b1e24", accent: "#3d434e" },
    light: { base: "#f4f5f7", mid: "#e9eaee", accent: "#c3c7ce" },
  },
  {
    id: "teal",
    nameKey: "settings.theme.palette.teal",
    dark: { base: "#081418", mid: "#0c1d22", accent: "#1d5b63" },
    light: { base: "#f0f6f6", mid: "#e4eeee", accent: "#b3d2d2" },
  },
  {
    id: "forest",
    nameKey: "settings.theme.palette.forest",
    dark: { base: "#0a1512", mid: "#0e1f18", accent: "#215c47" },
    light: { base: "#f1f6f2", mid: "#e6efe8", accent: "#b4d2c3" },
  },
  {
    id: "violet",
    nameKey: "settings.theme.palette.violet",
    dark: { base: "#120e1c", mid: "#18122a", accent: "#4a3690" },
    light: { base: "#f5f3f8", mid: "#ece8f2", accent: "#c9bfe3" },
  },
  {
    id: "rose",
    nameKey: "settings.theme.palette.rose",
    dark: { base: "#190f16", mid: "#24141d", accent: "#703756" },
    light: { base: "#f8f3f4", mid: "#f2e8ea", accent: "#dbbcc8" },
  },
  {
    id: "amber",
    nameKey: "settings.theme.palette.amber",
    dark: { base: "#161009", mid: "#20170f", accent: "#72502e" },
    light: { base: "#f8f4f0", mid: "#f0e9e2", accent: "#ddc6a8" },
  },
  {
    id: "aurora",
    nameKey: "settings.theme.palette.aurora",
    dark: { base: "#0e1828", mid: "#141a32", accent: "#3a2a5c" },
    light: { base: "#e8edf2", mid: "#dbe6ed", accent: "#c4bdd6" },
  },
]

export interface ThemeChoice {
  composition: string
  palette: string
}

const DEFAULT_CHOICE: ThemeChoice = { composition: "center", palette: "blue" }

/** 舊版（單一主題 id）→ 新版的兩軸組合，讓既有使用者的選擇不會被重置。 */
const LEGACY: Record<string, ThemeChoice> = {
  aurora: { composition: "center", palette: "aurora" },
  glow: { composition: "twin", palette: "blue" },
  plain: { composition: "flat", palette: "ink" },
  deep: { composition: "flat", palette: "blue" },
  mesh: { composition: "center", palette: "blue" },
  "mesh-ink": { composition: "center", palette: "ink" },
  "mesh-teal": { composition: "center", palette: "teal" },
  "mesh-forest": { composition: "center", palette: "forest" },
  "mesh-violet": { composition: "center", palette: "violet" },
  "mesh-rose": { composition: "center", palette: "rose" },
  "mesh-dusk": { composition: "center", palette: "amber" },
}

export function findComposition(id: string): Composition {
  return COMPOSITIONS.find(item => item.id === id) ?? COMPOSITIONS[1]
}

function parseHex(raw: string): [number, number, number] {
  if (typeof raw !== "string") return [10, 132, 255]
  const str = raw.trim().toLowerCase()
  if (str.startsWith("rgb")) {
    const match = str.match(/\d+(\.\d+)?/g)
    if (match && match.length >= 3) {
      return [parseFloat(match[0]), parseFloat(match[1]), parseFloat(match[2])]
    }
  }
  let c = str.replace("#", "").trim()
  if (c.length === 8) c = c.slice(0, 6)
  if (c.length === 3) c = c.split("").map(ch => ch + ch).join("")
  const num = parseInt(c, 16)
  if (isNaN(num)) return [10, 132, 255]
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, "0")
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function buildCustomPalette(accentHex: string): Palette {
  const [r, g, b] = parseHex(accentHex)
  // 暗色模式：底色是微弱原色（乘 0.18），過渡色乘 0.35，光色為原色
  const darkBase = rgbToHex(r * 0.16 + 5, g * 0.16 + 7, b * 0.16 + 10)
  const darkMid = rgbToHex(r * 0.32 + 8, g * 0.32 + 12, b * 0.32 + 16)
  const darkAccent = rgbToHex(r, g, b)

  // 淺色模式：底色近白帶原色調（245+），過渡色（230+），光色（200+）
  const lightBase = rgbToHex(245 + r * 0.03, 246 + g * 0.03, 248 + b * 0.03)
  const lightMid = rgbToHex(232 + r * 0.07, 235 + g * 0.07, 240 + b * 0.07)
  const lightAccent = rgbToHex(190 + r * 0.22, 195 + g * 0.22, 205 + b * 0.22)

  return {
    id: "custom",
    nameKey: "settings.theme.custom",
    dark: { base: darkBase as Color, mid: darkMid as Color, accent: darkAccent as Color },
    light: { base: lightBase as Color, mid: lightMid as Color, accent: lightAccent as Color },
  }
}

export function getCustomColor(): Color {
  const saved = kv.get(CUSTOM_COLOR_KEY)
  return (typeof saved === "string" && saved ? saved : "#0A84FF") as Color
}

// 自訂色只存在 Storage，但底色每次重繪都會問一次。讀一次就夠了，所以把「色碼 + 算好的色盤」
// 留在記憶體：色盤給 findPalette("custom") 用，色碼則當圖層快取的鍵（見 themeLayers，換色＝換鍵）。
let customCache: { hex: string; palette: Palette } | null = null

function loadCustomPalette(): { hex: string; palette: Palette } {
  if (!customCache) {
    const hex = String(getCustomColor())
    customCache = { hex, palette: buildCustomPalette(hex) }
  }
  return customCache
}

export function setCustomColor(hex: string): void {
  kv.set(CUSTOM_COLOR_KEY, hex)
  // 先換快取再通知：訂閱者（PageBackground）收到通知重繪時要拿到新色，不是舊的。
  customCache = { hex, palette: buildCustomPalette(hex) }
  save({ ...current, palette: "custom" })
}

export function findPalette(id: string): Palette {
  if (id === "custom") return loadCustomPalette().palette
  return PALETTES.find(item => item.id === id) ?? PALETTES[0]
}

let current: ThemeChoice = readStoredChoice()

const bus = createEmitter()

/** 把 Storage 裡的原始值解成兩軸。舊版是單一主題 id 的字串（走 LEGACY 映射），壞值退回預設。 */
export function parseChoice(raw: unknown): ThemeChoice {
  if (typeof raw === "string") return LEGACY[raw] ?? DEFAULT_CHOICE
  if (raw && typeof raw === "object") {
    const { composition, palette } = raw as Partial<ThemeChoice>
    return {
      composition: COMPOSITIONS.some(item => item.id === composition) ? composition! : DEFAULT_CHOICE.composition,
      palette: palette === "custom" || PALETTES.some(item => item.id === palette) ? palette! : DEFAULT_CHOICE.palette,
    }
  }
  return DEFAULT_CHOICE
}

function readStoredChoice(): ThemeChoice {
  return parseChoice(kv.get(KEY))
}

function save(next: ThemeChoice) {
  current = next
  kv.set(KEY, next)
  bus.emit()
}

export function themeChoice(): ThemeChoice {
  return current
}

export function setComposition(id: string): void {
  if (!COMPOSITIONS.some(item => item.id === id)) return
  save({ ...current, composition: id })
}

export function setPalette(id: string): void {
  if (id !== "custom" && !PALETTES.some(item => item.id === id)) return
  save({ ...current, palette: id })
}

export const subscribeTheme = bus.subscribe

/** 目前的組合（換構圖或顏色都會重新渲染）。 */
export function useThemeChoice(): ThemeChoice {
  useSubscription(subscribeTheme)
  return themeChoice()
}

// 同一個「構圖 × 色盤」只算一次。每次 build 都要排 16 個控制點的 mesh，而每個頁面都掛一顆
// PageBackground（每次重繪都問一次），回同一份物件才能真的省下來。
// 自訂色盤的內容取決於色碼，所以鍵要把色碼帶上：換色即換鍵，自然變成新圖層（舊的留在這，最多幾筆）。
const layerCache = new Map<string, DynamicShapeStyle[]>()

/** 某個組合的圖層（只有一層 mesh；保留陣列是為了以後要疊第二層時不用改介面）。 */
export function themeLayers(choice: ThemeChoice): DynamicShapeStyle[] {
  const paletteKey = choice.palette === "custom" ? `custom:${loadCustomPalette().hex}` : choice.palette
  const key = `${choice.composition}:${paletteKey}`
  const cached = layerCache.get(key)
  if (cached) return cached

  const composition = findComposition(choice.composition)
  const palette = findPalette(choice.palette)
  const layers: DynamicShapeStyle[] = [
    { light: composition.build(palette.light), dark: composition.build(palette.dark) },
  ]
  layerCache.set(key, layers)
  return layers
}

/** 設定頁的縮圖：用某個構圖 × 某個色盤畫一小塊。 */
export function ThemeSwatch({ composition, palette }: { composition: string; palette: string }) {
  return <Rectangle fill={themeLayers({ composition, palette })[0]} allowsHitTesting={false} />
}

/** 色盤圓點：從底色過渡到光色，跟真正的底色同一個色系。 */
export function PaletteDot({ palette, size = 30 }: { palette: Palette; size?: number }) {
  const fill: DynamicShapeStyle = {
    dark: {
      colors: [palette.dark.accent, palette.dark.base],
      startPoint: "topLeading",
      endPoint: "bottomTrailing",
    },
    light: {
      colors: [palette.light.accent, palette.light.base],
      startPoint: "topLeading",
      endPoint: "bottomTrailing",
    },
  }
  return <Circle fill={fill} frame={{ width: size, height: size }} allowsHitTesting={false} />
}

/** 全域鋪底：貫穿所有分頁與導航欄。 */
export function PageBackground() {
  const choice = useThemeChoice()
  const key = `${choice.composition}:${choice.palette}`
  return (
    <ZStack>
      {themeLayers(choice).map((style, index) => (
        <Rectangle
          key={index}
          fill={style}
          ignoresSafeArea={true}
          allowsHitTesting={false}
          animation={{
            animation: Animation.smooth({ duration: 0.55 }),
            value: key,
          }}
        />
      ))}
    </ZStack>
  )
}
