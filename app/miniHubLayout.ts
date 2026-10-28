// Mini Hub 各區塊的順序與啟用狀態。設定頁寫、首頁分頁讀；兩邊是不同 JS 實例，
// 所以每次都直接讀 KV，不留記憶體快取。

import { createEmitter } from "../engine/emitter"
import { kv } from "../engine/storage"

const KEY = "venera:miniHub"

export type MiniHubSection = "resume" | "updates" | "activity"

/** 預設順序，也是全部的區塊。新增區塊時加在這裡，舊設定會把它補在啟用的最後。 */
export const MINI_HUB_SECTIONS: readonly MiniHubSection[] = ["resume", "updates", "activity"]

export interface MiniHubLayout {
  enabled: MiniHubSection[]
  disabled: MiniHubSection[]
}

const bus = createEmitter()

function isSection(value: unknown): value is MiniHubSection {
  return MINI_HUB_SECTIONS.includes(value as MiniHubSection)
}

/** 丟掉不認得與重複的，沒提到的區塊補進啟用。 */
function normalize(stored: unknown): MiniHubLayout {
  const raw = (stored ?? {}) as Partial<Record<keyof MiniHubLayout, unknown>>
  const seen = new Set<MiniHubSection>()
  const pick = (list: unknown): MiniHubSection[] =>
    (Array.isArray(list) ? list : []).filter((id): id is MiniHubSection => {
      if (!isSection(id) || seen.has(id)) return false
      seen.add(id)
      return true
    })
  const enabled = pick(raw.enabled)
  const disabled = pick(raw.disabled)
  for (const id of MINI_HUB_SECTIONS) if (!seen.has(id)) enabled.push(id)
  return { enabled, disabled }
}

export function getMiniHubLayout(): MiniHubLayout {
  return normalize(kv.get(KEY))
}

export function setMiniHubLayout(layout: MiniHubLayout): void {
  const next = normalize(layout)
  const current = getMiniHubLayout()
  if (next.enabled.join() === current.enabled.join() && next.disabled.join() === current.disabled.join()) return
  kv.set(KEY, next)
  bus.emit()
}

export const subscribeMiniHubLayout = bus.subscribe
