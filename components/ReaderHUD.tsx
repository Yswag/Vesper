import {
  Button,
  HStack,
  Image,
  Menu,
  Picker,
  Slider,
  Spacer,
  Text,
  Toggle,
  VStack,
  ZStack,
  useEffect,
  useObservable,
  useRef,
  useState,
} from "scripting"

type Observable<T> = ReturnType<typeof useObservable<T>>

import { t } from "../i18n"
import { capsule, fill, radius, rect, toneText } from "../design/tokens"
import type { ReaderSettings } from "../library/readerSettings"

/** 控制列滑入／滑出的彈性動畫 */
export const HUD_ANIM = Animation.spring({ duration: 0.32, bounce: 0 })
/**
 * HUD 面板收回時的位移量。
 * 只取「略大於面板高度」——取太大會讓動畫前段耗在螢幕外，看起來就會變成「先沒動、再衝進來」。
 */
export const HUD_SLIDE_TOP = 130
export const HUD_SLIDE_BOTTOM = 145

/** HUD 收起時右下角的「頁碼 · 時間」；時鐘自己走，不讓閱讀頁每分鐘重繪。 */
export function ReaderCornerInfo({
  visible,
  currentPage,
  pageCount,
  safeAreaInsets,
}: {
  visible: boolean
  currentPage: number
  pageCount: number
  safeAreaInsets: { bottom: number; trailing: number }
}) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const untilNextMinute = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds())
    const timer = setTimeout(() => setNow(new Date()), untilNextMinute)
    return () => {
      if (timer !== null) clearTimeout(timer)
    }
  }, [now])

  if (pageCount === 0) return null
  const pad = (value: number) => String(value).padStart(2, "0")
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`

  return (
    <VStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomTrailing" }}
      padding={{ trailing: safeAreaInsets.trailing + 12, bottom: Math.max(safeAreaInsets.bottom, 12) }}
      allowsHitTesting={false}
      opacity={visible ? 1 : 0}
      animation={{ animation: HUD_ANIM, value: visible }}
    >
      <Text
        font="caption2"
        fontWeight="medium"
        monospacedDigit={true}
        foregroundStyle="label"
        padding={{ horizontal: 8, vertical: 3 }}
        background={{ style: fill.coverScrim, shape: capsule() }}
      >
        {`${currentPage}/${pageCount} · ${time}`}
      </Text>
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
  /** 這本有沒有自己的閱讀設定（開關狀態）。 */
  perComic: boolean
  onTogglePerComic: (on: boolean) => void
  onDismiss: () => void
  onOpenChapterSheet: () => void
  onToggleHUD: () => void
  // 收藏（與詳情頁同一顆：寫的是本地書架）
  favorite: boolean
  onToggleFavorite: () => void
  // 底部進度與換話
  previousChapter?: ChapterSummary
  nextChapter?: ChapterSummary
  chapterIndex: number
  totalChapters: number
  onSelectChapter: (id: string) => void
  // 頁碼滑桿
  pageCount: number
  currentPage: number
  leadingPage: number | null
  scrubbing: boolean
  scrubValue: Observable<number>
  onScrubStart: () => void
  onScrubCommit: () => void
}

/**
 * 閱讀器 HUD 覆蓋層：包含全螢幕點擊遮罩、頂部工具列（返回、標題、目錄按鈕、閱讀設定 Menu）與底部工具列（前後話切換、頁碼拖曳 Slider、收藏）。
 */
export function ReaderHUD({
  hudVisible,
  safeAreaInsets,
  comicTitle,
  chapterTitle,
  settings,
  onUpdateSettings,
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
  currentPage,
  leadingPage,
  scrubbing,
  scrubValue,
  onScrubStart,
  onScrubCommit,
}: ReaderHUDProps) {
  const lastPage = Math.max(pageCount - 1, 0)
  const clampPage = (value: number) => Math.min(Math.max(Math.round(value), 0), lastPage)

  // 拖動時每換一頁輕震一下；按下的第一個值只當起點。
  const scrubPage = clampPage(scrubValue.value)
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
      {/* 1. 最底層：全螢幕半透明遮罩（點擊收起 HUD） */}
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

      {/* 2. Top HUD 定位層 */}
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
          glassEffect={{ glass: UIGlass.regular(), shape: rect(radius.xl) }}
          ignoresSafeArea={true}
          frame={{ maxWidth: "infinity" }}
          offset={{ x: 0, y: hudVisible.value ? 0 : -HUD_SLIDE_TOP }}
          opacity={hudVisible.value ? 1 : 0}
          animation={{ animation: HUD_ANIM, value: hudVisible.value }}
        >
          {/* 頂部內容區塊 */}
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
              {/* 標題居中層：以螢幕物理中心為準嚴格置中，兩側夾 padding 避開按鈕 */}
              <VStack alignment="center" spacing={2} padding={{ horizontal: 96 }}>
                <Text font="headline" fontWeight="bold" foregroundStyle="label" lineLimit={1}>
                  {comicTitle}
                </Text>
                <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                  {chapterTitle}
                </Text>
              </VStack>

              {/* 兩側按鈕層：左返回、右選單 */}
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

                  <Menu
                    accessibilityLabel={t("reader.readingSettings")}
                    label={
                      <Image
                        frame={{ width: 44, height: 44 }}
                        systemName="gearshape"
                        font="subheadline"
                        fontWeight="medium"
                        foregroundStyle="label"
                      />
                    }
                  >
                    {/* 預設跟隨源宣告（再退全域）；打開才把這本記成獨立設定。 */}
                    <Toggle
                      title={t("reader.perComic")}
                      systemImage="pin"
                      value={perComic}
                      onChanged={onTogglePerComic}
                    />

                    <Picker
                      title={t("reader.mode")}
                      value={settings.mode}
                      pickerStyle="segmented"
                      onChanged={(mode: string | number) =>
                        onUpdateSettings({ mode: mode === "gallery" ? "gallery" : "continuous" })
                      }
                    >
                      <Text tag="gallery">{t("reader.modeGallery")}</Text>
                      <Text tag="continuous">{t("reader.modeContinuous")}</Text>
                    </Picker>

                    <Picker
                      title={t("reader.direction")}
                      value={settings.direction}
                      pickerStyle="menu"
                      onChanged={(direction: string | number) =>
                        onUpdateSettings({
                          direction: direction === "ltr" || direction === "rtl" ? direction : "ttb",
                        })
                      }
                    >
                      <Text tag="ltr">{t("reader.directionLtr")}</Text>
                      <Text tag="rtl">{t("reader.directionRtl")}</Text>
                      <Text tag="ttb">{t("reader.directionTtb")}</Text>
                    </Picker>

                    {/* 縱向閱讀沒有三分區翻頁；選單列沒有第二行放提示，就接在標題後面。 */}
                    <Toggle
                      title={
                        settings.direction === "ttb"
                          ? `${t("reader.tapZones")}${t("reader.gestureHint")}`
                          : t("reader.tapZones")
                      }
                      systemImage="hand.tap"
                      disabled={settings.direction === "ttb"}
                      value={settings.tapZones && settings.direction !== "ttb"}
                      onChanged={value => {
                        if (settings.direction !== "ttb") onUpdateSettings({ tapZones: value })
                      }}
                    />

                    <Toggle
                      title={t("reader.hardwareSharpen")}
                      systemImage="sparkles"
                      value={settings.hardwareSharpen}
                      onChanged={value => onUpdateSettings({ hardwareSharpen: value })}
                    />
                  </Menu>
                </HStack>
              </HStack>
            </ZStack>
          </VStack>
        </VStack>
      </VStack>

      {/* 3. 底部 HUD 定位層 */}
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
          glassEffect={{ glass: UIGlass.regular(), shape: rect(radius.xl) }}
          frame={{ maxWidth: "infinity" }}
          ignoresSafeArea={true}
          offset={{ x: 0, y: hudVisible.value ? 0 : HUD_SLIDE_BOTTOM }}
          opacity={hudVisible.value ? 1 : 0}
          animation={{ animation: HUD_ANIM, value: hudVisible.value }}
        >
          {/* 主控制區塊（整合頁碼、Slider 與換話列） */}
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
            {/* 換話快捷控制欄 */}
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

            {/* 拖曳翻頁 Slider（含實時頁碼反饋） */}
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
                      onScrubStart()
                      scrubValue.setValue(clampPage(leadingPage ?? 0))
                    } else {
                      onScrubCommit()
                    }
                  }}
                />
              ) : null}

              {/* 頁碼維持置中（以面板中心為準，跟頂部 HUD 的標題同一個套路），收藏貼齊右緣。 */}
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
                      // 高度取 32 配合緊湊進度膠囊面板高度
                      frame={{ width: 44, height: 32 }}
                      foregroundStyle={favorite ? toneText.love : "label"}
                    />
                  </Button>
                </HStack>
              </ZStack>
            </VStack>
          </VStack>

          {/* HUD 底部留白：面板踩在 Home Indicator 上 */}
          <VStack frame={{ height: 14, maxWidth: "infinity" }} />
        </VStack>
      </VStack>
    </ZStack>
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
