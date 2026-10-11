// Bangumi Open API 整合模組
// 負責取得漫畫高分榜 (Rank)、近期熱門作品，並具備本地快取機制（24 小時）。

import { fetch } from "scripting"
import { appDataRoot, exists, join, readText, writeText } from "./fs"
import { log } from "./log"

export interface BangumiSubject {
  id: number
  name: string
  name_cn: string
  summary: string
  date?: string
  score?: number
  rank?: number
  image?: string
  tags: string[]
  author?: string
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 小時
// 改動查詢語意時要 +1，否則舊快取會在 24 小時內蓋掉新結果。
const CACHE_VERSION = 8

const USER_AGENT = "VesperApp/1.0 (iOS)"

// type 1 是「書籍」大類（漫畫＋小說＋畫集）。server 端是「先過濾再分頁」，所以掛上
// meta_tags 能讓每一頁 20 個位子都留給漫畫，等於深度乘數（實測 3 頁 60 本 vs 不掛 42 本）；
// 代價是看不到沒掛這個公共標籤的少數漫畫（如浪客行）。
// TOP 100 要的是「榜上名次連續」，而且那個標籤漏很大（rank 前 40 只掛到 14 筆，
// platform 是漫畫的有 24 筆），所以那邊不掛濾網，抓回來自己用 platform 判。
const BOOK_FILTER = { type: [1] }
const TAGGED_MANGA_FILTER = { type: [1], meta_tags: ["漫画"] }

/** 單行本/分卷條目（如「少女終末旅行 (6)」）不是作品本身，榜上排除。 */
const VOLUME_SUFFIX = /[（(]\s*\d+\s*[)）]\s*$/

/** 版本字尾（完全版、愛藏版…）；去重用，避免「灌篮高手完全版」與「灌篮高手」各佔一格。 */
const EDITION_WORDS = /(完全版|愛藏版|爱藏版|珍藏版|文庫版|文库版|新裝版|新装版|典藏版|豪華版|豪华版)/g

function cacheFilePath(): string {
  return join(appDataRoot(), "cache", "bangumi_home_cache.json")
}

interface CachedData {
  version?: number
  timestamp: number
  topRank: BangumiSubject[]
  trending: BangumiSubject[]
  following: BangumiSubject[]
  popularPool?: BangumiSubject[]
}

/** 讀取本地快取 */
function loadCache(): CachedData | null {
  try {
    const file = cacheFilePath()
    if (!exists(file)) return null
    const text = readText(file)
    if (!text) return null
    return JSON.parse(text) as CachedData
  } catch {
    return null
  }
}

/** 寫入本地快取 */
function saveCache(data: CachedData): void {
  try {
    writeText(cacheFilePath(), JSON.stringify(data))
  } catch (err) {
    log("warning", "bangumi", `無法寫入快取: ${String(err)}`)
  }
}

function parseSubject(item: any): BangumiSubject | null {
  if (!item || !item.id) return null

  // 匿名請求時 filter.nsfw 會被官方忽略（要 token 才真的生效），所以 R18 得自己擋。
  if (item.nsfw === true) return null

  // 1. 嚴格確認是「漫畫」：
  // Bangumi 的 type: 1 代表「書籍 (Book)」，裡面包含「漫画」、「小说」、「画集」、「公式书」等。
  // 我們只保留 platform 為「漫画」，或 meta_tags / tags 明確包含「漫画」且 platform 不是「小说」的條目。
  const platform = item.platform || ""
  if (platform === "小说" || platform === "画集") return null

  const metaTags: string[] = Array.isArray(item.meta_tags) ? item.meta_tags : []
  const tags: string[] = []
  if (Array.isArray(item.tags)) {
    for (const t of item.tags.slice(0, 8)) {
      if (t?.name) tags.push(t.name)
    }
  }

  const isManga = platform === "漫画" || metaTags.includes("漫画") || tags.includes("漫画") || tags.includes("漫畫")
  if (!isManga) return null

  // 取得作者
  let author = ""
  if (Array.isArray(item.infobox)) {
    for (const info of item.infobox) {
      if (info.key === "作者" || info.key === "作画" || info.key === "原作") {
        author = typeof info.value === "string" ? info.value : Array.isArray(info.value) ? info.value[0]?.v ?? "" : ""
        if (author) break
      }
    }
  }

  // 封面圖優先取 common (400px) 或 large，再退回 image
  const image = item.images?.common ?? item.images?.medium ?? item.images?.large ?? item.image ?? ""

  return {
    id: item.id,
    name: item.name || "",
    name_cn: item.name_cn || item.name || "",
    summary: item.summary ? item.summary.trim() : "",
    date: item.date || "",
    score: item.rating?.score ?? 0,
    rank: item.rating?.rank ?? 0,
    image,
    tags,
    author,
  }
}

/** 呼叫條目搜尋端點（POST /v0/search/subjects），回傳原始 data 陣列。 */
async function searchSubjects(body: object, query = ""): Promise<any[]> {
  const res = await fetch(`https://api.bgm.tv/v0/search/subjects${query}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new Error(`Bangumi API 失敗: HTTP ${res.status}`)
  }

  const json: any = await res.json()
  return json.data || []
}

/** 並行抓數頁搜尋結果並去重（search 一次最多只回 20 筆，只能靠 offset 疊）。 */
async function searchPages(filter: object, sort: string, pages: number): Promise<any[]> {
  const results = await Promise.all(
    Array.from({ length: pages }, (_, index) =>
      searchSubjects({ keyword: "", filter, sort }, `?limit=20&offset=${index * 20}`),
    ),
  )

  const seen = new Set<number>()
  const out: any[] = []
  for (const page of results) {
    for (const item of page) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      out.push(item)
    }
  }
  return out
}

/** 取得高分榜（Top 榜單漫畫）。rank 是分類內排名，榜上小說佔多數，所以要多抓幾頁再篩。 */
async function fetchTopRankSubjects(): Promise<BangumiSubject[]> {
  const pool = await searchPages({ ...BOOK_FILTER, rank: [">0", "<=100"] }, "rank", 2)

  const picked: BangumiSubject[] = []
  const seenWorks = new Set<string>()

  for (const item of pool) {
    if (VOLUME_SUFFIX.test(item.name || "") || VOLUME_SUFFIX.test(item.name_cn || "")) continue

    const subject = parseSubject(item)
    if (!subject) continue

    const key = subject.name_cn.replace(EDITION_WORDS, "").replace(/\s+/g, "")
    if (seenWorks.has(key)) continue
    seenWorks.add(key)

    picked.push(subject)
    if (picked.length >= 20) break
  }

  return picked
}

/** 計算以當前時間為基準的近半年（~182 天前）ISO 日期字串 (YYYY-MM-DD) */
function getHalfYearAgoDateString(): string {
  const date = new Date(Date.now() - 182 * 24 * 60 * 60 * 1000)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** 熱門新作：近半年內開始連載、依收藏人數排序的漫畫。 */
async function fetchTrendingSubjects(): Promise<BangumiSubject[]> {
  const sinceDate = getHalfYearAgoDateString()

  // Bangumi 只有 search 端點能按熱度排序：sort "heat" = 收藏總數（wish+collect+doing+…）。
  // air_date 是「連載開始日」而非更新日，所以半年窗等於「近期才開新連載」的作品，
  // 長青連載（如芙莉莲）不會出現在這裡。
  const pool = await searchPages({ ...TAGGED_MANGA_FILTER, air_date: [`>=${sinceDate}`] }, "heat", 2)

  return pool.map(parseSubject).filter(Boolean).slice(0, 20) as BangumiSubject[]
}

/**
 * 「大家在追」：以「在讀人數」(collection.doing) 排序的漫畫。
 * search 沒有 doing 排序，只能先拿出候選池再自己排；候選池要夠深排序才準，
 * 所以掛 TAGGED_MANGA_FILTER 讓每頁 20 個位子都給漫畫（不掛的話小説會佔掉 3 成）。
 */
async function fetchFollowingSubjects(): Promise<BangumiSubject[]> {
  const pool = await searchPages(TAGGED_MANGA_FILTER, "heat", 3)

  pool.sort((a, b) => (b.collection?.doing ?? 0) - (a.collection?.doing ?? 0))
  return pool.map(parseSubject).filter(Boolean).slice(0, 20) as BangumiSubject[]
}

/**
 * 取得熱門漫畫快取池（抓取熱門前 300 名中隨機 2 頁，共約 40 部漫畫儲存為大池）。
 * 供首頁輪播圖在本地隨機洗牌抽樣，保證零延遲秒開且每次進入都有全新推薦。
 */
export async function fetchPopularPool(pages = 2): Promise<BangumiSubject[]> {
  try {
    // 隨機選一個起始頁
    const randomStart = Math.floor(Math.random() * 12)
    const pageIndices = Array.from({ length: pages }, (_, i) => randomStart + i)

    const rawPages = await Promise.all(
      pageIndices.map(page =>
        searchSubjects(
          { keyword: "", filter: TAGGED_MANGA_FILTER, sort: "heat" },
          `?limit=20&offset=${page * 20}`,
        ),
      ),
    )

    const seen = new Set<number>()
    const pool: BangumiSubject[] = []
    for (const raw of rawPages) {
      for (const item of raw) {
        if (!seen.has(item.id)) {
          seen.add(item.id)
          const parsed = parseSubject(item)
          if (parsed) pool.push(parsed)
        }
      }
    }
    return pool
  } catch (err) {
    log("warning", "bangumi", `抓取熱門漫畫池失敗: ${String(err)}`)
    return []
  }
}

export interface BangumiHomeFeed {
  topRank: BangumiSubject[]
  trending: BangumiSubject[]
  following: BangumiSubject[]
  popularPool: BangumiSubject[]
  isCached: boolean
}

/** 取得首頁 Bangumi 推薦流（優先回傳快取，並非同步/過期時更新） */
export async function getBangumiHomeFeed(forceRefresh = false): Promise<BangumiHomeFeed> {
  const cached = loadCache()
  const now = Date.now()

  if (!forceRefresh && cached && cached.version === CACHE_VERSION && now - cached.timestamp < CACHE_TTL_MS) {
    return {
      topRank: cached.topRank,
      trending: cached.trending,
      following: cached.following ?? [],
      popularPool: cached.popularPool ?? [],
      isCached: true,
    }
  }

  try {
    const [topRank, trending, following, popularPool] = await Promise.all([
      fetchTopRankSubjects(),
      fetchTrendingSubjects(),
      fetchFollowingSubjects(),
      fetchPopularPool(2),
    ])

    const freshData: CachedData = {
      version: CACHE_VERSION,
      timestamp: now,
      topRank,
      trending,
      following,
      popularPool,
    }
    saveCache(freshData)

    return {
      topRank,
      trending,
      following,
      popularPool,
      isCached: false,
    }
  } catch (error) {
    log("warning", "bangumi", `抓取 Bangumi 推薦失敗: ${String(error)}`)
    if (cached) {
      return {
        topRank: cached.topRank,
        trending: cached.trending,
        following: cached.following ?? [],
        popularPool: cached.popularPool ?? [],
        isCached: true,
      }
    }
    return {
      topRank: [],
      trending: [],
      following: [],
      popularPool: [],
      isCached: false,
    }
  }
}
