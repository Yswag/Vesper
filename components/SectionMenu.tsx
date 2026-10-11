// 沒有 tab bar 的殼靠這顆按鈕切換分類：導覽列左上角的選單。
//
// 標題與圖示跟著目前分類走（沒有分頁列，這是唯一「我在哪」的線索），選了就 switchToTab。
// 掛在哪一頁由 `components/LeadingToolbar` 決定（只有根畫面有）。

import { Picker, Text, useEffect, useState } from "scripting"

import { currentTabIndex, subscribeCurrentTab, switchToTab } from "../app/navigation"
import { SECTIONS } from "../app/sections"
import { t } from "../i18n"

export function SectionMenu() {
  const [index, setIndex] = useState(currentTabIndex())

  useEffect(() => subscribeCurrentTab(setIndex), [])

  const section = SECTIONS[index] ?? SECTIONS[0]
  // 分類名稱在 render 時才算：換語言時父層重繪，這裡就跟著變。
  const title = t(section.titleKey)

  return (
    <Picker
      title={title}
      systemImage={section.systemImage}
      accessibilityLabel={t("common.sectionMenu", { title })}
      value={index}
      onChanged={switchToTab}
      pickerStyle="menu"
    >
      {/* key 用分類編號（＝分頁編號＝tab id），不是標題 —— 顯示字串不當 identity。 */}
      {SECTIONS.map((item, position) => (
        <Text key={position} tag={position}>
          {t(item.titleKey)}
        </Text>
      ))}
    </Picker>
  )
}
