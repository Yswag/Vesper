// 畫面訂閱模組層級的變更。
//
// 收的是這個舞步：一個沒人讀的版號 useState、一個 setVersion(value => value + 1)，
// 加上 useEffect(() => subscribeX(() => setVersion(value => value + 1)), [])。
// 六個畫面都在寫同一套，細節還各有小差異。

import { useEffect, useState } from "scripting"

/** 模組的通知訂閱函式（`subscribeDownloads` / `subscribeLibrary` …）：回傳退訂。 */
export type Subscribe = (notify: () => void) => () => void

/**
 * 訂閱一或多個模組的變更；有變更就重繪這個畫面。
 *
 * 回傳的函式可以自己再重繪一次（`onAppear`、下拉重整、清快取之後）。
 *
 * 只做訂閱與重繪，**不**順手讀資料——取資料留在 render 裡，語意才是「每次重繪重讀」；
 * 包進來會變成快照快取，是行為變更。
 *
 * 傳進來的必須是模組層級的訂閱函式：只在掛載時訂閱一次，之後換 identity 不會重新訂閱。
 */
export function useSubscription(...sources: Subscribe[]): () => void {
  const [, setVersion] = useState(0)
  const refresh = () => setVersion(value => value + 1)

  useEffect(() => {
    const unsubscribes = sources.map(source => source(refresh))
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  }, [])

  return refresh
}
