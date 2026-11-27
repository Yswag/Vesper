import type { AbortSignal } from "scripting"

export interface ImageResponseInfo {
  status: number
  headers: Record<string, string>
}

export interface ImageRequest {
  url: string
  method: string
  data: unknown
  headers: Record<string, string>
  onResponse?: (bytes: any, response?: ImageResponseInfo) => any
  modifyImage?: string
  onLoadFailed?: () => unknown
  fetch?: (signal?: AbortSignal) => Promise<Uint8Array>
}

function normalizeHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== "object") return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v != null) out[k] = String(v)
  }
  return out
}

export type SourceCallRetry = <T>(call: () => T | Promise<T>) => Promise<T>

async function callSource<T>(retry: SourceCallRetry | undefined, call: () => T | Promise<T>): Promise<T> {
  return retry ? retry(call) : call()
}

export function normalizeImageConfig(imageKey: string, config: any): ImageRequest {
  return {
    url: String(config?.url ?? imageKey),
    method: String(config?.method ?? "GET").toUpperCase(),
    data: config?.data ?? null,
    headers: normalizeHeaders(config?.headers),
    onResponse: typeof config?.onResponse === "function" ? config.onResponse : undefined,
    modifyImage: typeof config?.modifyImage === "string" ? config.modifyImage : undefined,
    onLoadFailed: typeof config?.onLoadFailed === "function" ? config.onLoadFailed : undefined,
    fetch: typeof config?.fetch === "function" ? config.fetch : undefined,
  }
}

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

export function resolveThumbnailRequest(comicModule: any, imageKey: string): ImageRequest {
  const handler = comicModule?.onThumbnailLoad
  if (typeof handler !== "function") {
    return { url: imageKey, method: "GET", data: null, headers: {} }
  }
  const config = handler.call(comicModule, imageKey)
  if (!config) return { url: imageKey, method: "GET", data: null, headers: {} }
  return normalizeImageConfig(imageKey, config)
}

export function absoluteUrl(url: string): string {
  if (url.startsWith("//")) return "https:" + url
  return url
}
