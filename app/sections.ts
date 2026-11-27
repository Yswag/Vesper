import type { MessageKey } from "../i18n"

export interface Section {
  titleKey: MessageKey
  systemImage: string
}

export const SECTIONS: Section[] = [
  { titleKey: "common.tabs.home", systemImage: "house" },
  { titleKey: "common.tabs.bookshelf", systemImage: "books.vertical" },
  { titleKey: "common.tabs.browse", systemImage: "square.grid.2x2" },
  { titleKey: "common.tabs.settings", systemImage: "gearshape" },
  { titleKey: "common.tabs.search", systemImage: "magnifyingglass" },
]
