import { HStack, RoundedRectangle, ScrollView, Spacer, Text, Toolbar, ToolbarItem, VStack, ZStack, type Color, type CommonViewProps, type DynamicShapeStyle, type VirtualNode } from "scripting"

import { PageBackground } from "../app/theme"
import { scrollTopBar } from "./glass"
import { searchToolbarItem, type ToolbarSearch } from "./search"
import { cardBackground, cardGap, cardShape, hairlineStroke, pageInsets, pageSpacing, radius, type StackChildren } from "./tokens"

export function PageScroll({
  title,
  leading,
  trailing,
  onRefresh,
  search,
  searchField,
  zoomFrom,
  children,
}: {
  title?: string
  leading?: () => VirtualNode | null
  trailing?: () => VirtualNode | null
  onRefresh?: () => Promise<void> | void
  search?: ToolbarSearch
  searchField?: CommonViewProps["searchable"]
  zoomFrom?: { sourceID: string; namespace: NamespaceID }
  children: StackChildren
}) {
  const Leading = leading
  const Trailing = trailing
  return (
    <ZStack navigationTransition={zoomFrom ? { type: "zoom", ...zoomFrom } : undefined}>
      <PageBackground />
      <VStack
        spacing={0}
        navigationTitle={title}
        navigationBarTitleDisplayMode="inline"
        searchable={search?.searchable ?? searchField}
        toolbar={
          search ? (
            <Toolbar>
              {Leading ? (
                <ToolbarItem placement="topBarLeading">
                  <Leading />
                </ToolbarItem>
              ) : null}
              {searchToolbarItem(search)}
              {Trailing ? (
                <ToolbarItem placement="topBarTrailing">
                  <Trailing />
                </ToolbarItem>
              ) : null}
            </Toolbar>
          ) : Leading || Trailing ? (
            {
              topBarLeading: Leading ? <Leading /> : undefined,
              topBarTrailing: Trailing ? <Trailing /> : undefined,
            }
          ) : undefined
        }
      >
        <ScrollView
          axes="vertical"
          scrollContentBackground="hidden"
          {...scrollTopBar(null)}
          refreshable={onRefresh && !search?.active ? () => Promise.resolve(onRefresh()) : undefined}
        >
          <VStack spacing={pageSpacing} padding={pageInsets}>
            {children}
          </VStack>
        </ScrollView>
      </VStack>
    </ZStack>
  )
}

export function Card({
  children,
  background = cardBackground,
  swipeActionsContainer,
}: {
  children: StackChildren
  background?: Color | DynamicShapeStyle
  swipeActionsContainer?: boolean
}) {
  return (
    <VStack
      spacing={0}
      background={background}
      clipShape={cardShape}
      frame={{ maxWidth: "infinity" }}
      overlay={<RoundedRectangle cornerRadius={radius.lg} stroke={hairlineStroke} />}
      swipeActionsContainer={swipeActionsContainer}
    >
      {children}
    </VStack>
  )
}

export function GroupHeader({ title }: { title: string }) {
  return (
    <Text font="footnote" fontWeight="medium" foregroundStyle="secondaryLabel" padding={{ leading: 4 }}>
      {title}
    </Text>
  )
}

export function CardGroup({
  title,
  headerAccessory,
  footnote,
  children,
  background,
  swipeActionsContainer,
}: {
  title?: string
  headerAccessory?: VirtualNode | (() => VirtualNode)
  footnote?: string
  children: StackChildren
  background?: Color
  swipeActionsContainer?: boolean
}) {
  const renderedAccessory = typeof headerAccessory === "function" ? headerAccessory() : headerAccessory

  return (
    <VStack spacing={cardGap} alignment="leading">
      {title || renderedAccessory ? (
        <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
          {title ? <GroupHeader title={title} /> : null}
          <Spacer />
          {renderedAccessory ?? null}
        </HStack>
      ) : null}
      <Card background={background} swipeActionsContainer={swipeActionsContainer}>
        {children}
      </Card>
      {footnote ? (
        <Text font="caption2" foregroundStyle="tertiaryLabel" padding={{ leading: 6, top: 2 }}>
          {footnote}
        </Text>
      ) : null}
    </VStack>
  )
}
