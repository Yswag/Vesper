import {
  Button, Divider, Group, HStack, Image, NavigationLink, ScrollView, Spacer, Text, Toolbar, ToolbarItem, VStack, ZStack,
  useState, type VirtualNode,
} from "scripting"

import { type ComicSourceInfo } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t, type MessageKey } from "../../i18n"
import { ExitToolbar } from "../../components/ExitToolbar"
import { SourceAvatar } from "../../components/SourceAvatar"
import { SourceScreen } from "./SourceScreen"
import { SourceListScreen } from "../settings/SourceListScreen"
import { RepositoryListScreen } from "../settings/RepositoryListScreen"
import { SourceDetailScreen } from "../settings/SourceDetailScreen"
import { SourceSettingsScreen } from "../settings/SourceSettingsScreen"
import { AidokuSettingsScreen } from "../settings/AidokuSettingsScreen"
import { SourceAccountScreen } from "../settings/SourceAccountScreen"
import { accountSpec, findSource, hasAidokuSettings, setSourceEnabled, type SourceKind } from "../../sources/registry"
import { PageBackground } from "../../app/theme"
import { Chip } from "../../design/chip"
import { scrollTopBar } from "../../design/glass"
import { Card, GroupHeader } from "../../design/layout"
import { Chevron } from "../../design/rows"
import { EmptyState } from "../../design/status"
import { matchesQuery, searchToolbarItem, useToolbarSearch } from "../../design/search"
import { Footnote } from "../../design/text"
import { cardGap, pageInsets, rowPadding, sourceIconSize } from "../../design/tokens"

type SourcePage = "settings" | "aidokuSettings" | "account" | "detail"

function sourcePageView(key: string, page: SourcePage): VirtualNode {
  switch (page) {
    case "settings": return <SourceSettingsScreen sourceKey={key} />
    case "aidokuSettings": return <AidokuSettingsScreen sourceKey={key} />
    case "account": return <SourceAccountScreen sourceKey={key} />
    case "detail": return <SourceDetailScreen sourceKey={key} />
  }
}

export function BrowseScreen() {
  const library = comicLibrary()
  useSubscription(library.onChange, subscribeLocale)
  const sources = library.sources()
  const search = useToolbarSearch(t("browse.searchSources"))
  const query = search.query
  const shown = query ? sources.filter(source => matchesQuery(query, source.name, source.key)) : sources
  const [pushed, setPushed] = useState<{ key: string; page: SourcePage } | null>(null)

  return (
    <ZStack>
      <PageBackground />
      <VStack
        spacing={0}
        navigationTitle={t("browse.title")}
        navigationBarTitleDisplayMode="inline"
        searchable={search.searchable}
        navigationDestination={{
          content: pushed ? (
            <VStack key={`${pushed.key}:${pushed.page}`}>{sourcePageView(pushed.key, pushed.page)}</VStack>
          ) : (
            <VStack />
          ),
          isPresented: pushed !== null,
          onChanged: (presented: boolean) => {
            if (!presented) setPushed(null)
          },
        }}
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <ExitToolbar />
            </ToolbarItem>
            {sources.length > 0 ? searchToolbarItem(search) : null}
            <ToolbarItem placement="topBarTrailing">
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
            </ToolbarItem>
          </Toolbar>
        }
      >
        <ScrollView scrollContentBackground="hidden" {...scrollTopBar(null)}>
          <VStack spacing={cardGap} padding={pageInsets}>
            {sources.length > 0 ? (
              <HStack frame={{ maxWidth: "infinity" }}>
                <GroupHeader
                  title={
                    query
                      ? t("browse.searchResults", { n: shown.length })
                      : t("browse.enabledSources", { n: sources.length })
                  }
                />
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
            ) : shown.length === 0 ? (
              <VStack spacing={18} alignment="center" frame={{ maxWidth: "infinity" }}>
                <EmptyState icon="magnifyingglass" title={t("common.noMatch", { query })} variant="page" />
                <NavigationLink destination={<RepositoryListScreen initialQuery={query} />} buttonStyle="plain">
                  <Chip text={t("browse.findInRepositories")} icon="shippingbox" />
                </NavigationLink>
              </VStack>
            ) : (
              shown.map(source => (
                <VStack
                  key={source.key}
                  spacing={0}
                  contextMenu={{
                    menuItems: <SourceMenuItems sourceKey={source.key} onOpen={page => setPushed({ key: source.key, page })} />,
                  }}
                >
                  <NavigationLink destination={<SourceScreen sourceKey={source.key} />}>
                    <SourceCard source={source} />
                  </NavigationLink>
                </VStack>
              ))
            )}
          </VStack>
        </ScrollView>
      </VStack>
    </ZStack>
  )
}

function SourceMenuItems({ sourceKey, onOpen }: { sourceKey: string; onOpen: (page: SourcePage) => void }): VirtualNode {
  const installed = findSource(sourceKey)
  if (!installed) return <Group />
  const hasVeneraSettings = (installed.settingsSpecs?.length ?? 0) > 0

  return (
    <Group>
      {hasVeneraSettings ? (
        <Button title={t("settings.sourceDetail.settingsRow")} systemImage="slider.horizontal.3" action={() => onOpen("settings")} />
      ) : hasAidokuSettings(installed) ? (
        <Button title={t("settings.sourceDetail.settingsRow")} systemImage="slider.horizontal.3" action={() => onOpen("aidokuSettings")} />
      ) : null}
      {accountSpec(installed) ? (
        <Button title={t("settings.sourceDetail.accountRow")} systemImage="person.crop.circle" action={() => onOpen("account")} />
      ) : null}
      <Button title={t("settings.sourceDetail.title")} systemImage="info.circle" action={() => onOpen("detail")} />
      <Divider />
      <Button
        title={t("browse.disableSource")}
        systemImage="power"
        action={() => setSourceEnabled(sourceKey, false)}
      />
    </Group>
  )
}

function kindLabelKey(kind: SourceKind): MessageKey {
  if (kind === "aidoku") return "settings.shared.kindAidoku"
  if (kind === "mihon") return "settings.shared.kindMihon"
  return "settings.shared.kindVenera"
}

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
            {`${t(kindLabelKey(source.kind))} · ${source.key}`}
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
