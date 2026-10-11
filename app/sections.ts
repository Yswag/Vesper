// 五個分類的中繼資料（標題 key ＋ 圖示）。
//
// 標題只有一份來源：這裡放字典 key，顯示字由畫面在自己的 render 裡 `t()` 出來。
// 有分頁列時是 App 的 `<Tab title>`，沒有分頁列時是切換分類的選單（components/SectionMenu），
// 兩邊讀同一份——以前各抄一份中文，改一邊就會不一致。
//
// 索引就是分頁編號（0: 首頁 … 4: 搜尋），跟 app/navigation.ts 的 switchToTab 是同一組數字。
// 這裡刻意只放中繼資料、不放畫面：screens → components/LeadingToolbar → SectionMenu → 這裡，
// 再 import 畫面模組就會繞回 screens 形成循環。
// （i18n 只取**型別**，執行期沒有依賴：i18n 是零依賴的 leaf。）

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
