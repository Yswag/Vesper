export const HERO_ASPECT = 1.44
export const HERO_MAX_WIDTH = 124
export const HERO_WIDTH_RATIO = 1 / 3

export function heroCoverWidth(containerWidth: number): number {
  if (!(containerWidth > 0)) return HERO_MAX_WIDTH
  return Math.min(HERO_MAX_WIDTH, Math.floor(containerWidth * HERO_WIDTH_RATIO))
}

export function heroCoverSize(containerWidth: number): CardSize {
  const width = heroCoverWidth(containerWidth)
  return { width, height: Math.round(width * HERO_ASPECT) }
}


export const CARD_ASPECT = 1.44

export interface CardSize {
  width: number
  height: number
}

export function cardSize(containerWidth: number, ratio: number, maxWidth: number, aspect = CARD_ASPECT): CardSize {
  const width = containerWidth > 0 ? Math.min(maxWidth, Math.floor(containerWidth * ratio)) : maxWidth
  return { width, height: Math.round(width * aspect) }
}

export const resumeCardSize = (containerWidth: number): CardSize => cardSize(containerWidth, 0.36, 148)

export const bangumiCardSize = (containerWidth: number): CardSize => cardSize(containerWidth, 0.28, 116)

export const bangumiSourceCardSize = (containerWidth: number): CardSize => cardSize(containerWidth, 0.315, 120)

export const exploreCardSize = (containerWidth: number): CardSize => cardSize(containerWidth, 0.26, 102, 1.48)

export const recommendCardSize = (containerWidth: number): CardSize => cardSize(containerWidth, 0.24, 96, 1.44)
