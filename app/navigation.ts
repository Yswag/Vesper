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
  if (fn && pendingSearchKeyword) {
    const kw = pendingSearchKeyword
    pendingSearchKeyword = null
    fn(kw)
  }
}

export function switchToTab(tabIndex: number) {
  if (tabListener) {
    tabListener(tabIndex)
  }
}

export function navigateToSearch(keyword: string) {
  const trimmed = keyword.trim()
  if (!trimmed) return
  switchToTab(4)
  if (searchListener) {
    searchListener(trimmed)
  } else {
    pendingSearchKeyword = trimmed
  }
}
