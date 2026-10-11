export const H_PADDING = 12
export const H_SPACING = 9
export const V_SPACING = 16
/** Cover height / width. */
export const ASPECT = 1.45

const MIN_CELL_WIDTH = 110
const MIN_COLUMNS = 1
const MAX_COLUMNS = 6

export interface ComicGridMetrics {
  columns: number
  cellWidth: number
  cellHeight: number
}

/** Derive a stable grid from the width offered by the immediate parent. */
export function comicGridMetrics(containerWidth: number): ComicGridMetrics {
  const width = Math.max(0, containerWidth)
  const availableWidth = Math.max(0, width - H_PADDING * 2)
  const columns = Math.min(
    MAX_COLUMNS,
    Math.max(MIN_COLUMNS, Math.floor((availableWidth + H_SPACING) / (MIN_CELL_WIDTH + H_SPACING)))
  )
  const cellWidth = Math.max(0, Math.floor((availableWidth - H_SPACING * (columns - 1)) / columns))

  return {
    columns,
    cellWidth,
    cellHeight: Math.round(cellWidth * ASPECT),
  }
}
