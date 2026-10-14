// 封面與橫向卡片尺寸計算：依容器實際可用寬度動態推算，不依賴 Device.screen 寬度。
// 容器寬度量測由各頁面的 WidthReporter 負責提供。

// ---- 詳情頁 hero（頂部海報）----

/** 封面高／寬比。 */
export const HERO_ASPECT = 1.44
/** 封面寬上限：容器再寬也不跟著放大。 */
export const HERO_MAX_WIDTH = 124
/** 封面約占容器可用寬度的比例。 */
export const HERO_WIDTH_RATIO = 1 / 3

/**
 * 依據容器可用寬度推算詳情頁封面寬度（未量測時退回上限預設值）。
 */
export function heroCoverWidth(containerWidth: number): number {
  if (!(containerWidth > 0)) return HERO_MAX_WIDTH
  return Math.min(HERO_MAX_WIDTH, Math.floor(containerWidth * HERO_WIDTH_RATIO))
}

export function heroCoverSize(containerWidth: number): CardSize {
  const width = heroCoverWidth(containerWidth)
  return { width, height: Math.round(width * HERO_ASPECT) }
}

// ---- 橫向 carousel 卡片 ----

/** 海報卡片預設的高／寬比（首頁／Bangumi 卡）。 */
export const CARD_ASPECT = 1.44

export interface CardSize {
  width: number
  height: number
}

/**
 * 依容器寬度計算卡片尺寸（未量測到寬度時退回上限）。
 */
export function cardSize(containerWidth: number, ratio: number, maxWidth: number, aspect = CARD_ASPECT): CardSize {
  const width = containerWidth > 0 ? Math.min(maxWidth, Math.floor(containerWidth * ratio)) : maxWidth
  return { width, height: Math.round(width * aspect) }
}

/** 首頁「繼續閱讀」卡片。 */
export const resumeCardSize = (containerWidth: number): CardSize => cardSize(containerWidth, 0.36, 148)

/** 首頁 Bangumi 推薦卡片。 */
export const bangumiCardSize = (containerWidth: number): CardSize => cardSize(containerWidth, 0.28, 116)

/** Bangumi 詳情「可用漫畫來源」卡片。 */
export const bangumiSourceCardSize = (containerWidth: number): CardSize => cardSize(containerWidth, 0.315, 120)

/** 探索頁海報卡片（1:1.48）。 */
export const exploreCardSize = (containerWidth: number): CardSize => cardSize(containerWidth, 0.26, 102, 1.48)

/** 詳情頁「相關推薦」卡片。 */
export const recommendCardSize = (containerWidth: number): CardSize => cardSize(containerWidth, 0.24, 96, 1.44)
