// 正文取圖管線：記憶體、不落地、可取消。
//
// 為什麼不落地（與 `engine/imagecache.ts` 的縮圖快取分家）：正文看過短時間不會重看，長期佔著磁碟
// （jm 這種一頁 1.7–1.8MB 的尤其明顯）。兩邊語意各自單純，就不必用「有沒有 modifyImage」之類的
// 啟發式去猜一張圖是正文還是縮圖。縮圖（封面／頭像／留言圖）仍然走磁碟那條，一個字都沒改。
//
// 取圖的那一步是共用的 `fetchProcessedImage`（網路 → onResponse → modifyImage），只有「寫檔」被
// 拆掉換成「存進記憶體」——所以不會出現「圖抓到了但沒後處理」。
//
// 值存的是**編碼位元組**，不是 `UIImage`：一張 1600×2400 解碼後約 15MB，存 20 張會爆；
// 解碼留給畫面 mount 的時候做（實測 5–42ms）。
//
// **一份快取＝一次閱讀**：這裡是工廠，閱讀 session 與下載管線各拿自己的一份（`createPageCache()`）。
// 於是「誰的快取屬於誰、誰被放掉」是型別上的事實，不必靠 `dispose({ clearCache: false })` 這種
// 逃逸旗標去補救全域狀態，也不會出現「換話把下載剛抓好的頁清掉」。

import type { AbortSignal } from "scripting"

import { Convert } from "./convert"
import { formatBytes } from "./format"
import { fetchProcessedImage, toCacheSpec } from "./imagecache"
import { resolveImageRequest, type SourceCallRetry } from "./images"
import { log } from "./log"

/** 上限寫死（之後要調再說，不做設定 UI）：24 頁或 30MB，先到者為限。 */
const MAX_PAGES = 24
const MAX_BYTES = 30 * 1024 * 1024

/** 日誌用的短標籤（LogScreen 要能對回是哪一張圖）。 */
function labelOf(url: string): string {
  return url.length > 40 ? "…" + url.slice(-40) : url
}

/** 跟舊的磁碟快取同一個鍵：URL + `modifyImage`（不含 sourceKey、不含圖片種類）。 */
function keyOf(url: string, modifyImage: string | undefined): string {
  return Convert.hexEncode(Convert.md5(Convert.encodeUtf8(url + "\n" + (modifyImage ?? ""))))
}

export interface PageImageRequest {
  /** 這張圖屬於哪個源。 */
  sourceKey: string
  imageKey: string
  comicId: string
  epId: string
  /** 源的 comic 區塊（呼叫 onImageLoad 用）。 */
  comicModule: unknown
  /** 解析圖片請求時的重試（登入過期自動重登），由呼叫端提供。 */
  retry?: SourceCallRetry
}

/**
 * 一份正文的記憶體快取。**實例就是生命週期**：閱讀 session 換話／退出＝放掉那一份，
 * 下載管線那一份不受影響（反過來也一樣）。
 */
export interface PageCache {
  /**
   * 一頁正文的位元組：記憶體 LRU → 網路。
   * 離線層不在這裡——已下載的章節由 `engine/offline.ts` 先處理掉（它才是知道「這一頁有沒有下載」的地方）。
   *
   * **失敗不進 LRU**：抓圖失敗就原樣往上丟，下一次會重抓（不會把失敗記成一個空快取）。
   * `signal` 只影響網路那一步。
   */
  bytes(request: PageImageRequest, signal?: AbortSignal): Promise<Uint8Array>
  /** 放掉整份（換話／退出）。清掉之後，**在飛的請求完成時不會回寫**。 */
  clear(): void
}

export function createPageCache(): PageCache {
  /** `Map` 是插入序，最近用過的往後排就是 LRU。 */
  const pages = new Map<string, Uint8Array>()
  let bytesInCache = 0

  /**
   * 同一個鍵正在抓的那一個請求。
   *
   * 預取（往前 3）與畫面（ChapterImage 要當前那一頁）常常同時要同一張圖——沒有這一層就是同一個
   * URL 發兩次。共用 promise 在正文這條路上安全：一份快取只有一個 `AbortController`，
   * 取消是「整批」的（`dispose()`），所以不會出現「有人偷偷 abort 掉別人」——那正是舊的
   * `cachedImagePath` 不能拿來 abort 的原因。
   *
   * 記 promise 本身（不只記存在）：`clear()` 之後同一頁可以再起一個新請求，
   * 舊的那個收尾時不能把新的這筆去重紀錄刪掉。
   */
  const inflight = new Map<string, Promise<Uint8Array>>()

  /**
   * 世代序號：`clear()` 就加一。每一個請求出發時記下自己屬於哪一代，
   * 回來時對不上就不寫進快取——**這就是 `clear()` 的原子性**（沒有這一步，
   * 一個沒有 signal 的在飛請求會在清掉之後把位元組塞回來，等於沒清到）。
   */
  let generation = 0

  function take(key: string): Uint8Array | undefined {
    const hit = pages.get(key)
    if (!hit) return undefined
    pages.delete(key)
    pages.set(key, hit)
    return hit
  }

  /** 存進去；超過上限就從最舊的開始丟（單張自己就超過上限時，它自己也會被丟掉）。 */
  function keep(key: string, bytes: Uint8Array): void {
    const existing = pages.get(key)
    if (existing) {
      pages.delete(key)
      bytesInCache -= existing.byteLength
    }
    pages.set(key, bytes)
    bytesInCache += bytes.byteLength
    while (pages.size > MAX_PAGES || bytesInCache > MAX_BYTES) {
      const oldest = pages.keys().next().value
      if (oldest === undefined) break
      const dropped = pages.get(oldest)
      pages.delete(oldest)
      bytesInCache -= dropped?.byteLength ?? 0
    }
  }

  function forget(key: string, task: Promise<Uint8Array>): void {
    if (inflight.get(key) === task) inflight.delete(key)
  }

  return {
    async bytes(request, signal) {
      const resolved = await resolveImageRequest(
        request.comicModule,
        request.imageKey,
        request.comicId,
        request.epId,
        request.retry
      )
      const spec = toCacheSpec(resolved)
      const key = keyOf(spec.url, spec.modifyImage)

      const hit = take(key)
      if (hit) {
        // 量測用（debug，不落地）：翻頁時看到這一行就是記憶體命中。
        log("debug", "image", `正文命中記憶體 ${formatBytes(hit.byteLength)}（${labelOf(spec.url)}）`)
        return hit
      }

      // 同一個鍵同時被要兩次：共用同一個請求（成功只 `keep()` 一次）。
      const pending = inflight.get(key)
      if (pending) {
        log("debug", "image", `正文與進行中的請求共用（${labelOf(spec.url)}）`)
        return pending
      }

      const started = Date.now()
      const at = generation
      const task = fetchProcessedImage(spec, request.sourceKey, signal).then(bytes => {
        if (at === generation) {
          keep(key, bytes)
        } else {
          // `clear()` 之後才回來的：位元組照樣給呼叫端，但不回寫（那一份快取已經被放掉了）。
          log("debug", "image", `正文回來時已被清掉（不回寫）（${labelOf(spec.url)}）`)
        }
        log(
          "debug",
          "image",
          `正文冷抓 ${Date.now() - started}ms ${formatBytes(bytes.byteLength)}（${labelOf(spec.url)}）`
        )
        return bytes
      })
      inflight.set(key, task)
      // 失敗不留在 map（下一次要重抓）；成功也移掉（已經在 LRU 了）。
      task.then(
        () => forget(key, task),
        () => forget(key, task)
      )
      return task
    },

    clear() {
      generation++
      pages.clear()
      bytesInCache = 0
      inflight.clear()
    },
  }
}
