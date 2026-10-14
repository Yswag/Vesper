// 五個主要分類分頁之中繼資料（標題 i18n key 與 SF Symbol 圖示）。

import type { MessageKey } from "../i18n"

export interface Section {
  /** 字典 key；顯示字在 render 時才求值，不然切語言不會跟著變。 */
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
