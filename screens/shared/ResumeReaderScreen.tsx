// 續讀入口：首頁的續讀卡與書架的閱讀歷史列都走這裡，**不經詳情頁**直接開全螢幕閱讀器。
//
// 為什麼是 present 而不是推入：閱讀器要吃掉整個螢幕（含 tab bar），
// 而且在卡片點下去的當下就在背景把章節清單抓好，好了直接彈出、退出就回原位，
// 不會先閃一個「過渡頁」再跳第二次。
//
// 兩條路：
// - **離線**（這一筆上次是在離線模式讀的、而且那一話還在下載裡，見 `canResumeOffline`）：
//   章節清單與頁面都只讀離線 manifest，**完全不碰源**——所以在飛航模式下、甚至源被移除都開得起來。
// - **線上**：章節清單與續讀頁都問 ComicLibrary（它自己會處理離線／快取／源的差異）。

import { Navigation } from "scripting"

import { comicLibrary } from "../../app/services"
import { showToast } from "../../app/toast"
import { chaptersForReader } from "../../engine/offline"
import { t } from "../../i18n"
import { canResumeOffline } from "./offlineSession"
import { ReaderScreen, type ChapterRef } from "./ReaderScreen"

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

    // 離線優先：上次是在離線模式讀的、那一話也還在下載裡，就直接開離線閱讀器。
    // 這是「下載了卻被續讀拉回線上（飛航模式下甚至拉不起來）」的那個修正；
    // 下載被刪掉時 `canResumeOffline` 回 false，很自然地往下走線上那條。
    if (wantedEpId !== undefined && canResumeOffline({ sourceKey, comicId, epId: wantedEpId }, resumed?.offline)) {
      await Navigation.present({
        element: (
          <ReaderScreen
            sourceKey={sourceKey}
            comicId={comicId}
            epId={wantedEpId}
            chapters={chaptersForReader(sourceKey, comicId)}
            comicTitle={title}
            comicCover={cover}
            initialPage={resumed?.page ?? page}
            offlineMode={true}
          />
        ),
        modalPresentationStyle: "fullScreen",
      })
      return
    }

    const comicPage = await library.comic({ sourceKey, comicId })
    const chapters: ChapterRef[] = comicPage.chapters.map(chapter => ({
      id: chapter.ref.epId,
      // 連標題都拿不到時的替代字：沿用詳情頁章節列的同一個 key（同一件事同一句話）。
      title: chapter.title || chapter.group || t("detail.singleChapter"),
      group: chapter.group,
    }))

    if (chapters.length === 0) {
      showToast(t("reader.noChapters"))
      return
    }

    const targetEpId = chapters.some(ch => ch.id === wantedEpId) ? wantedEpId : chapters[0]?.id

    if (!targetEpId) {
      showToast(t("reader.chapterUnavailable"))
      return
    }

    const targetPage = targetEpId === wantedEpId ? resumed?.page ?? page : undefined

    // 以全螢幕模式直開閱讀器，退出時直接 dismiss 回到原位
    await Navigation.present({
      element: (
        <ReaderScreen
          sourceKey={sourceKey}
          comicId={comicId}
          epId={targetEpId}
          chapters={chapters}
          comicTitle={title}
          comicCover={cover}
          initialPage={targetPage}
        />
      ),
      modalPresentationStyle: "fullScreen",
    })
  } catch (err) {
    showToast(err instanceof Error ? err.message : t("reader.readerFailed"))
  }
}
