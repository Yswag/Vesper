import { useState } from "scripting"

export const GRID_EXIT_ANIM = Animation.smooth({ duration: 0.22 })
export const GRID_EXIT_MS = 230
export const GRID_REGRID_ANIM = Animation.spring({ duration: 0.36, bounce: 0.1 })

export interface GridRemoval {
  isRemoving: (key: string) => boolean
  remove: (key: string, commit: () => void) => void
}

export function useGridRemoval(): GridRemoval {
  const [keys, setKeys] = useState<readonly string[]>([])

  function remove(key: string, commit: () => void) {
    setKeys(list => (list.includes(key) ? list : [...list, key]))
    setTimeout(() => {
      commit()
      setKeys(list => list.filter(item => item !== key))
    }, GRID_EXIT_MS)
  }

  return { isRemoving: key => keys.includes(key), remove }
}
