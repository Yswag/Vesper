// 搜尋側邊欄每一列的無障礙標籤。
//
// 以前這裡是一個三層的三元運算式塞進字串插值裡：
// `` `${label}，${failed ? "搜尋失敗" : count == null ? "等待結果" : `${count} 個結果`}` ``。
// 三種語言的標點與量詞都不同（英文的逗號、`1 result` / `3 results`），塞不進一個插值，
// 所以拆成兩步：先挑狀態詞，再組整句。
//
// 為什麼抽成獨立的小模組而不是留在畫面裡：畫面本身沒有探針，而這兩步的走法（失敗優先於
// 等待、`count` 為 null 與 0 是兩件事）在這裡驗得到——`dev/probe-i18n.ts` ⑦。

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
