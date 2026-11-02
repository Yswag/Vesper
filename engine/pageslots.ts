// 畫廊的「格」：一格＝一個畫面。寬圖切割開著時，寬圖佔兩格（左半、右半），其餘一張一格。
// 頁碼（進度、HUD）一律是圖片索引；格只管捲動位置。id 固定，插格時其他格的 id 不變。

export type SlotHalf = "left" | "right"

export interface PageSlot {
  /** 捲動用 id：整張 `"12"`，半張 `"12L"`／`"12R"`。 */
  id: string
  /** 圖片索引（＝頁碼）。 */
  page: number
  half?: SlotHalf
}

export interface PageSlots {
  slots: PageSlot[]
  /** 這一頁的第一格（依閱讀順序）；越界夾到兩端。 */
  firstSlotOf(page: number): number
  /** 這一格是哪一頁；越界夾到兩端。 */
  pageOf(slot: number): number
  /** 依 id 找格；找不到回 -1。 */
  indexOf(id: string): number
}

/** 寬比高大就算寬圖（Venera、Aidoku 同一條判定）。 */
export function isWideAspect(aspect: number | null): boolean {
  return aspect !== null && aspect > 1
}

/** 右半先讀：右到左預設右先、其他方向預設左先；`swap` 反過來。 */
export function rightHalfFirst(direction: "ltr" | "rtl" | "ttb", swap: boolean): boolean {
  return (direction === "rtl") !== swap
}

/**
 * 排格。`isWide` 為 null＝不切（一張一格，id 就是頁碼字串）。
 */
export function buildPageSlots(
  pageCount: number,
  isWide: ((page: number) => boolean) | null,
  rightFirst: boolean
): PageSlots {
  const slots: PageSlot[] = []
  const first: number[] = []
  for (let page = 0; page < pageCount; page++) {
    first.push(slots.length)
    if (isWide && isWide(page)) {
      const halves: SlotHalf[] = rightFirst ? ["right", "left"] : ["left", "right"]
      for (const half of halves) slots.push({ id: `${page}${halfSuffix(half)}`, page, half })
    } else {
      slots.push({ id: String(page), page })
    }
  }
  const byId = new Map(slots.map((slot, index) => [slot.id, index]))
  const clamp = (value: number, max: number) => Math.min(Math.max(Math.round(value), 0), Math.max(max, 0))
  return {
    slots,
    firstSlotOf: page => (first.length === 0 ? 0 : first[clamp(page, first.length - 1)]),
    pageOf: slot => (slots.length === 0 ? 0 : slots[clamp(slot, slots.length - 1)].page),
    indexOf: id => byId.get(id) ?? -1,
  }
}

/** 超分的來源範圍（像素）：整張不帶 x/y；半張從中線切，奇數寬多的一列歸右半。 */
export function halfRect(
  width: number,
  height: number,
  half: SlotHalf | undefined
): { x?: number; y?: number; width: number; height: number } {
  if (!half) return { width, height }
  const left = Math.floor(width / 2)
  return half === "left" ? { x: 0, y: 0, width: left, height } : { x: left, y: 0, width: width - left, height }
}

/** 半張檔名的尾碼。 */
export function halfSuffix(half: SlotHalf | undefined): string {
  return half === "left" ? "L" : half === "right" ? "R" : ""
}

/** 一格實際要畫的比例：半張是整張的一半寬。 */
export function slotAspect(aspect: number, half: SlotHalf | undefined): number {
  return half ? aspect / 2 : aspect
}
