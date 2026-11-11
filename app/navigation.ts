// 導航與分頁切換控制中心
// 提供跨分頁切換、跳轉搜尋並自動執行查詢等能力。

type TabChangeListener = (tabIndex: number) => void
type SearchTriggerListener = (keyword: string) => void

let tabListener: TabChangeListener | null = null
let searchListener: SearchTriggerListener | null = null
let pendingSearchKeyword: string | null = null

export function setTabChangeListener(fn: TabChangeListener | null) {
  tabListener = fn
}

export function setSearchTriggerListener(fn: SearchTriggerListener | null) {
  searchListener = fn
  // 若在 SearchScreen 掛載前就發送了搜尋請求，於掛載時立即消化
  if (fn && pendingSearchKeyword) {
    const kw = pendingSearchKeyword
    pendingSearchKeyword = null
    fn(kw)
  }
}

/** 切換至指定分頁（0: 首頁, 1: 書架, 2: 瀏覽, 3: 設定, 4: 搜尋） */
export function switchToTab(tabIndex: number) {
  if (tabListener) {
    tabListener(tabIndex)
  }
}

/** 跳轉至搜尋分頁並直接執行關鍵字聚合搜尋 */
export function navigateToSearch(keyword: string) {
  const trimmed = keyword.trim()
  if (!trimmed) return
  // 1. 切換至搜尋 tab（tab 4）
  switchToTab(4)
  // 2. 觸發搜尋
  if (searchListener) {
    searchListener(trimmed)
  } else {
    pendingSearchKeyword = trimmed
  }
}
