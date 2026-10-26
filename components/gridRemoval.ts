// 網格項目的移除節奏：先讓那一格原地縮小、往上淡出，等它演完才真的刪。
// 刪除是資料層的事，退場與補位是網格的事（`ComicGridLayout`）。

import { useState } from "scripting"

/** 退場：縮小＋上移＋淡出（`ComicGrid` 套在整格上）。 */
export const GRID_EXIT_ANIM = Animation.smooth({ duration: 0.22 })
/** 退場時長，要比 `GRID_EXIT_ANIM` 稍長：動畫收乾淨了才刪，才不會刪到一半就跳位。 */
export const GRID_EXIT_MS = 230
/** 補位：書從架上抽走後，其餘格子靠攏的彈性。 */
export const GRID_REGRID_ANIM = Animation.spring({ duration: 0.36, bounce: 0.1 })

export interface GridRemoval {
  /** 這一格正在退場（網格據此縮小淡出）。 */
  isRemoving: (key: string) => boolean
  /** key 與網格格子的 key 同一套（`sourceKey:comicId`）；`commit` 才是真的刪。 */
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
