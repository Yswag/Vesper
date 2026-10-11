// 封面與橫向卡片卡片的尺寸：一律依「容器實際給的可用寬度」算，不看 `Device.screen.width`
// （規範 docs/ui-ux-liquid-glass.md §5.4／§5.5：螢幕寬推不出側欄／sheet／split 裡的尺寸）。
//
// 原本只有詳情頁 hero（`comicHeroMetrics.ts`），現在把首頁／Bangumi 詳情／探索的橫向卡片
// 也收進來 —— 推算只寫在這裡，各頁只負責量自己的容器寬度（`components/WidthReporter.tsx`）。

// ---- 詳情頁 hero（頂部海報）----

/** 封面高／寬比。 */
export const HERO_ASPECT = 1.44
/** 封面寬上限：容器再寬也不跟著放大。 */
export const HERO_MAX_WIDTH = 124
/** 封面約占容器可用寬度的比例。 */
export const HERO_WIDTH_RATIO = 1 / 3

/**
 * 容器可用寬度 → 封面寬。
 * 還沒量到寬度（0）時直接給上限：第一版排版不要先縮成 0 再跳大。
 *
 * 舊寫法是 `Math.min(124, Math.floor(screen.width * 0.32))`。那個 0.32 是對「螢幕」的比例，
 * 而 hero 拿到的是扣掉頁面內距（`pageInsets.horizontal` × 2）之後的寬度 —— 換算成容器
 * 約是三分之一，所以在 402pt 的手機上是 123pt（改動前 124pt），視覺不變。
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
 * 依容器寬度算卡片尺寸。
 * `ratio`＝卡片寬占容器可用寬的比例；`maxWidth`＝封頂（也是量不到寬度時的退路）。
 * 容器量到 0（預覽裡的 ScrollView 有時不會自己撐開）時退回上限，不要讓畫面出現 0 寬的卡。
 */
export function cardSize(containerWidth: number, ratio: number, maxWidth: number, aspect = CARD_ASPECT): CardSize {
  const width = containerWidth > 0 ? Math.min(maxWidth, Math.floor(containerWidth * ratio)) : maxWidth
  return { width, height: Math.round(width * aspect) }
}

// 下列各卡片的比例都以「402pt 手機量到的容器寬」對回舊值，視覺大小不變：
// 舊公式是 `min(上限, floor(Device.screen.width * 舊比例))`。

/** 首頁「繼續閱讀」卡片：402pt 容器 → 144pt（舊值 144）。 */
export const resumeCardSize = (containerWidth: number): CardSize => cardSize(containerWidth, 0.36, 148)

/** 首頁 Bangumi 推薦卡片：402pt 容器 → 112pt（舊值 112）。 */
export const bangumiCardSize = (containerWidth: number): CardSize => cardSize(containerWidth, 0.28, 116)

/**
 * Bangumi 詳情「可用漫畫來源」卡片：402pt 手機上量到的容器是 370pt（頁面內距扣完），
 * 取 116 / 370 ≈ 0.315 → 116pt（舊值 116）。
 */
export const bangumiSourceCardSize = (containerWidth: number): CardSize => cardSize(containerWidth, 0.315, 120)

/** 探索頁海報卡片（1:1.48）：402pt 容器 → 102pt（舊值 102）。 */
export const exploreCardSize = (containerWidth: number): CardSize => cardSize(containerWidth, 0.26, 102, 1.48)

/** 詳情頁「相關推薦」卡片：緊湊型海報，402pt 容器 → 94pt，一屏可視約 3.5 部作品。 */
export const recommendCardSize = (containerWidth: number): CardSize => cardSize(containerWidth, 0.24, 96, 1.44)
