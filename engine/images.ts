// 圖片管線的第一段：把源給的「怎麼抓這張圖」解析出來。
// Venera 的契約是圖片永遠由宿主下載，源只提供 ImageLoadingConfig。
//
// 源的這一段也可能因為登入過期而失敗（例如 picacg 要用帳號組出圖片網址），所以源呼叫要能重試。
// 重試本身住在 sources/（要 Keychain 憑證、要知道怎麼重登），而 engine 不可以 import sources——
// 所以重試是**參數**：呼叫端把源與重登方式收在閉包裡帶進來，engine 不持有任何註冊狀態。

export interface ImageRequest {
  url: string
  method: string
  data: unknown
  headers: Record<string, string>
  onResponse?: (bytes: any) => any
  modifyImage?: string
  onLoadFailed?: () => unknown
}

function normalizeHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== "object") return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v != null) out[k] = String(v)
  }
  return out
}

/**
 * 源呼叫的重試（登入過期自動重登）。engine 不懂源，只拿到「再試一次」這個動作。
 * 沒帶就直呼一次（與以前沒註冊時的行為相同）。
 */
export type SourceCallRetry = <T>(call: () => T | Promise<T>) => Promise<T>

async function callSource<T>(retry: SourceCallRetry | undefined, call: () => T | Promise<T>): Promise<T> {
  return retry ? retry(call) : call()
}

/** 把源回傳的普通物件正規化成 ImageRequest；resolveImageRequest 與 onLoadFailed 的重試共用。 */
export function normalizeImageConfig(imageKey: string, config: any): ImageRequest {
  return {
    url: String(config?.url ?? imageKey),
    method: String(config?.method ?? "GET").toUpperCase(),
    data: config?.data ?? null,
    headers: normalizeHeaders(config?.headers),
    onResponse: typeof config?.onResponse === "function" ? config.onResponse : undefined,
    modifyImage: typeof config?.modifyImage === "string" ? config.modifyImage : undefined,
    onLoadFailed: typeof config?.onLoadFailed === "function" ? config.onLoadFailed : undefined,
  }
}

/**
 * 正文圖片：`comic.onImageLoad(imageKey, comicId, epId)`，可以是 async。
 * 源沒實作時，imageKey 本身就是 URL。`retry` 由呼叫端提供（可選）。
 */
export async function resolveImageRequest(
  comicModule: any,
  imageKey: string,
  comicId: string,
  epId: string,
  retry?: SourceCallRetry
): Promise<ImageRequest> {
  const handler = comicModule?.onImageLoad
  if (typeof handler !== "function") {
    return { url: imageKey, method: "GET", data: null, headers: {} }
  }
  const config = await callSource(retry, () => handler.call(comicModule, imageKey, comicId, epId))
  if (!config) return { url: imageKey, method: "GET", data: null, headers: {} }
  return normalizeImageConfig(imageKey, config)
}

/** 縮圖：`comic.onThumbnailLoad(imageKey)` 必須同步。 */
export function resolveThumbnailRequest(comicModule: any, imageKey: string): ImageRequest {
  const handler = comicModule?.onThumbnailLoad
  if (typeof handler !== "function") {
    return { url: imageKey, method: "GET", data: null, headers: {} }
  }
  const config = handler.call(comicModule, imageKey)
  if (!config) return { url: imageKey, method: "GET", data: null, headers: {} }
  return normalizeImageConfig(imageKey, config)
}

/** 以 `//` 開頭的 URL 補上 https:（Venera 的 images.dart 也會做）。 */
export function absoluteUrl(url: string): string {
  if (url.startsWith("//")) return "https:" + url
  return url
}
