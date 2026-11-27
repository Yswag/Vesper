export type SlotHalf = "left" | "right"

export interface PageSlot {
  id: string
  page: number
  half?: SlotHalf
}

export interface PageSlots {
  slots: PageSlot[]
  firstSlotOf(page: number): number
  pageOf(slot: number): number
  indexOf(id: string): number
}

export function isWideAspect(aspect: number | null): boolean {
  return aspect !== null && aspect > 1
}

export function rightHalfFirst(direction: "ltr" | "rtl" | "ttb", swap: boolean): boolean {
  return (direction === "rtl") !== swap
}

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

export interface ChainedSlot extends PageSlot {
  epId: string
}

export interface ChainedChapter {
  epId: string
  pageCount: number
  isWide: ((page: number) => boolean) | null
}

export interface ChainedSlots {
  slots: ChainedSlot[]
  firstSlotOf(epId: string, page: number): number
  locate(slot: number): { epId: string; page: number } | null
  indexOf(id: string): number
  rangeOf(epId: string): { start: number; end: number } | null
}

export function chainSlotId(epId: string, localId: string): string {
  return `${encodeURIComponent(epId)}:${localId}`
}

export function buildChainedSlots(chapters: ChainedChapter[], rightFirst: boolean): ChainedSlots {
  const slots: ChainedSlot[] = []
  const ranges = new Map<string, { start: number; end: number; local: PageSlots }>()
  for (const chapter of chapters) {
    if (ranges.has(chapter.epId)) continue
    const local = buildPageSlots(chapter.pageCount, chapter.isWide, rightFirst)
    const start = slots.length
    for (const slot of local.slots) slots.push({ ...slot, id: chainSlotId(chapter.epId, slot.id), epId: chapter.epId })
    ranges.set(chapter.epId, { start, end: slots.length, local })
  }
  const byId = new Map(slots.map((slot, index) => [slot.id, index]))
  return {
    slots,
    firstSlotOf: (epId, page) => {
      const range = ranges.get(epId)
      if (!range || range.end === range.start) return -1
      return range.start + range.local.firstSlotOf(page)
    },
    locate: slot => {
      if (slots.length === 0) return null
      const hit = slots[Math.min(Math.max(Math.round(slot), 0), slots.length - 1)]
      return { epId: hit.epId, page: hit.page }
    },
    indexOf: id => byId.get(id) ?? -1,
    rangeOf: epId => {
      const range = ranges.get(epId)
      return range ? { start: range.start, end: range.end } : null
    },
  }
}

export function halfRect(
  width: number,
  height: number,
  half: SlotHalf | undefined
): { x?: number; y?: number; width: number; height: number } {
  if (!half) return { width, height }
  const left = Math.floor(width / 2)
  return half === "left" ? { x: 0, y: 0, width: left, height } : { x: left, y: 0, width: width - left, height }
}

export function halfSuffix(half: SlotHalf | undefined): string {
  return half === "left" ? "L" : half === "right" ? "R" : ""
}

export function slotAspect(aspect: number, half: SlotHalf | undefined): number {
  return half ? aspect / 2 : aspect
}
