// 設計庫的數值來源（色彩、陰影、圓角、間距與內距規格）。

import { type Color, type DynamicShapeStyle, type Shape, type VStackProps } from "scripting"

/** 跟 SwiftUI 堆疊一致：允許 null / boolean 這種「條件式不出現」的子節點。 */
export type StackChildren = VStackProps["children"]

/** 卡片底色（深色模式微透光，淺色模式半透明白）。 */
export const cardBackground: DynamicShapeStyle = {
  dark: "rgba(255, 255, 255, 0.05)",
  light: "rgba(255, 255, 255, 0.20)",
}

/** 卡片裡的再一層（可選取的小方塊、次要容器）。 */
export const cardBackgroundStrong: DynamicShapeStyle = {
  dark: "rgba(255, 255, 255, 0.09)",
  light: "rgba(255, 255, 255, 0.35)",
}

/** 空狀態的底：比卡片更淡，空頁才不會看起來很重。 */
export const cardBackgroundSubtle: DynamicShapeStyle = {
  dark: "rgba(255, 255, 255, 0.03)",
  light: "rgba(255, 255, 255, 0.10)",
}
/** 錯誤 / 危險橫幅的底。 */
export const dangerBackground: Color = "rgba(255, 69, 58, 0.12)"
/** 錯誤狀態的小徽章底（比橫幅重一點，縮到 36pt 還看得出來）。 */
export const dangerBadge: Color = "rgba(255, 69, 58, 0.18)"
/** 徽章的停用底。 */
export const badgeOff: Color = "rgba(255, 255, 255, 0.12)"

/** 語意色。頁面用名字，不寫 hex。 */
export const palette = {
  blue: "#0A84FF",
  indigo: "#5E5CE6",
  green: "#30D158",
  orange: "#FF9F0A",
  purple: "#BF5AF2",
  pink: "#FF2D55",
  red: "#FF453A",
} as const

/** 中性色。畫布與 HUD 需要「比 label 輕」的文字，用這兩個。 */
export const neutral = {
  secondary: "#8e8e93",
  tertiary: "#636366",
} as const

/** 容器與狀態填色（藍色系為透明度遞增階梯）。 */
export const fill = {
  /** 可選取項目的底（chip、膠囊）。 */
  selected: "rgba(10, 132, 255, 0.22)",
  /** 選中的整列 —— 面積大，所以比 chip 輕。 */
  selectedRow: "rgba(10, 132, 255, 0.14)",
  /** 選中的項目（閱讀器目錄列）。 */
  highlight: "rgba(10, 132, 255, 0.15)",
  /** 選中項目的描邊。 */
  highlightBorder: "rgba(10, 132, 255, 0.75)",
  /** 榜單徽章底（藍）。 */
  rank: "rgba(10, 132, 255, 0.15)",
  /** 次要容器（標籤、輸入框底）。 */
  chip: "secondarySystemFill",
  /** 更輕的容器（非互動的標籤）。 */
  tag: "quaternarySystemFill",
  /** 圖片載入中／沒有圖的底。 */
  surface: "secondarySystemBackground",
  /** 封面 1px 描邊。 */
  border: "rgba(255, 255, 255, 0.16)",
  /** 評分徽章底（橘）。 */
  score: "rgba(255, 149, 0, 0.15)",
  /** 彈窗後面的遮罩。 */
  scrim: "rgba(0, 0, 0, 0.42)",
  /** 閱讀器 HUD 的輕遮罩。 */
  scrimSoft: "rgba(0, 0, 0, 0.18)",
  /** 幾近透明但可命中測試的點擊層。 */
  invisible: "rgba(0, 0, 0, 0.001)",
  /** 閱讀器畫布：純黑。 */
  canvas: "#000000",
} as const

/** 卡片外層 1px 描邊：深色模式 8% 白線，淺色模式 65% 高光白邊（定義亞克力卡片邊緣）。 */
export const hairlineStroke: { shapeStyle: DynamicShapeStyle; strokeStyle: { lineWidth: number } } = {
  shapeStyle: {
    dark: "rgba(255, 255, 255, 0.08)",
    light: "rgba(255, 255, 255, 0.65)",
  },
  strokeStyle: { lineWidth: 1 },
}

/** 漫畫封面 1px 微描邊：深色模式 8% 白線防融黑，淺色模式 6% 極淡暗線防白封面融白。 */
export const coverStroke: { shapeStyle: DynamicShapeStyle; strokeStyle: { lineWidth: number } } = {
  shapeStyle: {
    dark: "rgba(255, 255, 255, 0.08)",
    light: "rgba(0, 0, 0, 0.06)",
  },
  strokeStyle: { lineWidth: 0.5 },
}

/** 陰影階層（深色模式採用淺色光暈）。 */
export const shadow = {
  /** 卡片與內容卡的標準陰影（輕量、接近表面）。深色模式用淺色光暈。 */
  card: {
    color: "rgba(255, 255, 255, 0.06)",
    radius: 16,
    x: 0,
    y: 0,
  },
  /** 浮動元素（HUD、彈窗、sheet）的陰影（中等、明顯懸浮）。 */
  elevated: {
    color: "rgba(255, 255, 255, 0.10)",
    radius: 28,
    x: 0,
    y: 0,
  },
  /** 深度最強的陰影（警告彈窗、modal）。 */
  modal: {
    color: "rgba(255, 255, 255, 0.14)",
    radius: 40,
    x: 0,
    y: 0,
  },
} as const

/** 圓角規格階層。 */
export const radius = {
  /** 一行小標籤（「上次讀到」）。 */
  pill: 4,
  /** 短標籤（GlassBadge）。 */
  tag: 6,
  /** 30×30 圖示徽章。 */
  icon: 7,
  /** chip、小縮圖、側欄列。 */
  chip: 8,
  /** 網格封面、章節列縮圖。 */
  thumb: 10,
  /** 大封面、hero 區塊。 */
  cover: 12,
  /** 卡片。 */
  card: 18,
  /** 彈窗、sheet 這種大面積浮層。 */
  sheet: 24,
  /** HUD 面板、底部工具列。 */
  panel: 20,
  /** 懸浮小卡（閱讀設定）。 */
  popover: 18,
} as const

/** 由半徑做圓角矩形。 */
export function rect(cornerRadius: number): Shape {
  return { type: "rect", cornerRadius }
}

/** 膠囊（預設連續曲率）。 */
export function capsule(style: "circular" | "continuous" = "continuous"): Shape {
  return { type: "capsule", style }
}

export const cardShape: Shape = rect(radius.card)
export const badgeShape: Shape = rect(radius.icon)

/** 圖示徽章邊長。列的高度、分隔線縮排都由它推導。 */
export const badgeSize = 30

/** 圓形首字頭像（源沒有封面時的身分標誌）—— 比 IconBadge 大一級。 */
export const avatarSize = 36

/** 漫畫源圖標邊長（iOS 圓角方塊 App Icon 風格）。 */
export const sourceIconSize = 32

/** 列表列內距（rowPadding 一般列；denseRowPadding 高密度列）。 */
export const rowPadding = { horizontal: 16, vertical: 14 } as const
export const denseRowPadding = { horizontal: 16, vertical: 10 } as const

/** 頁面內容的邊界與區塊間距（PageScroll 與自刻版面的頁面共用）。 */
export const pageInsets = { horizontal: 16, top: 14, bottom: 44 } as const
export const pageSpacing = 22

/** 主要區塊之間的間距（首頁、詳情頁的大區塊）。 */
export const sectionSpacing = 36

/** Hero 區塊內部元素的間距（封面與資訊之間）。 */
export const heroSpacing = 20

/** 一疊同類卡片之間的間隔（CardGroup 內部與各頁的卡片流）。 */
export const cardGap = 8

/** 短標籤、chip 與徽章內距。 */
export const tagPadding = { horizontal: 10, vertical: 5 } as const
export const chipPadding = { horizontal: 16, vertical: 8 } as const
export const badgePadding = { horizontal: 8, vertical: 4 } as const

/** 輸入框（TextField）自己的內距：比 chip 窄一點，文字才不會離游標太遠。 */
export const fieldPadding = { horizontal: 12, vertical: 8 } as const

/** 橫向 chip 列的容器內距（分區切換那條）。 */
export const chipRowPadding = { horizontal: 16, vertical: 8 } as const
