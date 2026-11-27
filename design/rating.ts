function normalizeStars(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 5) return undefined
  return raw
}

export function formatStars(raw: unknown): { glyphs: string; score: string } | null {
  const value = normalizeStars(raw)
  if (value === undefined) return null
  const filled = Math.round(value)
  return { glyphs: "★".repeat(filled) + "☆".repeat(5 - filled), score: value.toFixed(2) }
}
