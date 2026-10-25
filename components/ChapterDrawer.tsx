import {
  Button,
  Divider,
  HStack,
  Image,
  RoundedRectangle,
  ScrollView,
  ScrollViewReader,
  Spacer,
  Text,
  VStack,
  ZStack,
  useMemo,
  useRef,
  useState,
  type ScrollViewProxy,
} from "scripting"

import type { ChapterGroup } from "../screens/shared/chapterGrouping"
import { useTint } from "../app/theme"
import { glass } from "../design/glass"
import { cardBackgroundStrong, radius, rect } from "../design/tokens"
import { t } from "../i18n"

export interface ChapterItem {
  id: string
  title: string
  group?: string
  /** 源標為鎖定：目錄看得到，不能點。 */
  locked?: boolean
}

export interface ChapterDrawerProps {
  currentEpId: string
  chapters: ChapterItem[]
  chapterGroups?: ChapterGroup<ChapterItem>[]
  isGrouped: boolean
  /** 這一話在不在手機上（目錄用它標示哪些話離線也讀得到）。 */
  isDownloaded?: (epId: string) => boolean
  onSelectChapter: (id: string) => void
  onClose: () => void
}

/**
 * 章節目錄抽屜：生命週期獨立組件。
 * 抽屜打開時 mount 並自動以普通 VStack + ScrollViewReader 執行一次無損定位；
 * 抽屜關閉時 unmount，不消耗主閱讀器任何狀態或幀率。
 */
export function ChapterDrawer({
  currentEpId,
  chapters,
  chapterGroups = [],
  isGrouped,
  isDownloaded,
  onSelectChapter,
  onClose,
}: ChapterDrawerProps) {
  const tint = useTint()
  // 分組選取：預設為包含當前話的分組
  const initialGroup = useMemo(() => {
    if (!isGrouped) return ""
    const g = chapterGroups.find((grp: ChapterGroup<ChapterItem>) => grp.chapters.some((c: ChapterItem) => c.id === currentEpId))
    return g ? g.name : (chapterGroups[0]?.name ?? "")
  }, [isGrouped, chapterGroups, currentEpId])

  const [activeGroup, setActiveGroup] = useState(initialGroup)
  // 目錄排序：預設正序
  const [reversed, setReversed] = useState(false)

  // 當前選取分組展示的章節
  const displayChapters = useMemo(() => {
    if (!isGrouped) return chapters
    const g = chapterGroups.find((grp: ChapterGroup<ChapterItem>) => grp.name === activeGroup)
    return g ? g.chapters : chapters
  }, [isGrouped, chapterGroups, activeGroup, chapters])

  // 保存當前 ScrollViewProxy 參照，供快速定位按鈕使用
  const scrollProxyRef = useRef<ScrollViewProxy | null>(null)

  return (
    <VStack
      spacing={0}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      environments={{ colorScheme: "dark" }}
      preferredColorScheme="dark"
      presentationBackground="clear"
      {...glass({ shape: rect(radius.xl), fallback: "regularMaterial" })}
      ignoresSafeArea={{ edges: "bottom" }}
      presentationDetents={["medium", "large"]}
      presentationDragIndicator="visible"
      presentationCornerRadius={24}
    >
      {/* 標題列 */}
      <HStack alignment="center" padding={{ top: 18, horizontal: 20, bottom: 12 }}>
        <VStack alignment="leading" spacing={2}>
          <Text font="headline" fontWeight="bold" foregroundStyle="label">
            {t("reader.chaptersTitle")}
          </Text>
          <Text font="caption2" foregroundStyle="secondaryLabel">
            {isGrouped
              ? `${displayChapters.length} / ${chapters.length}`
              : t("reader.chapterCount", { n: chapters.length })}
          </Text>
        </VStack>
        <Spacer />
        {/* 定位到當前話按鈕 */}
        <Button
          buttonStyle="plain"
          accessibilityLabel={t("reader.locateCurrent")}
          action={() => {
            scrollProxyRef.current?.scrollTo(currentEpId, "center")
          }}
        >
          <HStack spacing={4} frame={{ minHeight: 44 }} contentShape="rect">
            <Image
              systemName="scope"
              font="caption2"
              fontWeight="medium"
              foregroundStyle="secondaryLabel"
            />
            <Text font="caption" fontWeight="medium" foregroundStyle="secondaryLabel">
              {t("reader.locateCurrent")}
            </Text>
          </HStack>
        </Button>
        <Spacer frame={{ width: 10 }} />
        {/* 正序／倒序切換 */}
        <Button
          buttonStyle="plain"
          accessibilityLabel={reversed ? t("reader.sortAscending") : t("reader.sortDescending")}
          action={() => setReversed(r => !r)}
        >
          <HStack spacing={4} frame={{ minHeight: 44 }} contentShape="rect">
            <Image
              systemName="arrow.up.arrow.down"
              font="caption2"
              fontWeight="medium"
              foregroundStyle="secondaryLabel"
            />
            <Text font="caption" fontWeight="medium" foregroundStyle="secondaryLabel">
              {reversed ? t("reader.sortDescendingShort") : t("reader.sortAscendingShort")}
            </Text>
          </HStack>
        </Button>
        <Spacer frame={{ width: 10 }} />
        {/* 關閉按鈕 */}
        <Button
          buttonStyle="plain"
          accessibilityLabel={t("reader.closeChapters")}
          action={onClose}
        >
          <Image
            systemName="xmark"
            frame={{ width: 44, height: 44 }}
            contentShape="rect"
            font="subheadline"
            fontWeight="medium"
            foregroundStyle="secondaryLabel"
          />
        </Button>
      </HStack>

      <Divider />

      {/* 分組標籤列 */}
      {isGrouped ? (
        <VStack spacing={0}>
          <ScrollView axes="horizontal">
            <HStack spacing={8} padding={{ horizontal: 16, vertical: 10 }}>
              {chapterGroups.map((group: ChapterGroup<ChapterItem>) => {
                const isCurrent = group.name === activeGroup
                return (
                  <Button
                    key={group.name}
                    buttonStyle="plain"
                    action={() => setActiveGroup(group.name)}
                  >
                    <HStack
                      spacing={5}
                      padding={{ horizontal: 12, vertical: 6 }}
                      background={isCurrent ? tint.selected : cardBackgroundStrong}
                      clipShape={rect(radius.md)}
                      contentShape={rect(radius.md)}
                    >
                      <Text
                        font="caption"
                        fontWeight={isCurrent ? "semibold" : "regular"}
                        foregroundStyle={isCurrent ? tint.tint : "secondaryLabel"}
                        lineLimit={1}
                      >
                        {group.name}
                      </Text>
                      <Text
                        font="caption2"
                        fontWeight="medium"
                        foregroundStyle={isCurrent ? tint.tint : "tertiaryLabel"}
                      >
                        {group.chapters.length}
                      </Text>
                    </HStack>
                  </Button>
                )
              })}
            </HStack>
          </ScrollView>
          <Divider />
        </VStack>
      ) : null}

      {/* 章節清單：普通 VStack 滿幀滑動，由頂部「定位」按鈕一鍵跳轉 */}
      <ScrollView>
        <ScrollViewReader>
          {proxy => {
            scrollProxyRef.current = proxy
            const list = reversed ? [...displayChapters].reverse() : displayChapters
            return (
              <VStack spacing={8} padding={{ horizontal: 16, vertical: 12 }} frame={{ maxWidth: "infinity" }}>
                {list.map((ch: ChapterItem) => {
                  const isCurrent = ch.id === currentEpId
                  const onDevice = isDownloaded?.(ch.id) === true
                  return (
                    <ZStack key={ch.id} tag={ch.id} alignment="center" frame={{ maxWidth: "infinity" }}>
                      <HStack
                        alignment="center"
                        padding={{ horizontal: 14, vertical: 11 }}
                        background={isCurrent ? tint.highlight : "clear"}
                        clipShape={rect(radius.md)}
                        contentShape={rect(radius.md)}
                        frame={{ maxWidth: "infinity" }}
                        onTapGesture={ch.locked ? undefined : () => onSelectChapter(ch.id)}
                      >
                        <Image
                          systemName={
                            ch.locked
                              ? "lock.fill"
                              : isCurrent
                                ? "bookmark.fill"
                                : onDevice
                                  ? "arrow.down.circle.fill"
                                  : "doc.text"
                          }
                          font="footnote"
                          foregroundStyle={ch.locked ? "secondaryLabel" : isCurrent ? tint.tint : "tertiaryLabel"}
                        />
                        <Spacer frame={{ width: 8 }} />
                        <Text
                          font="subheadline"
                          fontWeight={isCurrent ? "semibold" : "regular"}
                          foregroundStyle={ch.locked ? "secondaryLabel" : "label"}
                          lineLimit={1}
                        >
                          {ch.title}
                        </Text>
                        <Spacer />
                        {isCurrent ? (
                          <HStack
                            padding={{ horizontal: 7, vertical: 2 }}
                            background={tint.tint}
                            clipShape={{ type: "capsule", style: "circular" }}
                          >
                            <Text font="caption2" fontWeight="semibold" foregroundStyle={tint.onTint}>
                              {t("reader.readingBadge")}
                            </Text>
                          </HStack>
                        ) : null}
                      </HStack>

                      {isCurrent ? (
                        <RoundedRectangle
                          cornerRadius={radius.md}
                          stroke={{
                            shapeStyle: tint.highlightBorder,
                            strokeStyle: { lineWidth: 1.2 },
                          }}
                          allowsHitTesting={false}
                        />
                      ) : null}
                    </ZStack>
                  )
                })}
              </VStack>
            )
          }}
        </ScrollViewReader>
      </ScrollView>
    </VStack>
  )
}
