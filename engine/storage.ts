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
