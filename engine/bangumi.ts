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

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_VERSION = 8

const USER_AGENT = "VesperApp/1.0 (iOS)"

const BOOK_FILTER = { type: [1] }
const TAGGED_MANGA_FILTER = { type: [1], meta_tags: ["漫画"] }

const VOLUME_SUFFIX = /[（(]\s*\d+\s*[)）]\s*$/

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

function saveCache(data: CachedData): void {
  try {
    writeText(cacheFilePath(), JSON.stringify(data))
  } catch (err) {
    log("warning", "bangumi", `無法寫入快取: ${String(err)}`)
  }
}

function parseSubject(item: any): BangumiSubject | null {
  if (!item || !item.id) return null

  if (item.nsfw === true) return null

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

  let author = ""
  if (Array.isArray(item.infobox)) {
    for (const info of item.infobox) {
      if (info.key === "作者" || info.key === "作画" || info.key === "原作") {
        author = typeof info.value === "string" ? info.value : Array.isArray(info.value) ? info.value[0]?.v ?? "" : ""
        if (author) break
      }
    }
  }

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

function getHalfYearAgoDateString(): string {
  const date = new Date(Date.now() - 182 * 24 * 60 * 60 * 1000)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

async function fetchTrendingSubjects(): Promise<BangumiSubject[]> {
  const sinceDate = getHalfYearAgoDateString()

  const pool = await searchPages({ ...TAGGED_MANGA_FILTER, air_date: [`>=${sinceDate}`] }, "heat", 2)

  return pool.map(parseSubject).filter(Boolean).slice(0, 20) as BangumiSubject[]
}

async function fetchFollowingSubjects(): Promise<BangumiSubject[]> {
  const pool = await searchPages(TAGGED_MANGA_FILTER, "heat", 3)

  pool.sort((a, b) => (b.collection?.doing ?? 0) - (a.collection?.doing ?? 0))
  return pool.map(parseSubject).filter(Boolean).slice(0, 20) as BangumiSubject[]
}

export async function fetchPopularPool(pages = 2): Promise<BangumiSubject[]> {
  try {
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
