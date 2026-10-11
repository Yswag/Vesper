// composition root 建立的 production instance（index.tsx 在啟動時裝上）。
//
// Phase 0 只是把 instance 建好放著：UI 仍走舊入口，所以沒有任何行為改變；
// 之後的遷移逐步把 screens 的 import 換成這裡拿到的 ComicLibrary。

import type { ComicLibrary } from "./comic"

let library: ComicLibrary | null = null

export function installComicLibrary(instance: ComicLibrary) {
  library = instance
}

export function comicLibrary(): ComicLibrary {
  if (!library) throw new Error("ComicLibrary 還沒建立（要在 index.tsx 的啟動流程裡 install）")
  return library
}
