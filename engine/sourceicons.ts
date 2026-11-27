import { fetch } from "scripting"
import { appDataRoot, ensureDir, exists, join, remove, writeBytes } from "./fs"
import { log } from "./log"

const KNOWN_SOURCE_DOMAINS: Record<string, string[]> = {
  copy_manga: ["api.copy-manga.com", "api.copy2000.online", "www.copy20.com", "copymanga.site"],
  Komiic: ["komiic.com"],
  baozi: ["baozimhcn.com", "bzmgcn.com"],
  picacg: ["manhuabika.com", "picacomic.com"],
  nhentai: ["nhentai.net"],
  wnacg: ["wnacg.com"],
  ehentai: ["e-hentai.org"],
  jm: ["18comic.vip"],
  manga_dex: ["mangadex.org"],
  ikmmh: ["www.ikmmh.com"],
  shonen_jump_plus: ["shonenjumpplus.com"],
  hitomi: ["hitomi.la"],
  comick: ["comick.art"],
  ykmh: ["www.ykmh.net"],
  zaimanhua: ["zaimanhua.com"],
  ManHuaGui: ["www.manhuagui.com"],
  manwaba: ["mwuu.cc"],
  comic_walker: ["comic-walker.com"],
  ccc: ["creative-comic.tw"],
  goda: ["godamh.com"],
  manhuaren: ["www.manhuaren.com"],
  hcomic: ["h-comic.com"],
  jcomic: ["jcomic.net"],
  hot_manga: ["manga2026.com"],
  happy: ["m.happymh.com"],
  mycomic: ["mycomic.com"],
}

function iconDir(): string {
  return join(appDataRoot(), "cache", "source-icons")
}

function safeKey(key: string): string {
  return key.replace(/[^\w.-]/g, "_")
}

export function sourceIconPath(key: string): string {
  return join(iconDir(), `${safeKey(key)}.bin`)
}

export function hasSourceIcon(key: string): boolean {
  try {
    return exists(sourceIconPath(key))
  } catch {
    return false
  }
}

const memCache = new Map<string, UIImage | null>()
const inflight = new Map<string, Promise<string | null>>()

export function getCachedSourceIcon(key: string): UIImage | null {
  if (memCache.has(key)) {
    return memCache.get(key) ?? null
  }
  const path = sourceIconPath(key)
  if (exists(path)) {
    try {
      const img = UIImage.fromFile(path)
      if (img) {
        memCache.set(key, img)
        return img
      }
    } catch {
    }
  }
  return null
}

export function guessDomainsForSource(key: string, instance?: any): string[] {
  const result: string[] = []
  if (KNOWN_SOURCE_DOMAINS[key]) {
    result.push(...KNOWN_SOURCE_DOMAINS[key])
  }

  if (instance) {
    const candidates: Array<string | undefined> = [
      instance?.account?.loginWithWebview?.url,
      instance?.account?.registerWebsite,
      instance?.baseUrl,
      instance?.apiUrl,
      instance?.url,
    ]

    for (const raw of candidates) {
      if (typeof raw === "string" && raw.startsWith("http")) {
        try {
          const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(raw)
          if (m && m[1]) {
            const host = m[1].toLowerCase()
            if (
              !host.includes("jsdelivr") &&
              !host.includes("github") &&
              !host.includes("localhost") &&
              !result.includes(host)
            ) {
              result.push(host)
            }
          }
        } catch {
        }
      }
    }
  }

  return result
}

export async function fetchAndCacheSourceIcon(
  key: string,
  instance?: any
): Promise<string | null> {
  const targetPath = sourceIconPath(key)
  if (exists(targetPath)) {
    return targetPath
  }

  const running = inflight.get(key)
  if (running) return running

  const task = (async () => {
    try {
      const domains = guessDomainsForSource(key, instance)
      if (domains.length === 0) return null

      ensureDir(iconDir())

      for (const domain of domains) {
        const candidateUrls = [
          `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
          `https://icons.duckduckgo.com/ip3/${domain}.ico`,
          `https://${domain}/favicon.ico`,
        ]

        for (const url of candidateUrls) {
          try {
            const res = await fetch(url, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              },
              timeout: 6,
              allowInsecureRequest: true,
            } as any)

            if (res.status === 200) {
              const buf = await res.arrayBuffer()
              if (buf.byteLength >= 100 && buf.byteLength !== 726) {
                const data = Data.fromUint8Array(new Uint8Array(buf))
                const decoded = data ? UIImage.fromData(data) : null
                if (decoded) {
                  writeBytes(targetPath, buf)
                  memCache.set(key, decoded)
                  log("debug", "icons", `已快取 ${key} 的圖標 (${domain})`)
                  return targetPath
                }
              }
            }
          } catch {
          }
        }
      }
    } catch (error) {
      log("debug", "icons", `抓取 ${key} 圖標失敗`, error)
    } finally {
      inflight.delete(key)
    }
    return null
  })()

  inflight.set(key, task)
  return task
}

export function clearSourceIconMemory(): void {
  memCache.clear()
}

export function clearSourceIconCache(): void {
  clearSourceIconMemory()
  remove(iconDir())
}

export function sourceIconMemoryKeys(): string[] {
  return [...memCache.keys()]
}
