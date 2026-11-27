import {
  GeometryReader,
  HStack,
  LazyVGrid,
  NamespaceReader,
  NavigationLink,
  ProgressView,
  ScrollView,
  Text,
  VStack,
  ZStack,
  useEffect,
  useRef,
  useState,
  type VirtualNode,
} from "scripting"

import { CoverBadge, UnreadBadge } from "../design/CoverBadge"
import { SkeletonBlock, SkeletonText } from "../design/skeleton"
import { radius } from "../design/tokens"
import type { ComicListItem } from "../engine/adapt"
import { t } from "../i18n"
import { ComicDetailScreen } from "../screens/shared/ComicDetailScreen"
import { CoverImage } from "./CoverImage"
import { WidthReporter } from "./WidthReporter"
import { comicGridMetrics, H_PADDING, H_SPACING, V_SPACING } from "./comicGridMetrics"
import { GRID_EXIT_ANIM, GRID_REGRID_ANIM } from "./gridRemoval"

export interface ComicGridEntry {
  sourceKey: string
  sourceName?: string
  removed?: boolean
  coverSource?: string
  readFraction?: number
  unreadCount?: number
  removing?: boolean
  comic: ComicListItem
}

export interface ComicGridProps {
  entries: ComicGridEntry[]
  showSource?: boolean
  footer?: VirtualNode
  onLastAppear?: () => void
  menuItems?: (entry: ComicGridEntry) => VirtualNode
}

function entryKey(entry: ComicGridEntry): string {
  return `${entry.sourceKey}:${entry.comic.id}`
}

export function gridSurfaces(entries: readonly ComicGridEntry[]): { keys: string[]; hasProgress: boolean } {
  const keys = new Array<string>(entries.length)
  let hasProgress = false
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    keys[index] = entryKey(entry)
    if (entry.readFraction !== undefined) hasProgress = true
  }
  return { keys, hasProgress }
}

function isSingleRemoval(previous: readonly string[], next: readonly string[]): boolean {
  if (previous.length !== next.length + 1) return false
  const current = new Set(next)
  const kept = previous.filter(key => current.has(key))
  return kept.length === next.length && kept.every((key, index) => key === next[index])
}

export function collapseShift(
  previous: readonly string[],
  next: readonly string[],
  columns: number,
  columnPitch: number,
  rowPitch: number
): Record<string, { x: number; y: number }> {
  const before = new Map<string, number>()
  for (let index = 0; index < previous.length; index++) {
    const key = previous[index]
    if (!before.has(key)) before.set(key, index)
  }
  const shift: Record<string, { x: number; y: number }> = {}
  for (let index = 0; index < next.length; index++) {
    const key = next[index]
    const was = before.get(key)
    if (was === undefined || was <= index) continue
    shift[key] = {
      x: (was % columns - index % columns) * columnPitch,
      y: (Math.floor(was / columns) - Math.floor(index / columns)) * rowPitch,
    }
  }
  return shift
}

export function ComicGridSkeleton({ rows = 3 }: { rows?: number }) {
  const [containerWidth, setContainerWidth] = useState(0)
  const { columns, cellWidth, cellHeight } = comicGridMetrics(containerWidth)
  return (
    <VStack
      alignment="leading"
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      accessibilityLabel={t("common.loading")}
      background={
        <GeometryReader>
          {geometry => <WidthReporter width={geometry.size.width} onWidth={setContainerWidth} />}
        </GeometryReader>
      }
    >
      {containerWidth > 0 ? (
        <VStack alignment="leading" spacing={V_SPACING} padding={{ horizontal: H_PADDING, top: 12, bottom: 8 }}>
          {Array.from({ length: rows }, (_, row) => (
            <HStack key={row} spacing={H_SPACING} alignment="top">
              {Array.from({ length: columns }, (_, column) => (
                <VStack key={column} alignment="leading" spacing={6} frame={{ width: cellWidth, alignment: "leading" }}>
                  <SkeletonBlock width={cellWidth} height={cellHeight} />
                  <SkeletonText font="caption" fontWeight="medium" length={2} />
                </VStack>
              ))}
            </HStack>
          ))}
        </VStack>
      ) : null}
    </VStack>
  )
}

export function ComicGridLayout({ entries, showSource = false, onLastAppear, menuItems }: ComicGridProps) {
  const [containerWidth, setContainerWidth] = useState(0)
  const [rowHeight, setRowHeight] = useState(0)
  const { columns, cellWidth, cellHeight } = comicGridMetrics(containerWidth)
  const measured = containerWidth > 0
  const lastIndex = entries.length - 1
  const { keys, hasProgress } = gridSurfaces(entries)

  const previousKeys = useRef<string[]>([])
  const pendingShift = useRef<Record<string, { x: number; y: number }>>({})
  const [settleToken, setSettleToken] = useState(0)

  if (measured && isSingleRemoval(previousKeys.current, keys)) {
    pendingShift.current = collapseShift(
      previousKeys.current,
      keys,
      columns,
      cellWidth + H_SPACING,
      (rowHeight > 0 ? rowHeight : cellHeight) + V_SPACING
    )
  }
  previousKeys.current = keys
  const shift = pendingShift.current

  useEffect(() => {
    if (Object.keys(pendingShift.current).length === 0) return
    const timer = setTimeout(() => {
      pendingShift.current = {}
      setSettleToken(token => token + 1)
    }, 16)
    return () => clearTimeout(timer)
  }, [settleToken, keys.length])

  return (
    <NamespaceReader>
      {gridNs => (
        <LazyVGrid
          columns={Array.from({ length: columns }, () => ({ size: { type: "flexible" }, spacing: H_SPACING }))}
          spacing={V_SPACING}
          padding={{ horizontal: H_PADDING, top: 12, bottom: 8 }}
          background={
            <GeometryReader>
              {geometry => <WidthReporter width={geometry.size.width} onWidth={setContainerWidth} />}
            </GeometryReader>
          }
        >
          {measured ? entries.map((entry, index) => {
            const key = keys[index]
            const sourceID = `grid:${key}`
            return (
              <NavigationLink
                key={key}
                destination={
                  <ComicDetailScreen
                    sourceKey={entry.sourceKey}
                    comicId={entry.comic.id}
                    title={entry.comic.title}
                    zoomTransition={{ sourceID, namespace: gridNs }}
                  />
                }
                buttonStyle="plain"
                offset={shift[key] ?? { x: 0, y: 0 }}
                animation={{ animation: GRID_REGRID_ANIM, value: settleToken }}
              >
                <VStack
                  alignment="leading"
                  spacing={6}
                  background={index === 0 ? (
                    <GeometryReader>
                      {geometry => <WidthReporter width={geometry.size.height} onWidth={setRowHeight} />}
                    </GeometryReader>
                  ) : undefined}
                  frame={{ width: cellWidth, maxHeight: "infinity", alignment: "top" }}
                  opacity={entry.removing ? 0 : 1}
                  scaleEffect={entry.removing ? 0.84 : 1}
                  offset={{ x: 0, y: entry.removing ? -10 : 0 }}
                  animation={{ animation: GRID_EXIT_ANIM, value: entry.removing === true }}
                  onAppear={containerWidth > 0 && index === lastIndex ? onLastAppear : undefined}
                  contextMenu={menuItems ? { menuItems: menuItems(entry) } : undefined}
                >
                  <ZStack
                    alignment="bottomTrailing"
                    frame={{ width: cellWidth, height: cellHeight }}
                    matchedTransitionSource={{ id: sourceID, namespace: gridNs }}
                  >
                    <CoverImage
                      sourceKey={entry.sourceKey}
                      url={entry.comic.cover}
                      width={cellWidth}
                      height={cellHeight}
                      title={entry.comic.title}
                      lifted
                      cornerRadius={radius.md}
                    />
                    {entry.comic.pageCount ? (
                      <HStack
                        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
                        offset={{ x: 6, y: 6 }}
                      >
                        <CoverBadge text={`${entry.comic.pageCount}P`} />
                      </HStack>
                    ) : null}
                    {entry.removed ? (
                      <HStack
                        offset={{ x: 6, y: -6 }}
                        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomLeading" }}
                      >
                        <CoverBadge text={t("bookshelf.sourceRemoved")} tone="danger" maxWidth={cellWidth - 12} alignment="leading" />
                      </HStack>
                    ) : entry.coverSource ? (
                      <HStack
                        offset={{ x: 6, y: -6 }}
                        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomLeading" }}
                      >
                        <CoverBadge text={entry.coverSource} maxWidth={cellWidth - 12} alignment="leading" />
                      </HStack>
                    ) : null}
                    {entry.comic.updateTime ? (
                      <HStack
                        offset={{ x: -6, y: -6 }}
                        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomTrailing" }}
                      >
                        <CoverBadge text={entry.comic.updateTime} maxWidth={cellWidth - 12} />
                      </HStack>
                    ) : null}
                    {(entry.unreadCount ?? 0) > 0 ? (
                      <HStack
                        offset={{ x: -6, y: 6 }}
                        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topTrailing" }}
                      >
                        <UnreadBadge
                          count={entry.unreadCount ?? 0}
                          accessibilityLabel={t("bookshelf.unreadBadge", { n: entry.unreadCount ?? 0 })}
                        />
                      </HStack>
                    ) : null}
                  </ZStack>
                  {hasProgress ? (
                    <ProgressView
                      value={entry.readFraction ?? 0}
                      progressViewStyle="linear"
                      frame={{ width: cellWidth }}
                      opacity={entry.readFraction !== undefined ? 1 : 0}
                    />
                  ) : null}
                  <Text
                    font="caption"
                    fontWeight="medium"
                    foregroundStyle="label"
                    lineLimit={1}
                    multilineTextAlignment="leading"
                    frame={{ width: cellWidth, alignment: "leading" }}
                  >
                    {entry.comic.title}
                  </Text>
                  {entry.comic.subtitle ? (
                    <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1} multilineTextAlignment="leading" frame={{ width: cellWidth, alignment: "leading" }}>
                      {entry.comic.subtitle}
                    </Text>
                  ) : null}
                  {showSource && !entry.removed ? (
                    <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1} multilineTextAlignment="leading" frame={{ width: cellWidth, alignment: "leading" }}>
                      {entry.sourceName ?? ""}
                    </Text>
                  ) : null}
                </VStack>
              </NavigationLink>
            )
          }) : null}
        </LazyVGrid>
      )}
    </NamespaceReader>
  )
}

export function ComicGrid({ entries, showSource = false, footer, onLastAppear }: ComicGridProps) {
  return (
    <ScrollView scrollDismissesKeyboard="interactively">
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        onTapGesture={() => {
          if (Keyboard.visible) Keyboard.hide()
        }}
      >
        <ComicGridLayout entries={entries} showSource={showSource} onLastAppear={onLastAppear} />
        {footer}
      </VStack>
    </ScrollView>
  )
}
