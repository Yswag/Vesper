// 三欄海報網格。寬度依實際父容器量測，讓窄版搜尋欄也能自動換欄。

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
import { radius } from "../design/tokens"
import type { ComicListItem } from "../engine/adapt"
import { t } from "../i18n"
import { ComicDetailScreen } from "../screens/shared/ComicDetailScreen"
import { CoverImage } from "./CoverImage"
import { WidthReporter } from "./WidthReporter"
import { comicGridMetrics, H_PADDING, H_SPACING, V_SPACING } from "./comicGridMetrics"
import { GRID_EXIT_ANIM, GRID_REGRID_ANIM } from "./gridRemoval"

export interface ComicGridEntry {
  /** 這張屬於哪個源（導到詳情頁與封面解析都用它）。 */
  sourceKey: string
  /** 跨源顯示時的來源名稱（`showSource` 才用）。 */
  sourceName?: string
  /** 來源已被移除：封面下緣掛 danger 角標，下面那行來源名就不再重複。 */
  removed?: boolean
  /** 0–1，這一話讀到哪：封面下方一條進度（跟首頁「繼續閱讀」同一種）。 */
  readFraction?: number
  /** 未讀章節數：> 0 時封面右上角掛數字膠囊。 */
  unreadCount?: number
  /** 正在被移出（由 `useGridRemoval` 標記）：原地縮小、往上淡出。 */
  removing?: boolean
  comic: ComicListItem
}

export interface ComicGridProps {
  entries: ComicGridEntry[]
  /** 跨源搜尋時顯示來源名稱，單源探索不必。 */
  showSource?: boolean
  /** 接在網格後面的內容（例如「載入更多」），會一起捲動。 */
  footer?: VirtualNode
  /** 最後一格出現在畫面上時呼叫（用在「捲到底自動載入下一頁」）。 */
  onLastAppear?: () => void
  /** 長按一格跳出的選單項目（不給就沒有長按選單）。 */
  menuItems?: (entry: ComicGridEntry) => VirtualNode
}

/** 一格的身分；跟 `useGridRemoval` 的 key 同一套。 */
function entryKey(entry: ComicGridEntry): string {
  return `${entry.sourceKey}:${entry.comic.id}`
}

/** 這一輪是不是只少了一格：換篩選、整批換掉都不算，不然會亂飛。 */
function isSingleRemoval(previous: readonly string[], next: readonly string[]): boolean {
  if (previous.length !== next.length + 1) return false
  const current = new Set(next)
  const kept = previous.filter(key => current.has(key))
  return kept.length === next.length && kept.every((key, index) => key === next[index])
}

/**
 * 每一格「舊位置 − 新位置」的像素位移（沒動的不列）。
 * 格子位置是格子自己算的：第 i 格在 (i % columns, ⌊i / columns⌋) 個欄距／列距上，
 * 少一格之後後面每一格正好遞補前一格的位置。
 */
function collapseShift(
  previous: readonly string[],
  next: readonly string[],
  columns: number,
  columnPitch: number,
  rowPitch: number
): Record<string, { x: number; y: number }> {
  const shift: Record<string, { x: number; y: number }> = {}
  next.forEach((key, index) => {
    const before = previous.indexOf(key)
    if (before <= index) return
    shift[key] = {
      x: (before % columns - index % columns) * columnPitch,
      y: (Math.floor(before / columns) - Math.floor(index / columns)) * rowPitch,
    }
  })
  return shift
}

/** 只有格子，不含 ScrollView。 */
export function ComicGridLayout({ entries, showSource = false, onLastAppear, menuItems }: ComicGridProps) {
  const [containerWidth, setContainerWidth] = useState(0)
  /** 列高（＝一格撐滿的高度）；補位時換列的格子靠它算飛多遠。 */
  const [rowHeight, setRowHeight] = useState(0)
  const { columns, cellWidth, cellHeight } = comicGridMetrics(containerWidth)
  const measured = containerWidth > 0
  const lastIndex = entries.length - 1
  // 有任何一格帶進度才留這一行；瀏覽、搜尋的網格不受影響。
  const hasProgress = entries.some(entry => entry.readFraction !== undefined)

  const keys = entries.map(entryKey)

  // LazyVGrid 自己不會演「少一格」的補位（版面變化不吃 `withAnimation`，實機是直接跳位）。
  // 所以位置自己補：先讓還留著的格子畫在舊位置，下一輪再將 offset 收成 0，
  // 靠 `animation(value:)` 演靠攏——這條路徑跟退場一樣只靠修飾子，不靠交易。
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

  // 先讓上面那一輪畫在舊位置，下一輪才收線並出手。
  // 用 macrotask（16ms 約一個影格）而不是直接設 state：確保「畫在舊位置」這帧真的出現過。
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
            const key = entryKey(entry)
            const sourceID = `grid:${entry.sourceKey}:${entry.comic.id}`
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
                  // 量第一格的高（每一格都撐滿列高）：補位時換列的格子才算得準。
                  background={index === 0 ? (
                    <GeometryReader>
                      {geometry => <WidthReporter width={geometry.size.height} onWidth={setRowHeight} />}
                    </GeometryReader>
                  ) : undefined}
                  // 每列的內容高度不一樣（有的源有副標、有的沒有）——LazyVGrid 會把矮的置中，
                  // 封面就會参差不齊。填滿列高 + 靠上對齊，封面才會排成一直線。
                  // 寬度要用**已知的 cellWidth 釘死**，不要用 `maxWidth: "infinity"`：
                  // 那個在本引擎是「抱內容的天然寬」，一格就可能比欄寬還寬，
                  // 內容比螢幕寬時引擎的命中表會跟畫面錯開（點一格卻開別格）。
                  // 見 dev/probe-cover-overflow.tsx 的 `mode:"wide"`（一排 6 張 765pt 會壞、3 張 378pt 正常）。
                  frame={{ width: cellWidth, maxHeight: "infinity", alignment: "top" }}
                  // 退場的三件套一起換，動畫短到看不出是三個獨立屬性。
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
                      // 預設的 fill 會由 CoverImage 先把圖中心裁成格子比例（裁完再 fit）。
                      // 不能用 aspectRatio(fill)：橫式封面會被畫成比格子寬很多（1000×395 → 440pt），
                      // 外溢的區塊會蓋到鄰格、把第一格的點擊搶走（點第一本會開第二本）。
                      // 對照：dev/probe-nav-image.tsx（fill 壞、fit 正常、割好的 fill 正常）。
                      cornerRadius={radius.md}
                    />
                    {entry.comic.pageCount ? (
                      // 頁數放左上：跟右下角的更新時間同排會互相擠，兩邊都只剩「3…」。
                      <HStack
                        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
                        offset={{ x: 6, y: 6 }}
                      >
                        <CoverBadge text={`${entry.comic.pageCount}P`} />
                      </HStack>
                    ) : null}
                    {entry.removed ? (
                      // 擺下緣左邊：右下角已經給更新時間，左上角留給頁數。
                      <HStack
                        offset={{ x: 6, y: -6 }}
                        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomLeading" }}
                      >
                        <CoverBadge text={t("bookshelf.sourceRemoved")} tone="danger" maxWidth={cellWidth - 12} alignment="leading" />
                      </HStack>
                    ) : null}
                    {entry.comic.updateTime ? (
                      // 跟探索頁同一個修法：外層撑滿、內層夾在 `cellWidth - 12` 內。
                      // `updateTime` 是源的原始字串，不夾的話膠囊會比格子寬（超出封面）。
                      // 對照：dev/preview-badge-clamp.tsx（同一個字串，夾與不夾並排）。
                      <HStack
                        offset={{ x: -6, y: -6 }}
                        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomTrailing" }}
                      >
                        <CoverBadge text={entry.comic.updateTime} maxWidth={cellWidth - 12} />
                      </HStack>
                    ) : null}
                    {(entry.unreadCount ?? 0) > 0 ? (
                      // 右上角是唯一空著的角：頁數在左上，來源狀態與更新時間在下緣。
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
                    // 沒進度的格子也佔位（透明），同一排的書名才對得齊。
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

/** 自帶 ScrollView 的版本（單一列表用，例如搜尋結果）。 */
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
