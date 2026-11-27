import { createEmitter } from "../engine/emitter"
import { kv } from "../engine/storage"

const KEY = "venera:miniHub"

export type MiniHubSection = "resume" | "updates" | "backlog" | "activity" | "search"

export const MINI_HUB_SECTIONS: readonly MiniHubSection[] = ["search", "resume", "updates", "backlog", "activity"]

export interface MiniHubLayout {
  enabled: MiniHubSection[]
  disabled: MiniHubSection[]
}

const bus = createEmitter()

function isSection(value: unknown): value is MiniHubSection {
  return MINI_HUB_SECTIONS.includes(value as MiniHubSection)
}

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
