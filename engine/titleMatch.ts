export function normalizeTitle(title: string): string {
  if (!title) return ""
  return title
    .toLowerCase()
    .replace(/[\[\(\{\<【〔（［《〈][^\]\)\}\>】〕）］》〉]*[\]\)\}\>】〕）］》〉]/g, "")
    .replace(/[\s\p{P}\p{S}～〜·・_—\-\+]+/gu, "")
    .trim()
}

function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) {
    return a === b || a.includes(b) || b.includes(a) ? 0.8 : 0
  }

  const getBigrams = (str: string) => {
    const s = new Set<string>()
    for (let i = 0; i < str.length - 1; i++) {
      s.add(str.slice(i, i + 2))
    }
    return s
  }

  const bgA = getBigrams(a)
  const bgB = getBigrams(b)

  let intersection = 0
  for (const bg of bgA) {
    if (bgB.has(bg)) intersection++
  }

  return (2 * intersection) / (bgA.size + bgB.size)
}

export function matchComicTitleScore(candidateTitle: string, bangumiNameCn: string, bangumiNameOrig: string): number {
  const cNorm = normalizeTitle(candidateTitle)
  if (!cNorm) return 0

  const targets = [normalizeTitle(bangumiNameCn), normalizeTitle(bangumiNameOrig)].filter(Boolean)
  let bestScore = 0

  for (const tNorm of targets) {
    if (cNorm === tNorm) {
      return 100
    }

    if (cNorm.startsWith(tNorm) || tNorm.startsWith(cNorm)) {
      const lenDiff = Math.abs(cNorm.length - tNorm.length)
      if (lenDiff <= 4 || lenDiff / Math.max(cNorm.length, tNorm.length) < 0.35) {
        bestScore = Math.max(bestScore, 90)
        continue
      }
    }

    if (cNorm.includes(tNorm) || tNorm.includes(cNorm)) {
      const shorter = Math.min(cNorm.length, tNorm.length)
      const longer = Math.max(cNorm.length, tNorm.length)
      if (shorter / longer >= 0.5) {
        bestScore = Math.max(bestScore, 80)
        continue
      }
    }

    const sim = bigramSimilarity(cNorm, tNorm)
    const score = Math.round(sim * 100)
    if (score > bestScore) {
      bestScore = score
    }
  }

  return bestScore
}
