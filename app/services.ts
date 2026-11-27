import type { ComicLibrary } from "./comic"

let library: ComicLibrary | null = null

export function installComicLibrary(instance: ComicLibrary) {
  library = instance
}

export function comicLibrary(): ComicLibrary {
  if (!library) throw new Error("ComicLibrary 還沒建立（要在 index.tsx 的啟動流程裡 install）")
  return library
}
