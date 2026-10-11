// 續讀入口：首頁的續讀卡與書架的閱讀歷史列都走這裡，**不經詳情頁**直接開全螢幕閱讀器。
//
// 為什麼是 present 而不是推入：閱讀器要吃掉整個螢幕（含 tab bar），
// 而且在卡片點下去的當下就在背景把章節清單抓好，好了直接彈出、退出就回原位，
// 不會先閃一個「過渡頁」再跳第二次。
//
// 章節清單與續讀頁都問 ComicLibrary（它自己會處理離線／快取／源的差異）。

import { Navigation } from "scripting"

import { comicLibrary } from "../../app/services"
import { showToast } from "../../app/toast"
import { t } from "../../i18n"
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

    const resumed = library.resume({ sourceKey, comicId })
    const wantedEpId = resumed?.chapter.epId ?? epId
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
