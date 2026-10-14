// 漫畫源網站 Favicon / Icon 快取管理模組。
// 本地快取位於 cache/source-icons/<key>.bin。
// 依 KNOWN_SOURCE_DOMAINS 或來源宣告網域，透過 Google/DuckDuckGo Favicon 服務或根路徑靜默抓取。

import { fetch } from "scripting"
import { appDataRoot, ensureDir, exists, join, remove, writeBytes } from "./fs"
import { log } from "./log"

/** 已知各大源的代表網域或備選網域清單對照表 */
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

/** 記憶體快取，避免每幀重複讀檔解碼 */
const memCache = new Map<string, UIImage | null>()
/** 正在飛的抓取工作，避免同一個 key 並行打多次網路 */
const inflight = new Map<string, Promise<string | null>>()

/** 從本機快取或記憶體取得已解碼的 UIImage，若尚未快取則回傳 null */
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
      // 檔案損毀就忽略
    }
  }
  return null
}

/** 從來源實例中推導該來源的候選 domains */
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
          // 忽略
        }
      }
    }
  }

  return result
}

/** 背景非同步抓取並快取來源圖標 */
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
              // Google 回傳 404 時是 726 bytes 的預設地球圖標，濾除它
              if (buf.byteLength >= 100 && buf.byteLength !== 726) {
                const data = Data.fromUint8Array(new Uint8Array(buf))
                const decoded = data ? UIImage.fromData(data) : null
                if (decoded) {
                  // 解碼成功，寫入快取
                  writeBytes(targetPath, buf)
                  memCache.set(key, decoded)
                  log("debug", "icons", `已快取 ${key} 的圖標 (${domain})`)
                  return targetPath
                }
              }
            }
          } catch {
            // 嘗試下一個 URL
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

/** 只清記憶體那份（已解碼的 UIImage）。磁碟的檔案不動，下一次 getCachedSourceIcon 會重新讀檔。 */
export function clearSourceIconMemory(): void {
  memCache.clear()
}

/** 清理所有圖標快取：記憶體與磁碟一起（設定頁那顆「清除縮圖快取」呼叫的就是這一個）。 */
export function clearSourceIconCache(): void {
  clearSourceIconMemory()
  remove(iconDir())
}

/** 探針用：目前記在記憶體快取裡的 key（清空入口的斷言；值可能是 null，這裡只看有沒有這一筆）。 */
export function sourceIconMemoryKeys(): string[] {
  return [...memCache.keys()]
}
