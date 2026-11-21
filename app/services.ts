// composition root 建立的 production instance（index.tsx 在啟動時裝上）。
// 畫面一律經 comicLibrary() 取用，沒裝就直接拋。

import type { ComicLibrary } from "./comic"

let library: ComicLibrary | null = null

export function installComicLibrary(instance: ComicLibrary) {
  library = instance
}

export function comicLibrary(): ComicLibrary {
  if (!library) throw new Error("ComicLibrary 還沒建立（要在 index.tsx 的啟動流程裡 install）")
  return library
}
