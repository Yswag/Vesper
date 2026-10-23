// 瀏覽：列出已啟用的源，點進去就是那源的一頁（探索 / 分類 / 排行）。

import { HStack, Image, NavigationLink, RoundedRectangle, ScrollView, Spacer, Text, VStack, ZStack } from "scripting"

import { type ComicSourceInfo } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { LeadingToolbar } from "../../components/LeadingToolbar"
import { SourceAvatar } from "../../components/SourceAvatar"
import { SourceScreen } from "./SourceScreen"
import { SourceListScreen } from "../settings/SourceListScreen"
import { PageBackground } from "../../app/theme"
import { Chevron } from "../../design/rows"
import { EmptyState } from "../../design/status"
import { Footnote } from "../../design/text"
import {
  cardBackground,
  cardBackgroundStrong,
  cardGap,
  capsule,
  fill,
  hairlineStroke,
  pageInsets,
  palette,
  radius,
  rect,
  rowPadding,
  sourceIconSize,
} from "../../design/tokens"

export function BrowseScreen() {
  const library = comicLibrary()
  // 安裝／移除／啟用來源都由庫的單一訂閱通知（不必自己 reloadRegistry 或訂 subscribeSources）。
  // 語言是第二個訂閱源：導覽列標題與下面的字都在 render 時取自 `t()`，換語言要重繪才算數。
  useSubscription(library.onChange, subscribeLocale)
  const sources = library.sources()

  return (
    <ZStack>
      <PageBackground />
      <VStack
        spacing={0}
        navigationTitle={t("browse.title")}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: <LeadingToolbar />,
          topBarTrailing: (
            <NavigationLink
              destination={<SourceListScreen />}
              buttonStyle="plain"
              accessibilityLabel={t("browse.manageSources")}
            >
              <Image
                systemName="server.rack"
                font="subheadline"
                fontWeight="semibold"
                foregroundStyle="label"
              />
            </NavigationLink>
          ),
        }}
      >
        <ScrollView scrollContentBackground="hidden">
          <VStack spacing={cardGap} padding={pageInsets}>
            {/* 分區標題 */}
            <HStack padding={{ vertical: 4 }} alignment="center">
              <Text font="footnote" fontWeight="medium" foregroundStyle="secondaryLabel">
                  {t("browse.enabledSources", { n: sources.length })}
              </Text>
              <Spacer />
            </HStack>

            {/* 空狀態 */}
            {sources.length === 0 ? (
              <VStack spacing={18} alignment="center" frame={{ maxWidth: "infinity" }}>
                <EmptyState
                  icon="books.vertical"
                  title={t("browse.emptyTitle")}
                  detail={t("browse.emptyDetail")}
                  variant="page"
                />
                <NavigationLink destination={<SourceListScreen />} buttonStyle="plain">
                  <HStack
                    spacing={6}
                    padding={{ horizontal: 16, vertical: 10 }}
                    background={fill.selected}
                    clipShape={capsule("circular")}
                  >
                    <Image systemName="plus" font="subheadline" fontWeight="semibold" foregroundStyle={palette.blue} />
                    <Text font="subheadline" fontWeight="semibold" foregroundStyle={palette.blue}>
                      {t("browse.pickSources")}
                    </Text>
                  </HStack>
                </NavigationLink>
              </VStack>
            ) : (
              /* 通透精緻來源卡片流：徹底摒棄 List 死黑，融入流光暗幕 */
              sources.map(source => (
                <NavigationLink
                  key={source.key}
                  destination={<SourceScreen sourceKey={source.key} />}
                >
                  <SourceCard source={source} />
                </NavigationLink>
              ))
            )}
          </VStack>
        </ScrollView>
      </VStack>
    </ZStack>
  )
}

/** 精緻微透來源卡片：浮動在極光流光之上 */
function SourceCard({ source }: { source: ComicSourceInfo }) {
  const name = source.name
  const firstLetter = name.slice(0, 1).toUpperCase()
  const version = source.version

  return (
    <HStack
      spacing={14}
      padding={rowPadding}
      background={cardBackground}
      clipShape={rect(radius.card)}
      shadow={{ color: "rgba(0, 0, 0, 0.06)", radius: 6, x: 0, y: 2 }}
      overlay={
        <RoundedRectangle
          cornerRadius={radius.card}
          stroke={hairlineStroke}
        />
      }
      alignment="center"
    >
      {/* 來源圖標徽章（優先顯示網站圖標，失敗則圓形文字徽章） */}
      <SourceAvatar sourceKey={source.key} name={name} size={sourceIconSize} iconUrl={source.iconUrl} />

      {/* 來源資訊 */}
      <VStack alignment="leading" spacing={3}>
        <Text font="body" fontWeight="semibold" foregroundStyle="label">
          {name}
        </Text>
        <Text font="caption2" foregroundStyle="secondaryLabel">
          {`${t(source.kind === "aidoku" ? "settings.shared.kindAidoku" : "settings.shared.kindVenera")} · ${source.key}`}
        </Text>
      </VStack>

      <Spacer />

      {/* 版本號與右向精緻箭頭 */}
      <HStack spacing={6} alignment="center">
        {version ? (
          <Footnote>{`v${version}`}</Footnote>
        ) : null}
        <Chevron />
      </HStack>
    </HStack>
  )
}
