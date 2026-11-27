import {
  Circle,
  NavigationStack,
  Rectangle,
  ZStack,
  useColorScheme,
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
const APPEARANCE_KEY = "venera:appearance"

export interface Tone {
  base: Color
  mid: Color
  accent: Color
}

export interface Palette {
  id: string
  nameKey: MessageKey
  dark: Tone
  light: Tone
}

export interface Composition {
  id: string
  nameKey: MessageKey
  noteKey: MessageKey
  build: (tone: Tone) => MeshGradient
}

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
    id: "long",
    nameKey: "settings.theme.composition.long.name",
    noteKey: "settings.theme.composition.long.note",
    build: tone =>
      mesh4([
        tone.accent, tone.accent, tone.accent, tone.accent,
        tone.mid, tone.mid, tone.mid, tone.mid,
        tone.mid, tone.mid, tone.mid, tone.mid,
        tone.base, tone.base, tone.base, tone.base,
      ]),
  },
  {
    id: "dusk",
    nameKey: "settings.theme.composition.dusk.name",
    noteKey: "settings.theme.composition.dusk.note",
    build: tone =>
      mesh4([
        tone.mid, tone.mid, tone.mid, tone.mid,
        tone.base, tone.base, tone.base, tone.base,
        tone.mid, tone.mid, tone.mid, tone.mid,
        tone.accent, tone.accent, tone.accent, tone.accent,
      ]),
  },
  {
    id: "twin",
    nameKey: "settings.theme.composition.twin.name",
    noteKey: "settings.theme.composition.twin.note",
    build: tone =>
      mesh4([
        tone.base, tone.mid, tone.mid, tone.accent,
        tone.base, tone.base, tone.mid, tone.mid,
        tone.base, tone.base, tone.base, tone.mid,
        tone.base, tone.base, tone.base, tone.base,
      ]),
  },
]

export const PALETTES: Palette[] = [
  {
    id: "blue",
    nameKey: "settings.theme.palette.blue",
    dark: { base: "#0b0f18", mid: "#101a2c", accent: "#325384" },
    light: { base: "#f2f4f8", mid: "#e8ecf3", accent: "#bdd3f2" },
  },
  {
    id: "ink",
    nameKey: "settings.theme.palette.ink",
    dark: { base: "#15171c", mid: "#1b1e24", accent: "#505259" },
    light: { base: "#f4f5f7", mid: "#e9eaee", accent: "#cfd1d6" },
  },
  {
    id: "teal",
    nameKey: "settings.theme.palette.teal",
    dark: { base: "#081418", mid: "#0c1d22", accent: "#035e63" },
    light: { base: "#f0f6f6", mid: "#e4eeee", accent: "#abdbde" },
  },
  {
    id: "forest",
    nameKey: "settings.theme.palette.forest",
    dark: { base: "#0a1512", mid: "#0e1f18", accent: "#076246" },
    light: { base: "#f1f6f2", mid: "#e6efe8", accent: "#b3dcc9" },
  },
  {
    id: "violet",
    nameKey: "settings.theme.palette.violet",
    dark: { base: "#120e1c", mid: "#18122a", accent: "#544880" },
    light: { base: "#f5f3f8", mid: "#ece8f2", accent: "#d1ccf0" },
  },
  {
    id: "rose",
    nameKey: "settings.theme.palette.rose",
    dark: { base: "#190f16", mid: "#24141d", accent: "#7b3b4c" },
    light: { base: "#f8f3f4", mid: "#f2e8ea", accent: "#efc4cc" },
  },
  {
    id: "amber",
    nameKey: "settings.theme.palette.amber",
    dark: { base: "#161009", mid: "#20170f", accent: "#754614" },
    light: { base: "#f8f4f0", mid: "#f0e9e2", accent: "#eacab0" },
  },
  {
    id: "aurora",
    nameKey: "settings.theme.palette.aurora",
    dark: { base: "#0e1828", mid: "#0d2021", accent: "#654274" },
    light: { base: "#e8edf2", mid: "#d9e7e8", accent: "#dec8e8" },
  },
]

export interface ThemeChoice {
  composition: string
  palette: string
}

const DEFAULT_CHOICE: ThemeChoice = { composition: "edge", palette: "blue" }

const LEGACY: Record<string, ThemeChoice> = {
  aurora: { composition: "edge", palette: "aurora" },
  glow: { composition: "edge", palette: "blue" },
  plain: { composition: "flat", palette: "ink" },
  deep: { composition: "flat", palette: "blue" },
  mesh: { composition: "edge", palette: "blue" },
  "mesh-ink": { composition: "edge", palette: "ink" },
  "mesh-teal": { composition: "edge", palette: "teal" },
  "mesh-forest": { composition: "edge", palette: "forest" },
  "mesh-violet": { composition: "edge", palette: "violet" },
  "mesh-rose": { composition: "edge", palette: "rose" },
  "mesh-dusk": { composition: "edge", palette: "amber" },
}

const RENAMED_COMPOSITIONS: Record<string, string> = { spot: "dusk" }

export function findComposition(id: string): Composition {
  return COMPOSITIONS.find(item => item.id === id) ?? COMPOSITIONS.find(item => item.id === DEFAULT_CHOICE.composition) ?? COMPOSITIONS[0]
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

const ACCENT_BAND: Record<"light" | "dark", { lightness: number; chroma: number }> = {
  dark: { lightness: 0.44, chroma: 0.09 },
  light: { lightness: 0.86, chroma: 0.05 },
}
const ACHROMATIC_BELOW_CHROMA = 0.02

function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex).map(channel => linearize(channel))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklchToHex(lightness: number, chroma: number, hue: number): string {
  const radians = (hue * Math.PI) / 180
  const encode = (amount: number): [number, number, number] => {
    const a = amount * Math.cos(radians)
    const b = amount * Math.sin(radians)
    const l = Math.pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3)
    const m = Math.pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3)
    const s = Math.pow(lightness - 0.0894841775 * a - 1.291485548 * b, 3)
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]
  }
  let reachable = chroma
  let linear = encode(reachable)
  while (linear.some(value => value < -0.0005 || value > 1.0005) && reachable > 0) {
    reachable -= 0.002
    linear = encode(reachable)
  }
  const toChannel = (value: number): number => {
    const clamped = Math.max(0, Math.min(1, value))
    return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055
  }
  return rgbToHex(toChannel(linear[0]) * 255, toChannel(linear[1]) * 255, toChannel(linear[2]) * 255)
}

function bandAccent(hex: string, mode: "light" | "dark"): string {
  const [, a, b] = toOklab(hex)
  const chroma = Math.hypot(a, b)
  const band = ACCENT_BAND[mode]
  if (chroma < ACHROMATIC_BELOW_CHROMA) return oklchToHex(band.lightness, chroma, 0)
  return oklchToHex(band.lightness, band.chroma, ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360)
}

export function buildCustomPalette(accentHex: string): Palette {
  const [r, g, b] = parseHex(accentHex)
  const darkBase = rgbToHex(r * 0.16 + 5, g * 0.16 + 7, b * 0.16 + 10)
  const darkMid = rgbToHex(r * 0.32 + 8, g * 0.32 + 12, b * 0.32 + 16)
  const darkAccent = bandAccent(accentHex, "dark")

  const lightBase = rgbToHex(245 + r * 0.03, 246 + g * 0.03, 248 + b * 0.03)
  const lightMid = rgbToHex(232 + r * 0.07, 235 + g * 0.07, 240 + b * 0.07)
  const lightAccent = bandAccent(accentHex, "light")

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
  customCache = { hex, palette: buildCustomPalette(hex) }
  save({ ...current, palette: "custom" })
}

export function findPalette(id: string): Palette {
  if (id === "custom") return loadCustomPalette().palette
  return PALETTES.find(item => item.id === id) ?? PALETTES[0]
}


export interface Tint {
  neutral: boolean
  tint: DynamicShapeStyle
  onTint: DynamicShapeStyle
  selected: DynamicShapeStyle
  selectedRow: DynamicShapeStyle
  highlight: DynamicShapeStyle
  highlightBorder: DynamicShapeStyle
  rank: DynamicShapeStyle
  info: DynamicShapeStyle
}

type RGB = [number, number, number]

type Mode = "light" | "dark"

const TINT_SCAN: Record<Mode, { from: number; to: number }> = { dark: { from: 0.28, to: 0.96 }, light: { from: 0.88, to: 0.1 } }
const NEUTRAL_LIGHTNESS: Record<Mode, number> = { dark: 0.94, light: 0.16 }
const TINT_SATURATION = { min: 0.4, max: 0.65, neutral: 0.03 }
const NEUTRAL_BELOW_SATURATION = 0.15
const MIN_TINT_CONTRAST = 4.5
const TARGET_TINT_CONTRAST = 4.6
const LADDER_ALPHA = { selected: 0.22, selectedRow: 0.14, highlight: 0.15, highlightBorder: 0.75, rank: 0.15, info: 0.12 }

function linearize(value: number): number {
  const channel = value / 255
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
}

function luminance([r, g, b]: RGB): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

function contrastRatio(a: RGB, b: RGB): number {
  const high = Math.max(luminance(a), luminance(b))
  const low = Math.min(luminance(a), luminance(b))
  return (high + 0.05) / (low + 0.05)
}

function rgbToHsl([r, g, b]: RGB): { hue: number; saturation: number; lightness: number } {
  const [red, green, blue] = [r / 255, g / 255, b / 255]
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  const delta = max - min
  if (delta === 0) return { hue: 0, saturation: 0, lightness }
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  const raw = max === red ? (green - blue) / delta + (green < blue ? 6 : 0) : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4
  return { hue: raw * 60, saturation, lightness }
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const second = chroma * (1 - Math.abs(((h / 60) % 2) - 1))
  const base = lightness - chroma / 2
  const sextant = Math.floor(h / 60) % 6
  const offsets: [number, number, number][] = [
    [chroma, second, 0], [second, chroma, 0], [0, chroma, second],
    [0, second, chroma], [second, 0, chroma], [chroma, 0, second],
  ]
  const [r, g, b] = offsets[sextant]
  return rgbToHex((r + base) * 255, (g + base) * 255, (b + base) * 255)
}

function deriveModeHex(hue: number, saturation: number, mode: Mode, base: string, neutral: boolean): string {
  const backdrop = parseHex(base)
  if (neutral) return hslToHex(hue, saturation, NEUTRAL_LIGHTNESS[mode])

  const range = TINT_SCAN[mode]
  const step = mode === "dark" ? 0.01 : -0.01
  let lightness = range.from
  let hex = hslToHex(hue, saturation, lightness)
  while (contrastRatio(parseHex(hex), backdrop) < TARGET_TINT_CONTRAST && (mode === "dark" ? lightness < range.to : lightness > range.to)) {
    lightness += step
    hex = hslToHex(hue, saturation, lightness)
  }
  if (contrastRatio(parseHex(hex), backdrop) < MIN_TINT_CONTRAST) return mode === "dark" ? "#ffffff" : "#000000"
  return hex
}

function deriveOnTintHex(tintHex: string, hue: number): string {
  const tint = parseHex(tintHex)
  const ink = hslToHex(hue, 0.2, 0.06)
  const paper = hslToHex(hue, 0.05, 0.98)
  const preferInk = contrastRatio(parseHex(ink), tint) >= contrastRatio(parseHex(paper), tint)
  let hex = preferInk ? ink : paper
  let lightness = preferInk ? 0.06 : 0.98
  while (contrastRatio(parseHex(hex), tint) < MIN_TINT_CONTRAST && lightness > 0 && lightness < 1) {
    lightness += preferInk ? -0.02 : 0.02
    hex = hslToHex(hue, preferInk ? 0.2 : 0.05, lightness)
  }
  return hex
}

function tintAlpha(hex: string, alpha: number): Color {
  const [r, g, b] = parseHex(hex)
  return `rgba(${r},${g},${b},${alpha})` as Color
}

function asColor(hex: string): Color {
  return hex as Color
}

const tintCache = new Map<string, Tint>()

export function deriveTint(palette: Palette): Tint {
  const accent = String(palette.dark.accent)
  const key = `${palette.id}:${accent}`
  const cached = tintCache.get(key)
  if (cached) return cached

  const { hue, saturation } = rgbToHsl(parseHex(accent))
  const neutral = saturation < NEUTRAL_BELOW_SATURATION
  const chroma = neutral
    ? TINT_SATURATION.neutral
    : Math.min(TINT_SATURATION.max, Math.max(TINT_SATURATION.min, saturation))
  const lightHex = deriveModeHex(hue, chroma, "light", String(palette.light.base), neutral)
  const darkHex = deriveModeHex(hue, chroma, "dark", String(palette.dark.base), neutral)

  const ladder = (alpha: number): DynamicShapeStyle => ({ light: tintAlpha(lightHex, alpha), dark: tintAlpha(darkHex, alpha) })
  const tint: Tint = {
    neutral,
    tint: { light: asColor(lightHex), dark: asColor(darkHex) },
    onTint: { light: asColor(deriveOnTintHex(lightHex, hue)), dark: asColor(deriveOnTintHex(darkHex, hue)) },
    selected: ladder(LADDER_ALPHA.selected),
    selectedRow: ladder(LADDER_ALPHA.selectedRow),
    highlight: ladder(LADDER_ALPHA.highlight),
    highlightBorder: ladder(LADDER_ALPHA.highlightBorder),
    rank: ladder(LADDER_ALPHA.rank),
    info: ladder(LADDER_ALPHA.info),
  }
  tintCache.set(key, tint)
  return tint
}

export function currentTint(): Tint {
  return deriveTint(findPalette(themeChoice().palette))
}

let current: ThemeChoice = readStoredChoice()

const bus = createEmitter()

export function parseChoice(raw: unknown): ThemeChoice {
  if (typeof raw === "string") return LEGACY[raw] ?? DEFAULT_CHOICE
  if (raw && typeof raw === "object") {
    const { palette } = raw as Partial<ThemeChoice>
    const stored = (raw as Partial<ThemeChoice>).composition
    const composition = stored !== undefined ? RENAMED_COMPOSITIONS[stored] ?? stored : stored
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

export function reloadThemeFromStorage(): void {
  current = readStoredChoice()
  appearance = parseAppearance(kv.get(APPEARANCE_KEY))
  customCache = null
  bus.emit()
}

export function useThemeChoice(): ThemeChoice {
  useSubscription(subscribeTheme)
  return themeChoice()
}

export function useTint(): Tint {
  return deriveTint(findPalette(useThemeChoice().palette))
}


export type Appearance = "system" | "light" | "dark"

export const APPEARANCES: Appearance[] = ["system", "light", "dark"]

export function parseAppearance(raw: unknown): Appearance {
  return raw === "light" || raw === "dark" ? raw : "system"
}

let appearance: Appearance = parseAppearance(kv.get(APPEARANCE_KEY))

export function appearanceSetting(): Appearance {
  return appearance
}

export function setAppearance(next: Appearance): void {
  if (next === appearance) return
  appearance = next
  kv.set(APPEARANCE_KEY, next)
  bus.emit()
}

export function useAppearanceOverride(): Mode | undefined {
  useSubscription(subscribeTheme)
  return appearance === "system" ? undefined : appearance
}

export function ThemedNavigationStack({ children }: { children: JSX.Element }) {
  const scheme = useAppearanceOverride()
  return (
    <NavigationStack preferredColorScheme={scheme} environments={scheme ? { colorScheme: scheme } : undefined}>
      {children}
    </NavigationStack>
  )
}

export function useResolvedColorScheme(): Mode {
  const system = useColorScheme()
  useSubscription(subscribeTheme)
  return appearance === "system" ? system : appearance
}

const layerCache = new Map<string, DynamicShapeStyle[]>()

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

export function ThemeSwatch({ composition, palette }: { composition: string; palette: string }) {
  return <Rectangle fill={themeLayers({ composition, palette })[0]} allowsHitTesting={false} />
}

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
