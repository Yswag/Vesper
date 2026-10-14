// 搜尋側邊欄項目無障礙與多語言標籤格式化工具。

import { t } from "../../i18n"

/** 一列側邊欄要唸出來的東西：{@link label} 是源名（或「全部」）。 */
export function sourceSidebarLabel({ label, failed, count }: { label: string; failed?: boolean; count: number | null }): string {
  // 失敗優先：失敗的源就算帶著上一次的數字，唸出來也該是「失敗」。
  const status = failed
    ? t("search.sidebarFailed")
    : count === null
      ? t("search.sidebarPending")
      : t("search.sidebarCount", { n: count })
  return t("search.sidebarLabel", { label, status })
}
