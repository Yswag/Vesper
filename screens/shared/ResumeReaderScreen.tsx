// 續讀入口：首頁的續讀卡與書架的閱讀歷史列都走這裡，**不經詳情頁**直接開全螢幕閱讀器。
//
// 為什麼是 present 而不是推入：閱讀器要吃掉整個螢幕（含 tab bar），
// 而且在卡片點下去的當下就在背景把章節清單抓好，好了直接彈出、退出就回原位，
// 不會先閃一個「過渡頁」再跳第二次。
//
// 挑話、頁碼、清單從哪來（本機／線上）與要不要背景補清單都在 `comicLibrary().resumePlan()`：
// 這裡只負責開閱讀器，或把「為什麼開不了」講給使用者聽。

import { Navigation, useEffect, useState } from "scripting"

import type { ComicRef } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { showToast } from "../../app/toast"
import { t } from "../../i18n"
import { ReaderScreen, type ReaderProps } from "./ReaderScreen"

/**
 * 續讀專用的閱讀器：先用手上的清單開，背景補到最新就換上。
 * 換清單只換 `chapters`（開章 effect 不依賴它），所以正在讀的那一話與頁碼都不動。
 */
function ResumeReader({ chapters: initialChapters, ...props }: ReaderProps) {
  const [chapters, setChapters] = useState(initialChapters)
  const { sourceKey, comicId } = props

  useEffect(() => {
    let alive = true
    const library = comicLibrary()
    void library
      .comic({ sourceKey, comicId })
      // `comic()` 成功就把最新清單覆寫進快取（見 app/comic.ts），這裡再從合併清單讀回來：
      // 清單的形狀只有離線層知道，不重複一份映射。
      .then(() => {
        if (!alive) return
        setChapters(library.offline.readerChapters({ sourceKey, comicId }))
      })
      // 背景補清單失敗（沒網路、源被移除）就維持本機那一份。
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [sourceKey, comicId])

  return <ReaderScreen {...props} chapters={chapters} />
}

export interface ReaderLaunch extends ReaderProps {
  /** 先開再補：章節清單在背景向源更新，抵達就換上（續讀本機章用）。 */
  refreshChapters?: boolean
}

/**
 * 以全螢幕呈現閱讀器。
 * 不能用 NavigationLink 推入：`statusBarHidden` / `tabBarVisibility` 只對「全螢幕呈現頁的根」生效，
 * 推入的子頁會被導覽容器吃掉，狀態列照樣顯示。
 */
export async function presentReader({ refreshChapters = false, ...props }: ReaderLaunch): Promise<void> {
  await Navigation.present({
    element: refreshChapters ? <ResumeReader {...props} /> : <ReaderScreen {...props} />,
    modalPresentationStyle: "fullScreen",
  })
}

/** 抓好續讀計畫後直接以全螢幕呈現閱讀器；失敗只跳 toast，不打斷使用者原本的頁面。 */
export async function launchResumeReader(ref: ComicRef) {
  try {
    const plan = await comicLibrary().resumePlan(ref)
    if ("reason" in plan) {
      showToast(
        plan.reason === "noChapters"
          ? t("reader.noChapters")
          : plan.reason === "allLocked"
            ? t("reader.chapterUnavailable")
            : plan.message
      )
      return
    }

    // 以全螢幕模式直開閱讀器，退出時直接 dismiss 回到原位
    await presentReader({
      sourceKey: ref.sourceKey,
      comicId: ref.comicId,
      epId: plan.epId,
      chapters: plan.chapters,
      comicTitle: plan.comicTitle,
      comicCover: plan.comicCover,
      initialPage: plan.page,
      refreshChapters: plan.refreshChapters,
      viewer: plan.viewer,
    })
  } catch (err) {
    showToast(err instanceof Error ? err.message : t("reader.readerFailed"))
  }
}
