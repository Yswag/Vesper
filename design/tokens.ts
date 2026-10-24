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
/** 徽章的停用底：深色淡白、淺色淡黑（淺色底上白 12% 幾乎看不見；黑 8% 也還是融在白卡上）。 */
export const badgeOff: DynamicShapeStyle = {
  dark: "rgba(255, 255, 255, 0.12)",
  light: "rgba(0, 0, 0, 0.12)",
}

/** 語意色。頁面用名字，不寫 hex；互動色一律用 `useTint()`（跟主題），不在這裡。 */
export const palette = {
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
 * 頁面上的資訊標籤（`design/Tag`）的有色底：一色一個意思，頁面不寫 rgba。
 * 中性標籤用 `fill.tag`，不需要這裡的底色。
 */
export const tagTone = {
  /** 危險／分級 NSFW。 */
  danger: "rgba(255, 69, 58, 0.12)",
  /** 提醒／分級建議／評分。 */
  warning: "rgba(255, 149, 0, 0.15)",
  /** 喜愛數。 */
  love: "rgba(255, 45, 85, 0.12)",
} as const

/**
 * 語意文字色：深色用 `palette`，淺色用系統「增強對比」那一階（亮橘、亮紅壓在淺底上讀不到）。
 * 只給「字」用；圖示色塊（`IconBadge` 的底）仍用 `palette`。
 */
export const toneText: Record<"danger" | "warning" | "love" | "success", DynamicShapeStyle> = {
  danger: { dark: palette.red, light: "#D70015" },
  warning: { dark: palette.orange, light: "#C93400" },
  love: { dark: palette.pink, light: "#D30F45" },
  success: { dark: palette.green, light: "#248A3D" },
}

/** `toneText` 的舊名（3b／3c 的呼叫端）；新程式碼用 `toneText`。 */
export const tagText = toneText

/**
 * 多選／三態篩選的膠囊色：包含＝語意綠、排除＝danger、未選用中性的 `fill.tag`。
 * 標籤的 `tagTone` 只表達「這東西是什麼狀態」，篩選是使用者的選擇，所以字色淺色也再深一階。
 */
export const filterTone: Record<"included" | "excluded", { background: Color; text: DynamicShapeStyle }> = {
  included: { background: "rgba(48, 209, 88, 0.15)", text: toneText.success },
  excluded: { background: tagTone.danger, text: toneText.danger },
}

/** 容器與狀態填色（非互動的部分）。互動色（選中底、描邊、榜單）在 `useTint()` 的 `Tint` 裡。 */
export const fill = {
  /** 次要容器（標籤、輸入框底）。 */
  chip: "secondarySystemFill",
  /** 更輕的容器（非互動的標籤）。 */
  tag: "quaternarySystemFill",
  /** 圖片載入中／沒有圖的底。 */
  surface: "secondarySystemBackground",
  /** 評分徽章底（跟資訊標籤的 warning 同一個顏色）。 */
  score: tagTone.warning,
  /** 長簡介收合時末端的淡出點（跟 `secondaryLabel` 接成漸層）。 */
  fade: "rgba(142, 142, 147, 0.05)",
  /** 閱讀器 HUD 的輕遮罩。 */
  scrimSoft: "rgba(0, 0, 0, 0.18)",
  /** 封面上的「開啟中」遮罩（蓋住封面、中間放轉圈）。 */
  coverScrim: "rgba(0, 0, 0, 0.45)",
  /** 中性玻璃底（分頁指示點的靜態圓點）：極輕灰，只留一點折射霧感。 */
  glassNeutral: "rgba(128, 128, 128, 0.12)",
  /** 幾近透明但可命中測試的點擊層。 */
  invisible: "rgba(0, 0, 0, 0.001)",
  /** 閱讀器畫布：純黑。 */
  canvas: "#000000",
} as const

/**
 * 對話框（`app/CustomDialogOverlay`）的表面：遮罩、卡片漸層與描邊、膠囊按鈕、輸入框。
 * 卡片是半透明的，所以不加陰影（分離感靠遮罩），也不要再去別的地方寫 rgba。
 */
export const dialog: Record<
  "scrim" | "card" | "cardBorder" | "button" | "buttonBorder" | "field" | "fieldBorder" | "inset" | "insetBorder",
  DynamicShapeStyle
> = {
  /** 卡片後面的遮罩。深色比淺色重，淺色頁面才不會灰掉。 */
  scrim: {
    dark: "rgba(0, 0, 0, 0.42)",
    light: "rgba(0, 0, 0, 0.28)",
  },
  /** 卡片本體：上亮下暗。 */
  card: {
    dark: { colors: ["rgba(42, 42, 46, 0.72)", "rgba(24, 24, 26, 0.78)"], startPoint: "top", endPoint: "bottom" },
    light: { colors: ["rgba(255, 255, 255, 0.78)", "rgba(242, 242, 247, 0.84)"], startPoint: "top", endPoint: "bottom" },
  },
  /** 卡片 1px 描邊（上緣高光、下緣收暗）。 */
  cardBorder: {
    dark: { colors: ["rgba(255, 255, 255, 0.28)", "rgba(255, 255, 255, 0.08)"], startPoint: "top", endPoint: "bottom" },
    light: { colors: ["rgba(255, 255, 255, 0.85)", "rgba(0, 0, 0, 0.08)"], startPoint: "top", endPoint: "bottom" },
  },
  /** 非預設的膠囊按鈕（取消、破壞性）。 */
  button: {
    dark: "rgba(255, 255, 255, 0.16)",
    light: "rgba(0, 0, 0, 0.06)",
  },
  buttonBorder: {
    dark: "rgba(255, 255, 255, 0.08)",
    light: "rgba(0, 0, 0, 0.04)",
  },
  /** 輸入框底。 */
  field: {
    dark: "rgba(0, 0, 0, 0.35)",
    light: "rgba(0, 0, 0, 0.05)",
  },
  fieldBorder: {
    dark: "rgba(255, 255, 255, 0.12)",
    light: "rgba(0, 0, 0, 0.10)",
  },
  /** 輸入框裡夾的圖片（驗證碼）底框。 */
  inset: {
    dark: "rgba(0, 0, 0, 0.25)",
    light: "rgba(0, 0, 0, 0.04)",
  },
  insetBorder: {
    dark: "rgba(255, 255, 255, 0.08)",
    light: "rgba(0, 0, 0, 0.08)",
  },
}

/** 卡片外層 1px 描邊：深色模式 8% 白線，淺色模式 65% 高光白邊（定義亞克力卡片邊緣）。 */
export const hairlineStroke: { shapeStyle: DynamicShapeStyle; strokeStyle: { lineWidth: number } } = {
  shapeStyle: {
    dark: "rgba(255, 255, 255, 0.08)",
    light: "rgba(255, 255, 255, 0.65)",
  },
  strokeStyle: { lineWidth: 1 },
}

/** 封面投影。封面是不透明圖片，影子壓在任何底色上都是黑影，所以不屬於「卡片不加陰影」那條。 */
export const coverShadow: { color: Color; radius: number; x: number; y: number } = {
  color: "rgba(0, 0, 0, 0.35)",
  radius: 6,
  x: 0,
  y: 3,
}

/** 漫畫封面 1px 微描邊：深色模式 8% 白線防融黑，淺色模式 6% 極淡暗線防白封面融白。 */
export const coverStroke: { shapeStyle: DynamicShapeStyle; strokeStyle: { lineWidth: number } } = {
  shapeStyle: {
    dark: "rgba(255, 255, 255, 0.08)",
    light: "rgba(0, 0, 0, 0.06)",
  },
  strokeStyle: { lineWidth: 0.5 },
}

/** 圓角四級，同心：內層＝外層－內距。 */
export const radius = {
  /** 6：短標籤、圖示徽章、圖片上的角標。 */
  sm: 6,
  /** 10：chip、縮圖、封面。 */
  md: 10,
  /** 18：卡片、懸浮小卡。 */
  lg: 18,
  /** 26：sheet、HUD 面板、對話框。 */
  xl: 26,
} as const

/** 由半徑做圓角矩形。 */
export function rect(cornerRadius: number): Shape {
  return { type: "rect", cornerRadius }
}

/** 膠囊（預設連續曲率）。 */
export function capsule(style: "circular" | "continuous" = "continuous"): Shape {
  return { type: "capsule", style }
}

export const cardShape: Shape = rect(radius.lg)
export const badgeShape: Shape = rect(radius.sm)

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
/** 緊湊版 chip（章節工具列）：同一行要擠下排序、選取、下載與標題，所以左右再收窄。 */
export const chipCompactPadding = { horizontal: 8, vertical: 5 } as const
export const badgePadding = { horizontal: 8, vertical: 4 } as const

/** 輸入框（TextField）自己的內距：比 chip 窄一點，文字才不會離游標太遠。 */
export const fieldPadding = { horizontal: 12, vertical: 8 } as const

/** 橫向 chip 列的容器內距（分區切換那條）。 */
export const chipRowPadding = { horizontal: 16, vertical: 8 } as const
