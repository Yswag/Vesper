import {
  Button,
  HStack,
  Image,
  Slider,
  Spacer,
  Text,
  VStack,
  ZStack,
  useEffect,
  useObservable,
  useRef,
  useState,
} from "scripting"

type Observable<T> = ReturnType<typeof useObservable<T>>

import { t } from "../i18n"
import { glass } from "../design/glass"
import { usePageSignal, type PageSignal } from "./pageSignal"
import { ReaderSettingsSheet } from "./ReaderSettingsSheet"
import { capsule, fill, radius, rect, toneText } from "../design/tokens"
import type { ReaderSettings } from "../library/readerSettings"

export const HUD_ANIM = Animation.spring({ duration: 0.32, bounce: 0 })
export const HUD_SLIDE_TOP = 130
export const HUD_SLIDE_BOTTOM = 145

function CornerText({ children }: { children: string }) {
  return (
    <Text font="caption2" fontWeight="medium" monospacedDigit={true} foregroundStyle="label">
      {children}
    </Text>
  )
}

function batteryPercent(level: number): string | null {
  return level < 0 ? null : `${Math.round(level * 100)}%`
}

export function ReaderCornerInfo({
  visible,
  showPage,
  showTime,
  currentPage,
  pageCount,
  safeAreaInsets,
}: {
  visible: boolean
  showPage: boolean
  showTime: boolean
  currentPage: number
  pageCount: number
  safeAreaInsets: { bottom: number; trailing: number }
}) {
  const [now, setNow] = useState(() => new Date())
  const [battery, setBattery] = useState(() => ({
    level: Device.batteryLevel,
    state: Device.batteryState,
  }))

  useEffect(() => {
    if (!showTime) return
    if (Date.now() - now.getTime() > 1000) {
      setNow(new Date())
      return
    }
    const untilNextMinute = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds())
    const timer = setTimeout(() => setNow(new Date()), untilNextMinute)
    return () => {
      if (timer !== null) clearTimeout(timer)
    }
  }, [now, showTime])

  useEffect(() => {
    if (!showTime) return
    const sync = () => setBattery({ level: Device.batteryLevel, state: Device.batteryState })
    const onLevel = (level: number) => setBattery(current => ({ ...current, level }))
    const onState = (state: Device.BatteryState) => setBattery(current => ({ ...current, state }))
    sync()
    Device.addBatteryLevelListener(onLevel)
    Device.addBatteryStateListener(onState)
    return () => {
      Device.removeBatteryLevelListener(onLevel)
      Device.removeBatteryStateListener(onState)
    }
  }, [showTime, visible])

  const pageText = showPage && pageCount > 0 ? `${currentPage}/${pageCount}` : null
  if (!pageText && !showTime) return null

  const pad = (value: number) => String(value).padStart(2, "0")
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const percent = showTime ? batteryPercent(battery.level) : null
  const charging = percent !== null && (battery.state === "charging" || battery.state === "full")

  return (
    <VStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomTrailing" }}
      padding={{ trailing: safeAreaInsets.trailing + 12, bottom: Math.max(safeAreaInsets.bottom, 12) }}
      allowsHitTesting={false}
      opacity={visible ? 1 : 0}
      animation={{ animation: HUD_ANIM, value: visible }}
    >
      <HStack
        spacing={0}
        padding={{ horizontal: 8, vertical: 3 }}
        background={{ style: fill.coverScrim, shape: capsule() }}
      >
        {pageText ? <CornerText>{pageText}</CornerText> : null}
        {pageText && showTime ? <CornerText>{" · "}</CornerText> : null}
        {showTime ? <CornerText>{time}</CornerText> : null}
        {percent ? <CornerText>{" · "}</CornerText> : null}
        {percent ? (
          <HStack spacing={2}>
            {charging ? <Image systemName="bolt.fill" font="caption2" fontWeight="semibold" foregroundStyle="label" /> : null}
            <CornerText>{percent}</CornerText>
          </HStack>
        ) : null}
      </HStack>
    </VStack>
  )
}

export interface ChapterSummary {
  id: string
  title: string
}

export interface ReaderHUDProps {
  hudVisible: Observable<boolean>
  safeAreaInsets: {
    top: number
    bottom: number
    leading: number
    trailing: number
  }
  comicTitle: string
  chapterTitle: string
  settings: ReaderSettings
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void
  canUpscale: boolean
  perComic: boolean
  onTogglePerComic: (on: boolean) => void
  onDismiss: () => void
  onOpenChapterSheet: () => void
  onToggleHUD: () => void
  favorite: boolean
  onToggleFavorite: () => void
  previousChapter?: ChapterSummary
  nextChapter?: ChapterSummary
  chapterIndex: number
  totalChapters: number
  onSelectChapter: (id: string) => void
  pageCount: number
  leadingPage: PageSignal
  onScrubCommit: (page: number) => void
}

export function ReaderHUD({
  hudVisible,
  safeAreaInsets,
  comicTitle,
  chapterTitle,
  settings,
  onUpdateSettings,
  canUpscale,
  perComic,
  onTogglePerComic,
  onDismiss,
  onOpenChapterSheet,
  onToggleHUD,
  favorite,
  onToggleFavorite,
  previousChapter,
  nextChapter,
  chapterIndex,
  totalChapters,
  onSelectChapter,
  pageCount,
  leadingPage,
  onScrubCommit,
}: ReaderHUDProps) {
  const [showSettings, setShowSettings] = useState(false)

  return (
    <ZStack
      alignment="top"
      frame={{
        maxWidth: "infinity",
        maxHeight: "infinity",
      }}
      ignoresSafeArea={true}
      allowsHitTesting={hudVisible.value}
      zIndex={100}
    >
      {}
      <VStack
        spacing={0}
        frame={{
          maxWidth: "infinity",
          maxHeight: "infinity",
        }}
        background={fill.scrimSoft}
        opacity={hudVisible.value ? 1 : 0}
        allowsHitTesting={hudVisible.value}
        onTapGesture={onToggleHUD}
        animation={{ animation: HUD_ANIM, value: hudVisible.value }}
        zIndex={0}
      />

      {}
      <VStack
        spacing={0}
        frame={{
          maxWidth: "infinity",
          maxHeight: "infinity",
          alignment: "top",
        }}
        allowsHitTesting={hudVisible.value}
        zIndex={2}
      >
        <VStack
          spacing={0}
          environments={{ colorScheme: "dark" }}
          {...glass({ shape: rect(radius.xl), fallback: "regularMaterial" })}
          ignoresSafeArea={true}
          frame={{ maxWidth: "infinity" }}
          offset={{ x: 0, y: hudVisible.value ? 0 : -HUD_SLIDE_TOP }}
          opacity={hudVisible.value ? 1 : 0}
          animation={{ animation: HUD_ANIM, value: hudVisible.value }}
        >
          {}
          <VStack
            spacing={0}
            padding={{
              top: safeAreaInsets.top + 4,
              leading: safeAreaInsets.leading + 16,
              trailing: safeAreaInsets.trailing + 16,
              bottom: 12,
            }}
            frame={{ maxWidth: "infinity" }}
          >
            <ZStack alignment="center" frame={{ maxWidth: "infinity" }}>
              {}
              <VStack alignment="center" spacing={2} padding={{ horizontal: 96 }}>
                <Text font="headline" fontWeight="bold" foregroundStyle="label" lineLimit={1}>
                  {comicTitle}
                </Text>
                <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                  {chapterTitle}
                </Text>
              </VStack>

              {}
              <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
                <Button action={onDismiss} buttonStyle="plain" accessibilityLabel={t("reader.backToDetails")}>
                  <Image systemName="chevron.left" font="body" frame={{ width: 44, height: 44 }} foregroundStyle="label" />
                </Button>

                <Spacer />

                <HStack spacing={4} alignment="center">
                  <Button
                    buttonStyle="plain"
                    accessibilityLabel={t("reader.chaptersTitle")}
                    action={onOpenChapterSheet}
                  >
                    <Image
                      frame={{ width: 44, height: 44 }}
                      systemName="list.bullet"
                      font="subheadline"
                      fontWeight="medium"
                      foregroundStyle="label"
                    />
                  </Button>

                  <Button
                    buttonStyle="plain"
                    accessibilityLabel={t("reader.readingSettings")}
                    action={() => setShowSettings(true)}
                    sheet={{
                      isPresented: showSettings,
                      onChanged: setShowSettings,
                      content: (
                        <ReaderSettingsSheet
                          settings={settings}
                          onUpdateSettings={onUpdateSettings}
                          canUpscale={canUpscale}
                          perComic={perComic}
                          onTogglePerComic={onTogglePerComic}
                        />
                      ),
                    }}
                  >
                    <Image
                      frame={{ width: 44, height: 44 }}
                      systemName="gearshape"
                      font="subheadline"
                      fontWeight="medium"
                      foregroundStyle="label"
                    />
                  </Button>
                </HStack>
              </HStack>
            </ZStack>
          </VStack>
        </VStack>
      </VStack>

      {}
      <VStack
        spacing={0}
        frame={{
          maxWidth: "infinity",
          maxHeight: "infinity",
          alignment: "bottom",
        }}
        allowsHitTesting={hudVisible.value}
        zIndex={2}
      >
        <VStack
          spacing={0}
          environments={{ colorScheme: "dark" }}
          {...glass({ shape: rect(radius.xl), fallback: "regularMaterial" })}
          frame={{ maxWidth: "infinity" }}
          ignoresSafeArea={true}
          offset={{ x: 0, y: hudVisible.value ? 0 : HUD_SLIDE_BOTTOM }}
          opacity={hudVisible.value ? 1 : 0}
          animation={{ animation: HUD_ANIM, value: hudVisible.value }}
        >
          {}
          <VStack
            spacing={12}
            padding={{
              top: 14,
              leading: safeAreaInsets.leading + 20,
              trailing: safeAreaInsets.trailing + 20,
              bottom: 4,
            }}
            frame={{ maxWidth: "infinity" }}
          >
            {}
            <HStack spacing={8} alignment="center" frame={{ maxWidth: "infinity" }}>
              <HStack frame={{ maxWidth: "infinity", alignment: "leading" }}>
                {previousChapter ? (
                  <ChapterLink
                    chapter={previousChapter}
                    label={t("reader.previousChapter")}
                    systemImage="backward.fill"
                    onSelect={onSelectChapter}
                  />
                ) : (
                  <ChapterLinkDisabled label={t("reader.atFirstChapter")} systemImage="backward.fill" />
                )}
              </HStack>

              <Text
                font="caption"
                fontWeight="semibold"
                foregroundStyle="secondaryLabel"
                monospacedDigit={true}
                frame={{ maxWidth: "infinity", alignment: "center" }}
              >
                {t("reader.chapterProgress", { index: chapterIndex, total: totalChapters })}
              </Text>

              <HStack frame={{ maxWidth: "infinity", alignment: "trailing" }}>
                {nextChapter ? (
                  <ChapterLink
                    chapter={nextChapter}
                    label={t("reader.nextChapter")}
                    systemImage="forward.fill"
                    isTrailingIcon={true}
                    onSelect={onSelectChapter}
                  />
                ) : (
                  <ChapterLinkDisabled label={t("reader.atLastChapter")} systemImage="forward.fill" isTrailingIcon={true} />
                )}
              </HStack>
            </HStack>

            {}
            <ReaderScrubber
              pageCount={pageCount}
              leadingPage={leadingPage}
              onScrubCommit={onScrubCommit}
              favorite={favorite}
              onToggleFavorite={onToggleFavorite}
            />
          </VStack>

          {}
          <VStack frame={{ height: 14, maxWidth: "infinity" }} />
        </VStack>
      </VStack>
    </ZStack>
  )
}

function ReaderScrubber({
  pageCount,
  leadingPage,
  onScrubCommit,
  favorite,
  onToggleFavorite,
}: {
  pageCount: number
  leadingPage: PageSignal
  onScrubCommit: (page: number) => void
  favorite: boolean
  onToggleFavorite: () => void
}) {
  const lead = usePageSignal(leadingPage)
  const [scrubbing, setScrubbing] = useState(false)
  const scrubValue = useObservable(0)
  const lastPage = Math.max(pageCount - 1, 0)
  const clampPage = (value: number) => Math.min(Math.max(Math.round(value), 0), lastPage)
  const currentPage = lead !== null ? Math.min(Math.max(lead + 1, 1), Math.max(pageCount, 1)) : 1
  const scrubPage = clampPage(scrubValue.value)

  useEffect(() => {
    if (!scrubbing) scrubValue.setValue(clampPage(lead ?? 0))
  }, [lead, scrubbing, pageCount])

  const lastScrubPageRef = useRef<number | null>(null)
  useEffect(() => {
    if (!scrubbing) {
      lastScrubPageRef.current = null
      return
    }
    const last = lastScrubPageRef.current
    if (last !== null && last !== scrubPage) HapticFeedback.selection()
    lastScrubPageRef.current = scrubPage
  }, [scrubbing, scrubPage])

  return (
    <VStack spacing={6} frame={{ maxWidth: "infinity" }}>
      {pageCount > 1 ? (
        <Slider
          min={0}
          max={lastPage}
          step={1}
          value={scrubValue}
          accessibilityLabel={t("reader.dragToTurn")}
          onEditingChanged={editing => {
            if (editing) {
              setScrubbing(true)
              scrubValue.setValue(clampPage(lead ?? 0))
            } else {
              setScrubbing(false)
              onScrubCommit(clampPage(scrubValue.value))
            }
          }}
        />
      ) : null}

      {}
      <ZStack alignment="center" frame={{ maxWidth: "infinity" }}>
        {pageCount > 1 ? (
          <Text font="caption2" fontWeight="medium" foregroundStyle="secondaryLabel">
            {t("reader.pageProgress", {
              page: scrubbing ? scrubPage + 1 : currentPage,
              total: pageCount,
            })}
          </Text>
        ) : null}

        <HStack frame={{ maxWidth: "infinity", alignment: "trailing" }}>
          <Button
            action={onToggleFavorite}
            buttonStyle="plain"
            accessibilityLabel={favorite ? t("detail.unfavorite") : t("detail.favorite")}
          >
            <Image
              systemName={favorite ? "heart.fill" : "heart"}
              font="subheadline"
              fontWeight="medium"
              frame={{ width: 44, height: 32 }}
              foregroundStyle={favorite ? toneText.love : "label"}
            />
          </Button>
        </HStack>
      </ZStack>
    </VStack>
  )
}

function ChapterLink({
  chapter,
  label,
  systemImage,
  isTrailingIcon = false,
  onSelect,
}: {
  chapter: ChapterSummary
  label: string
  systemImage?: string
  isTrailingIcon?: boolean
  onSelect: (epId: string) => void
}) {
  const select = () => onSelect(chapter.id)
  return (
    <Button
      action={select}
      buttonStyle="plain"
      accessibilityLabel={t("reader.chapterLinkLabel", { label, title: chapter.title })}
    >
      <HStack frame={{ minHeight: 44 }} spacing={5} alignment="center" contentShape="rect">
        {systemImage && !isTrailingIcon ? (
          <Image systemName={systemImage} font="caption2" foregroundStyle="label" />
        ) : null}
        <Text font="subheadline" fontWeight="medium" foregroundStyle="label" lineLimit={1}>
          {label}
        </Text>
        {systemImage && isTrailingIcon ? (
          <Image systemName={systemImage} font="caption2" foregroundStyle="label" />
        ) : null}
      </HStack>
    </Button>
  )
}

function ChapterLinkDisabled({
  label,
  systemImage,
  isTrailingIcon = false,
}: {
  label: string
  systemImage: string
  isTrailingIcon?: boolean
}) {
  return (
    <Button action={() => {}} buttonStyle="plain" disabled={true} accessibilityLabel={label}>
      <HStack spacing={5} frame={{ minHeight: 44 }} foregroundStyle="tertiaryLabel">
        {!isTrailingIcon ? <Image systemName={systemImage} font="caption2" /> : null}
        <Text font="subheadline" lineLimit={1}>
          {label}
        </Text>
        {isTrailingIcon ? <Image systemName={systemImage} font="caption2" /> : null}
      </HStack>
    </Button>
  )
}
