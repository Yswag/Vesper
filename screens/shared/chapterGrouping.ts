// 章節分組邏輯：依據來源提供的 group（例如 MangaDex 的 "Volume 1 - CN", "Volume 1 - EN"）做分組。
// 純函式，不依賴任何 UI 元件，方便在 ComicDetailScreen 與 ReaderScreen 共享。

export interface GroupableChapter {
  id: string
  title: string
  group?: string
}

export interface ChapterGroup<T extends GroupableChapter> {
  name: string
  chapters: T[]
}

/**
 * 從章節清單提取分組結構。
 * 如果章節完全沒有分組或全部屬於同一個組，則視為「無分組模式」（groups.length <= 1）。
 */
export function groupChapters<T extends GroupableChapter>(chapters: T[]): ChapterGroup<T>[] {
  if (chapters.length === 0) return []

  const groupMap = new Map<string, T[]>()

  for (const chapter of chapters) {
    const groupName = chapter.group?.trim() || ""
    let list = groupMap.get(groupName)
    if (!list) {
      list = []
      groupMap.set(groupName, list)
    }
    list.push(chapter)
  }

  return Array.from(groupMap.entries()).map(([name, chs]) => ({
    name,
    chapters: chs,
  }))
}

/**
 * 依據偏好/歷史記錄找出最佳的初始分組名稱。
 * 1. 若給定 epId，優先回傳包含該 epId 的分組名稱。
 * 2. 否則回傳第一個分組名稱。
 */
export function resolveInitialGroupName<T extends GroupableChapter>(
  groups: ChapterGroup<T>[],
  preferredEpId?: string
): string {
  if (groups.length === 0) return ""

  if (preferredEpId) {
    const matched = groups.find(g => g.chapters.some(c => c.id === preferredEpId))
    if (matched) return matched.name
  }

  return groups[0].name
}
