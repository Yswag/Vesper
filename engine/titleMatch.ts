// 漫畫標題相似度比對與過濾模組
// 用於 Bangumi 聚合推薦匹配，過濾掉「只包含零星相同字（如『墜入情網』）」的無關作品。

/** 清理標題：移除常見標點符號、括號及其內贅詞（如全彩、連載中、第X話、單行本等）、空白 */
export function normalizeTitle(title: string): string {
  if (!title) return ""
  return title
    .toLowerCase()
    // 去除全形/半形括號及其內容，如 【全彩】、(連載中)、[第01卷]
    .replace(/[\[\(\{\<【〔（［《〈][^\]\)\}\>】〕）］》〉]*[\]\)\}\>】〕）］》〉]/g, "")
    // 去除標點與空格
    .replace(/[\s\p{P}\p{S}～〜·・_—\-\+]+/gu, "")
    .trim()
}

/** 計算兩字串的 Dice's Coefficient (Bigram 相似度，0~1) */
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

/**
 * 評估目標漫畫候選標題與 Bangumi 作品標題的相關度得分 (0 ~ 100)
 * 考慮中文名與日文/原名，若任一者高度匹配即給予高分。
 */
export function matchComicTitleScore(candidateTitle: string, bangumiNameCn: string, bangumiNameOrig: string): number {
  const cNorm = normalizeTitle(candidateTitle)
  if (!cNorm) return 0

  const targets = [normalizeTitle(bangumiNameCn), normalizeTitle(bangumiNameOrig)].filter(Boolean)
  let bestScore = 0

  for (const tNorm of targets) {
    if (cNorm === tNorm) {
      return 100 // 完全相同
    }

    // 若一方是另一方的前綴或包含關係
    if (cNorm.startsWith(tNorm) || tNorm.startsWith(cNorm)) {
      const lenDiff = Math.abs(cNorm.length - tNorm.length)
      // 若長度差異在合理範圍內（例如只是多了副標題）
      if (lenDiff <= 4 || lenDiff / Math.max(cNorm.length, tNorm.length) < 0.35) {
        bestScore = Math.max(bestScore, 90)
        continue
      }
    }

    if (cNorm.includes(tNorm) || tNorm.includes(cNorm)) {
      const shorter = Math.min(cNorm.length, tNorm.length)
      const longer = Math.max(cNorm.length, tNorm.length)
      // 避免因為搜「墜入情網」這樣 4 個字匹配到 15 個字無關漫畫
      if (shorter / longer >= 0.5) {
        bestScore = Math.max(bestScore, 80)
        continue
      }
    }

    // Bigram 相似度計算
    const sim = bigramSimilarity(cNorm, tNorm)
    const score = Math.round(sim * 100)
    if (score > bestScore) {
      bestScore = score
    }
  }

  return bestScore
}
