// 星等的顯示：源給的 0–5 分數（`stars`）→ 五顆星（整顆，四捨五入）與兩位小數的分數。
// 純顯示，不碰源；原本住在 sources/operations.ts，會讓畫面為了它反向依賴源那一層。

/** 源給的分數：0–5 的數字；不是可辨識的數字就當源沒給。 */
function normalizeStars(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 5) return undefined
  return raw
}

/** 分數不存在或無法辨識就回 null —— 那一行整個不出現。 */
export function formatStars(raw: unknown): { glyphs: string; score: string } | null {
  const value = normalizeStars(raw)
  if (value === undefined) return null
  const filled = Math.round(value)
  return { glyphs: "★".repeat(filled) + "☆".repeat(5 - filled), score: value.toFixed(2) }
}
