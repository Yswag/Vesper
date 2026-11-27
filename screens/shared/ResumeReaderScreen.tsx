import { Navigation, useEffect, useRef, useState } from "scripting"

import type { ComicRef } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { showToast } from "../../app/toast"
import { mergeChapterList, type ReaderChapter } from "../../engine/offline"
import { t } from "../../i18n"
import { ReaderScreen, type ReaderProps } from "./ReaderScreen"

export function resumeFallbackOf(chapters: ReaderChapter[], epId: string): ReaderChapter | null {
  const wanted = chapters.find(chapter => chapter.id === epId)
  if (wanted && !wanted.locked) return null
  const fallback = chapters.find(chapter => !chapter.locked)
  if (!fallback || fallback.id === epId) return null
  return fallback
}

function ResumeReader({ chapters: initialChapters, initialPage, ...props }: ReaderProps) {
  const [chapters, setChapters] = useState(initialChapters)
  const [target, setTarget] = useState({ epId: props.epId, page: initialPage })
  const targetRef = useRef(target)
  targetRef.current = target
  const { sourceKey, comicId } = props

  useEffect(() => {
    let alive = true
    const library = comicLibrary()
    void library
      .comic({ sourceKey, comicId })
      .then(page => {
        if (!alive) return
        const fresh = mergeChapterList(library.readerChapters(page), sourceKey, comicId)
        if (fresh.length === 0) return
        const current = targetRef.current.epId
        const fallback = resumeFallbackOf(fresh, current)
        if (fallback) {
          setTarget({ epId: fallback.id, page: undefined })
          setChapters(fresh)
          return
        }
        setChapters(previous => {
          if (fresh.some(chapter => chapter.id === current)) return fresh
          const kept = previous.find(chapter => chapter.id === current)
          return kept ? [kept, ...fresh] : fresh
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [sourceKey, comicId])

  return (
    <ReaderScreen
      key={target.epId}
      {...props}
      epId={target.epId}
      initialPage={target.page}
      chapters={chapters}
    />
  )
}

export interface ReaderLaunch extends ReaderProps {
  refreshChapters?: boolean
}

export async function presentReader({ refreshChapters = false, ...props }: ReaderLaunch): Promise<void> {
  await Navigation.present({
    element: refreshChapters ? <ResumeReader {...props} /> : <ReaderScreen {...props} />,
    modalPresentationStyle: "fullScreen",
  })
}

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
