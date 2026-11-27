export interface GroupableChapter {
  id: string
  title: string
  group?: string
}

export interface ChapterGroup<T extends GroupableChapter> {
  name: string
  chapters: T[]
}

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
