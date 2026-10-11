// 根畫面導覽列最左邊的那顆按鈕。
//
// index.tsx 的殼有分頁列，左上角是「離開 Vesper」（見 ExitToolbar）。
// home_screen_default_ui.tsx 的殼（Scripting 首頁分頁）沒有分頁列也不能離開，
// 左上角換成切換分類的選單 —— 不然五個分類之間沒有別的路可走。
//
// 只有根畫面掛它；推入的子頁面有自己的返回鍵。

import { isTabBarHidden } from "../app/navigation"
import { ExitToolbar } from "./ExitToolbar"
import { SectionMenu } from "./SectionMenu"

export function LeadingToolbar() {
  if (isTabBarHidden()) {
    return <SectionMenu />
  }

  return <ExitToolbar />
}
