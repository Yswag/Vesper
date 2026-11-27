import { type Color, type DynamicShapeStyle, type Shape, type VStackProps } from "scripting"

export type StackChildren = VStackProps["children"]

export const cardBackground: DynamicShapeStyle = {
  dark: "rgba(255, 255, 255, 0.05)",
  light: "rgba(255, 255, 255, 0.20)",
}

export const cardBackgroundStrong: DynamicShapeStyle = {
  dark: "rgba(255, 255, 255, 0.09)",
  light: "rgba(255, 255, 255, 0.35)",
}

export const cardBackgroundSubtle: DynamicShapeStyle = {
  dark: "rgba(255, 255, 255, 0.03)",
  light: "rgba(255, 255, 255, 0.10)",
}
export const dangerBackground: Color = "rgba(255, 69, 58, 0.12)"
export const dangerBadge: Color = "rgba(255, 69, 58, 0.18)"
export const badgeOff: DynamicShapeStyle = {
  dark: "rgba(255, 255, 255, 0.12)",
  light: "rgba(0, 0, 0, 0.12)",
}

export const palette = {
  indigo: "#5E5CE6",
  green: "#30D158",
  orange: "#FF9F0A",
  purple: "#BF5AF2",
  pink: "#FF2D55",
  red: "#FF453A",
} as const

export const neutral = {
  secondary: "#8e8e93",
  tertiary: "#636366",
} as const

export const tagTone = {
  danger: "rgba(255, 69, 58, 0.12)",
  warning: "rgba(255, 149, 0, 0.15)",
  love: "rgba(255, 45, 85, 0.12)",
} as const

export const toneText: Record<"danger" | "warning" | "love" | "success", DynamicShapeStyle> = {
  danger: { dark: palette.red, light: "#D70015" },
  warning: { dark: palette.orange, light: "#C93400" },
  love: { dark: palette.pink, light: "#D30F45" },
  success: { dark: palette.green, light: "#248A3D" },
}

export const tagText = toneText

export const filterTone: Record<"included" | "excluded", { background: Color; text: DynamicShapeStyle }> = {
  included: { background: "rgba(48, 209, 88, 0.15)", text: toneText.success },
  excluded: { background: tagTone.danger, text: toneText.danger },
}

export const fill = {
  chip: "secondarySystemFill",
  tag: "quaternarySystemFill",
  surface: "secondarySystemBackground",
  score: tagTone.warning,
  fade: "rgba(142, 142, 147, 0.05)",
  scrimSoft: "rgba(0, 0, 0, 0.18)",
  coverScrim: "rgba(0, 0, 0, 0.45)",
  glassNeutral: "rgba(128, 128, 128, 0.12)",
  invisible: "rgba(0, 0, 0, 0.001)",
  canvas: "#000000",
} as const

export const dialog: Record<
  "scrim" | "card" | "cardBorder" | "button" | "buttonBorder" | "field" | "fieldBorder" | "inset" | "insetBorder",
  DynamicShapeStyle
> = {
  scrim: {
    dark: "rgba(0, 0, 0, 0.42)",
    light: "rgba(0, 0, 0, 0.28)",
  },
  card: {
    dark: { colors: ["rgba(42, 42, 46, 0.72)", "rgba(24, 24, 26, 0.78)"], startPoint: "top", endPoint: "bottom" },
    light: { colors: ["rgba(255, 255, 255, 0.78)", "rgba(242, 242, 247, 0.84)"], startPoint: "top", endPoint: "bottom" },
  },
  cardBorder: {
    dark: { colors: ["rgba(255, 255, 255, 0.28)", "rgba(255, 255, 255, 0.08)"], startPoint: "top", endPoint: "bottom" },
    light: { colors: ["rgba(255, 255, 255, 0.85)", "rgba(0, 0, 0, 0.08)"], startPoint: "top", endPoint: "bottom" },
  },
  button: {
    dark: "rgba(255, 255, 255, 0.16)",
    light: "rgba(0, 0, 0, 0.06)",
  },
  buttonBorder: {
    dark: "rgba(255, 255, 255, 0.08)",
    light: "rgba(0, 0, 0, 0.04)",
  },
  field: {
    dark: "rgba(0, 0, 0, 0.35)",
    light: "rgba(0, 0, 0, 0.05)",
  },
  fieldBorder: {
    dark: "rgba(255, 255, 255, 0.12)",
    light: "rgba(0, 0, 0, 0.10)",
  },
  inset: {
    dark: "rgba(0, 0, 0, 0.25)",
    light: "rgba(0, 0, 0, 0.04)",
  },
  insetBorder: {
    dark: "rgba(255, 255, 255, 0.08)",
    light: "rgba(0, 0, 0, 0.08)",
  },
}

export const hairlineStroke: { shapeStyle: DynamicShapeStyle; strokeStyle: { lineWidth: number } } = {
  shapeStyle: {
    dark: "rgba(255, 255, 255, 0.08)",
    light: "rgba(255, 255, 255, 0.65)",
  },
  strokeStyle: { lineWidth: 1 },
}

export const dotStroke: { shapeStyle: DynamicShapeStyle; strokeStyle: { lineWidth: number } } = {
  shapeStyle: {
    dark: "rgba(255, 255, 255, 0.20)",
    light: "rgba(0, 0, 0, 0.12)",
  },
  strokeStyle: { lineWidth: 1 },
}

export const coverShadowKey: { color: Color; radius: number; x: number; y: number } = {
  color: "rgba(0, 0, 0, 0.20)",
  radius: 2,
  x: 0,
  y: 3,
}

export const coverShadowPenumbra: { color: Color; radius: number; x: number; y: number } = {
  color: "rgba(0, 0, 0, 0.14)",
  radius: 2,
  x: 0,
  y: 2,
}

export const coverShadowAmbient: { color: Color; radius: number; x: number; y: number } = {
  color: "rgba(0, 0, 0, 0.12)",
  radius: 5,
  x: 0,
  y: 2,
}

export const coverStroke: { shapeStyle: DynamicShapeStyle; strokeStyle: { lineWidth: number } } = {
  shapeStyle: {
    dark: "rgba(255, 255, 255, 0.08)",
    light: "rgba(0, 0, 0, 0.06)",
  },
  strokeStyle: { lineWidth: 0.5 },
}

export const radius = {
  sm: 6,
  md: 10,
  lg: 18,
  xl: 26,
} as const

export function rect(cornerRadius: number): Shape {
  return { type: "rect", cornerRadius }
}

export function capsule(style: "circular" | "continuous" = "continuous"): Shape {
  return { type: "capsule", style }
}

export const cardShape: Shape = rect(radius.lg)
export const badgeShape: Shape = rect(radius.sm)

export const badgeSize = 30

export const avatarSize = 36

export const sourceIconSize = 32

export const rowPadding = { horizontal: 16, vertical: 14 } as const
export const denseRowPadding = { horizontal: 16, vertical: 10 } as const

export const pageInsets = { horizontal: 16, top: 14, bottom: 44 } as const
export const pageSpacing = 22

export const sectionSpacing = 36

export const heroSpacing = 20

export const cardGap = 8

export const tagPadding = { horizontal: 10, vertical: 5 } as const
export const chipPadding = { horizontal: 16, vertical: 8 } as const
export const chipCompactPadding = { horizontal: 8, vertical: 5 } as const
export const badgePadding = { horizontal: 8, vertical: 4 } as const

export const fieldPadding = { horizontal: 12, vertical: 8 } as const

export const chipRowPadding = { horizontal: 16, vertical: 8 } as const
