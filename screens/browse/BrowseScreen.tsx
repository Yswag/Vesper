// 瀏覽：列出已啟用的源，點進去就是那源的一頁（探索 / 分類 / 排行）。

import { HStack, Image, NavigationLink, ScrollView, Spacer, Text, VStack, ZStack } from "scripting"

import { type ComicSourceInfo } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { LeadingToolbar } from "../../components/LeadingToolbar"
import { SourceAvatar } from "../../components/SourceAvatar"
import { SourceScreen } from "./SourceScreen"
import { SourceListScreen } from "../settings/SourceListScreen"
import { PageBackground } from "../../app/theme"
import { Chip } from "../../design/chip"
import { scrollTopBar } from "../../design/glass"
import { Card, GroupHeader } from "../../design/layout"
import { Chevron } from "../../design/rows"
import { EmptyState } from "../../design/status"
import { Footnote } from "../../design/text"
import { cardGap, pageInsets, rowPadding, sourceIconSize } from "../../design/tokens"

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
        <ScrollView scrollContentBackground="hidden" {...scrollTopBar(null)}>
          <VStack spacing={cardGap} padding={pageInsets}>
            {sources.length > 0 ? (
              <HStack frame={{ maxWidth: "infinity" }}>
                <GroupHeader title={t("browse.enabledSources", { n: sources.length })} />
                <Spacer />
              </HStack>
            ) : null}

            {sources.length === 0 ? (
              <VStack spacing={18} alignment="center" frame={{ maxWidth: "infinity" }}>
                <EmptyState
                  icon="books.vertical"
                  title={t("browse.emptyTitle")}
                  detail={t("browse.emptyDetail")}
                  variant="page"
                />
                <NavigationLink destination={<SourceListScreen />} buttonStyle="plain">
                  <Chip text={t("browse.pickSources")} icon="plus" />
                </NavigationLink>
              </VStack>
            ) : (
              sources.map(source => (
                <NavigationLink key={source.key} destination={<SourceScreen sourceKey={source.key} />}>
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

/** 一個來源一列：圖標、名稱與種類／鍵，右邊版本號與箭頭。 */
function SourceCard({ source }: { source: ComicSourceInfo }) {
  return (
    <Card>
      <HStack spacing={14} padding={rowPadding} alignment="center">
        <SourceAvatar sourceKey={source.key} name={source.name} size={sourceIconSize} iconUrl={source.iconUrl} />

        <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Text font="body" fontWeight="semibold" foregroundStyle="label" lineLimit={1}>
            {source.name}
          </Text>
          <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
            {`${t(source.kind === "aidoku" ? "settings.shared.kindAidoku" : "settings.shared.kindVenera")} · ${source.key}`}
          </Text>
        </VStack>

        <HStack spacing={6} alignment="center">
          {source.version ? <Footnote>{`v${source.version}`}</Footnote> : null}
          <Chevron />
        </HStack>
      </HStack>
    </Card>
  )
}
