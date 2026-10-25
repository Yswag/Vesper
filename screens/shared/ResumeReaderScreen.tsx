// 續讀入口：首頁的續讀卡與書架的閱讀歷史列都走這裡，**不經詳情頁**直接開全螢幕閱讀器。
//
// 為什麼是 present 而不是推入：閱讀器要吃掉整個螢幕（含 tab bar），
// 而且在卡片點下去的當下就在背景把章節清單抓好，好了直接彈出、退出就回原位，
// 不會先閃一個「過渡頁」再跳第二次。
//
// 兩條路：
// - **先開再補**（這一筆上次是從本機檔讀的、而且那一話還在下載裡，見 `canResumeOffline`）：
//   馬上用本機快取開（沒有快取就退回已下載清單），不等網路；同時背景向源要最新清單，
//   成功就換上並覆寫快取，失敗就維持原樣、不打擾。飛航模式下照樣開得起來。
// - **線上**：章節清單與續讀頁都問 ComicLibrary（它自己會處理離線／快取／源的差異）。

import { Navigation, useEffect, useState } from "scripting"

import { canResumeOffline } from "../../app/offlineReading"
import { comicLibrary } from "../../app/services"
import { showToast } from "../../app/toast"
import { cachedChapterList, mergeChapterList } from "../../engine/offline"
import { t } from "../../i18n"
import { ReaderScreen, type ChapterRef, type ReaderProps } from "./ReaderScreen"

/**
 * 續讀專用的閱讀器：先用手上的清單開，背景補到最新就換上。
 * 換清單只換 `chapters`（開章 effect 不依賴它），所以正在讀的那一話與頁碼都不動。
 */
function ResumeReader({ chapters: initialChapters, ...props }: ReaderProps) {
  const [chapters, setChapters] = useState(initialChapters)
  const { sourceKey, comicId } = props

  useEffect(() => {
    let alive = true
    void comicLibrary()
      .comic({ sourceKey, comicId })
      // `comic()` 成功就把最新清單覆寫進快取（見 app/comic.ts），這裡再從快取讀回來合併：
      // 清單的形狀只有那裡知道，不重複一份映射。
      .then(() => {
        if (!alive) return
        setChapters(mergeChapterList(cachedChapterList(sourceKey, comicId), sourceKey, comicId))
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

export interface LaunchResumeReaderParams {
  sourceKey: string
  comicId: string
  epId?: string
  page?: number
  title: string
  cover?: string
}

/** 抓好章節清單後直接以全螢幕呈現閱讀器；失敗只跳 toast，不打斷使用者原本的頁面。 */
export async function launchResumeReader({
  sourceKey,
  comicId,
  epId,
  page,
  title,
  cover,
}: LaunchResumeReaderParams) {
  try {
    const library = comicLibrary()
    const resumed = library.resume({ sourceKey, comicId })
    const wantedEpId = resumed?.chapter.epId ?? epId

    // 先開再補：上次是從本機檔讀的、那一話也還在下載裡 → 不等網路，用本機清單直接開。
    // 這是「下載了卻被續讀拉回線上（飛航模式下甚至拉不起來）」的那個修正；
    // 下載被刪掉時 `canResumeOffline` 回 false，很自然地往下走線上那條。
    if (wantedEpId !== undefined && canResumeOffline({ sourceKey, comicId, epId: wantedEpId }, resumed?.offline)) {
      await presentReader({
        sourceKey,
        comicId,
        epId: wantedEpId,
        chapters: mergeChapterList(cachedChapterList(sourceKey, comicId), sourceKey, comicId),
        comicTitle: title,
        comicCover: cover,
        initialPage: resumed?.page ?? page,
        refreshChapters: true,
      })
      return
    }

    const comicPage = await library.comic({ sourceKey, comicId })
    const chapters: ChapterRef[] = comicPage.chapters.map(chapter => ({
      id: chapter.ref.epId,
      // 連標題都拿不到時的替代字：沿用詳情頁章節列的同一個 key（同一件事同一句話）。
      title: chapter.title || chapter.group || t("detail.singleChapter"),
      group: chapter.group,
      locked: chapter.locked,
    }))

    if (chapters.length === 0) {
      showToast(t("reader.noChapters"))
      return
    }

    const targetEpId = chapters.some(ch => ch.id === wantedEpId && !ch.locked)
      ? wantedEpId
      : chapters.find(ch => !ch.locked)?.id

    if (!targetEpId) {
      showToast(t("reader.chapterUnavailable"))
      return
    }

    const targetPage = targetEpId === wantedEpId ? resumed?.page ?? page : undefined

    // 以全螢幕模式直開閱讀器，退出時直接 dismiss 回到原位
    await presentReader({
      sourceKey,
      comicId,
      epId: targetEpId,
      chapters,
      comicTitle: title,
      comicCover: cover,
      initialPage: targetPage,
      viewer: comicPage.viewer,
    })
  } catch (err) {
    showToast(err instanceof Error ? err.message : t("reader.readerFailed"))
  }
}
