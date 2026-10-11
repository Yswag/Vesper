// 設計庫的數值來源。頁面不該再寫 rgba(...)、cornerRadius: 14、#0A84FF 這種字面值 ——
// 要調樣式只改這裡，所有頁面跟著動。

import { type Color, type DynamicShapeStyle, type Shape, type VStackProps } from "scripting"

/** 跟 SwiftUI 堆疊一致：允許 null / boolean 這種「條件式不出現」的子節點。 */
export type StackChildren = VStackProps["children"]

/**
 * 卡片底：
 * 深色模式保留原本的微透光（rgba(255, 255, 255, 0.05)）；
 * 淺色模式改用純白底（#FFFFFF）搭配自然陰影，確保輪廓立體清晰。
 */
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

/**
 * 半透明的容器底：選中／次要／更輕，三種強度就夠。
 *
 * 藍色這一組（selected／selectedRow／highlight／highlightBorder／rank）是同一條透明度階梯，
 * 要改品牌藍或調強度只改這幾行 —— 不要在各頁寫 rgba(10, 132, 255, ...)。
 */
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

/**
 * 陰影階層。iOS 的深度與層次感來自微妙的陰影 —— 不是強烈的黑影，
 * 而是幾乎看不見、但缺了就會覺得「扁平」的那種。
 * 
 * 深色模式策略：使用淺色光暈（glow）而不是深色陰影，讓卡片「發光浮起」。
 */
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

/**
 * 圓角階層。同一個角色就用同一個值 —— 不要就地寫數字，
 * 否則「卡片 14、大封面 12、縮圖 10」這種差異會慢慢失守。
 */
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

/**
 * 一列的內距。**全 App 只有這兩種**：
 * - rowPadding：列表、設定、可點的一般列。
 * - denseRowPadding：日誌這種高密度診斷輸出（一眼要看很多筆）。
 * 不要再就地寫其他數字 —— 同一種列在不同頁高度不一樣，一眼就看得出來。
 */
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

/**
 * 短標籤（tag）與可點 chip 的內距。
 * tag＝海報/卡片裡的資訊標籤（caption 字級）；chip＝可以選的分區那種。
 * badge＝比 tag 更小一號的資訊帆（評分、Top N、章節數）。
 */
export const tagPadding = { horizontal: 10, vertical: 5 } as const
export const chipPadding = { horizontal: 16, vertical: 8 } as const
export const badgePadding = { horizontal: 8, vertical: 4 } as const

/** 輸入框（TextField）自己的內距：比 chip 窄一點，文字才不會離游標太遠。 */
export const fieldPadding = { horizontal: 12, vertical: 8 } as const

/** 橫向 chip 列的容器內距（分區切換那條）。 */
export const chipRowPadding = { horizontal: 16, vertical: 8 } as const
