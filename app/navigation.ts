// 導航與分頁切換控制中心
// 提供跨分頁切換、跳轉搜尋並自動執行查詢等能力。

type TabChangeListener = (tabIndex: number) => void
type SearchTriggerListener = (keyword: string) => void

let tabListener: TabChangeListener | null = null
let searchListener: SearchTriggerListener | null = null
let pendingSearchKeyword: string | null = null

/** 目前所在的分頁。只有沒有 tab bar 的殼會讀它（見 App 的 hideTabBar）。 */
let currentTab = 0
let currentTabListener: TabChangeListener | null = null

/**
 * 殼有沒有 tab bar。沒有 tab bar 就沒有分頁列可看，導覽列左上角要換成切換分類的選單
 * （components/LeadingToolbar）。由 App 依自己的 prop 設定 —— 畫面自己的 toolbar 是
 * 在畫面裡建的，拿不到 App 的 prop。
 */
let tabBarHidden = false

export function setTabChangeListener(fn: TabChangeListener | null) {
  tabListener = fn
}

export function setTabBarHidden(hidden: boolean) {
  tabBarHidden = hidden
}

export function isTabBarHidden() {
  return tabBarHidden
}

/** 訂閱「目前分頁」變化（切換分類的選單靠它跟上目前位置）；回傳取消訂閱的函式。 */
export function subscribeCurrentTab(fn: TabChangeListener) {
  currentTabListener = fn
  return () => {
    currentTabListener = null
  }
}

export function currentTabIndex() {
  return currentTab
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
  currentTab = tabIndex
  if (tabListener) {
    tabListener(tabIndex)
  }
  if (currentTabListener) {
    currentTabListener(tabIndex)
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
