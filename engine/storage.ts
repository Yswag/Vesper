// Scripting 的 Storage 是全域（不是 "scripting" 的匯出）。包一層是為了讓引擎其餘部分
// 不必直接依賴它，日後要換成檔案式儲存時只改這裡。

export const kv = {
  get: (key: string): any => Storage.get(key),
  set: (key: string, value: unknown): void => {
    Storage.set(key, value)
  },
  remove: (key: string): void => {
    Storage.remove(key)
  },
  contains: (key: string): boolean => Boolean(Storage.contains(key)),
  keys: (): string[] => Storage.keys(),
}
