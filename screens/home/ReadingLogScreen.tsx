// 閱讀紀錄：從 Mini Hub 的熱力圖推進來。依日期分組（新的在上），標題右側是當天讀完的話數；
// 一部作品一張卡，點進詳情。

import { HStack, LazyVStack, NavigationLink, ScrollView, Spacer, Text, VStack, ZStack } from "scripting"

import { comicLibrary } from "../../app/services"
import { PageBackground } from "../../app/theme"
import { useSubscription } from "../../app/useSubscription"
import { ComicListRow } from "../../components/ComicListRow"
import { scrollTopBar } from "../../design/glass"
import { Card, GroupHeader } from "../../design/layout"
import { EmptyState } from "../../design/status"
import { cardGap } from "../../design/tokens"
import { getLocale, subscribe as subscribeLocale, t } from "../../i18n"
import { dayKey, readingActivity, subscribeLibrary, type DayComic } from "../../library/bookshelf"
import { ComicDetailScreen } from "../shared/ComicDetailScreen"

const DAY_MS = 24 * 60 * 60 * 1000

export interface LogDay {
  day: string
  /** 當天讀完的話數。 */
  chapters: number
  comics: DayComic[]
}

/** 有作品清單的日子，新的在前；每天裡最後讀的在前。 */
function logDays(): LogDay[] {
  return Object.entries(readingActivity())
    .filter(([, activity]) => (activity.comics?.length ?? 0) > 0)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, activity]) => ({ day, chapters: activity.chapters, comics: [...(activity.comics ?? [])].reverse() }))
}

/** 只碰一話就顯示話名；好幾話顯示話數與最後讀的那話（話名格式各源不一，排不出範圍）。 */
function episodeSummary(epTitles: string[]): string | null {
  if (epTitles.length <= 1) return epTitles[0] || null
  return t("home.miniHub.episodes", { n: epTitles.length, last: epTitles[epTitles.length - 1] })
}

/** 今天／昨天走 `Intl.RelativeTimeFormat`，其他日子顯示月日與星期。 */
function formatDay(day: string): string {
  const locale = getLocale()
  const now = Date.now()
  const offset = day === dayKey(now) ? 0 : day === dayKey(now - DAY_MS) ? -1 : null
  if (offset !== null) {
    // 英文給的是小寫「today」，當標題要首字大寫。
    const label = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(offset, "day")
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1)
  }
  const [year, month, date] = day.split("-").map(Number)
  const when = new Date(year, month - 1, date)
  const sameYear = year === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(locale, {
    year: sameYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(when)
}

export function ReadingLogScreen() {
  useSubscription(subscribeLibrary, comicLibrary().onChange, subscribeLocale)
  return <ReadingLogView days={logDays()} />
}

/** 只排版（預覽可以直接餵假資料）。 */
export function ReadingLogView({ days }: { days: LogDay[] }) {
  return (
    <ZStack>
      <PageBackground />
      <ScrollView
        scrollContentBackground="hidden"
        navigationTitle={t("home.miniHub.activityTitle")}
        navigationBarTitleDisplayMode="inline"
        {...scrollTopBar(null)}
      >
        {days.length === 0 ? (
          <EmptyState
            variant="page"
            icon="calendar"
            title={t("bookshelf.emptyHistoryTitle")}
            detail={t("bookshelf.emptyHistoryDetail")}
          />
        ) : (
          <LazyVStack spacing={22} padding={{ horizontal: 16, vertical: 12 }}>
            {days.map(({ day, chapters, comics }) => (
              <VStack key={day} spacing={cardGap} alignment="leading" frame={{ maxWidth: "infinity" }}>
                <HStack alignment="firstTextBaseline" padding={{ trailing: 4 }} frame={{ maxWidth: "infinity" }}>
                  <GroupHeader title={formatDay(day)} />
                  <Spacer />
                  {chapters > 0 ? (
                    <Text font="footnote" foregroundStyle="secondaryLabel">
                      {t("home.miniHub.dayChapters", { n: chapters })}
                    </Text>
                  ) : null}
                </HStack>
                {comics.map(comic => (
                  <NavigationLink
                    key={`${comic.sourceKey}:${comic.comicId}`}
                    destination={<ComicDetailScreen sourceKey={comic.sourceKey} comicId={comic.comicId} title={comic.title} />}
                    buttonStyle="plain"
                  >
                    <Card>
                      <ComicListRow
                        sourceKey={comic.sourceKey}
                        cover={comic.cover}
                        title={comic.title}
                        subtitle={episodeSummary(comic.epTitles)}
                      />
                    </Card>
                  </NavigationLink>
                ))}
              </VStack>
            ))}
          </LazyVStack>
        )}
      </ScrollView>
    </ZStack>
  )
}
