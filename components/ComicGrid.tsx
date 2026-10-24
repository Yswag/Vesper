// 三欄海報網格。寬度依實際父容器量測，讓窄版搜尋欄也能自動換欄。

import {
  GeometryReader,
  HStack,
  LazyVGrid,
  NamespaceReader,
  NavigationLink,
  ScrollView,
  Text,
  VStack,
  ZStack,
  useState,
  type VirtualNode,
} from "scripting"

import { CoverBadge } from "../design/CoverBadge"
import { radius } from "../design/tokens"
import type { ComicListItem } from "../engine/adapt"
import { t } from "../i18n"
import { ComicDetailScreen } from "../screens/shared/ComicDetailScreen"
import { CoverImage } from "./CoverImage"
import { WidthReporter } from "./WidthReporter"
import { comicGridMetrics, H_PADDING, H_SPACING, V_SPACING } from "./comicGridMetrics"

export interface ComicGridEntry {
  /** 這張屬於哪個源（導到詳情頁與封面解析都用它）。 */
  sourceKey: string
  /** 跨源顯示時的來源名稱（`showSource` 才用）。 */
  sourceName?: string
  /** 來源已被移除：封面下緣掛 danger 角標，下面那行來源名就不再重複。 */
  removed?: boolean
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
}

/** 只有格子，不含 ScrollView。 */
export function ComicGridLayout({ entries, showSource = false, onLastAppear }: ComicGridProps) {
  const [containerWidth, setContainerWidth] = useState(0)
  const { columns, cellWidth, cellHeight } = comicGridMetrics(containerWidth)
  const measured = containerWidth > 0
  const lastIndex = entries.length - 1

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
            const sourceID = `grid:${entry.sourceKey}:${entry.comic.id}`
            return (
              <NavigationLink
                key={`${entry.sourceKey}:${entry.comic.id}`}
                destination={
                  <ComicDetailScreen
                    sourceKey={entry.sourceKey}
                    comicId={entry.comic.id}
                    title={entry.comic.title}
                    zoomTransition={{ sourceID, namespace: gridNs }}
                  />
                }
                buttonStyle="plain"
              >
                <VStack
                  alignment="leading"
                  spacing={6}
                  // 每列的內容高度不一樣（有的源有副標、有的沒有）——LazyVGrid 會把矮的置中，
                  // 封面就會参差不齊。填滿列高 + 靠上對齊，封面才會排成一直線。
                  // 寬度要用**已知的 cellWidth 釘死**，不要用 `maxWidth: "infinity"`：
                  // 那個在本引擎是「抱內容的天然寬」，一格就可能比欄寬還寬，
                  // 內容比螢幕寬時引擎的命中表會跟畫面錯開（點一格卻開別格）。
                  // 見 dev/probe-cover-overflow.tsx 的 `mode:"wide"`（一排 6 張 765pt 會壞、3 張 378pt 正常）。
                  frame={{ width: cellWidth, maxHeight: "infinity", alignment: "top" }}
                  onAppear={containerWidth > 0 && index === lastIndex ? onLastAppear : undefined}
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
                        <CoverBadge text={t("bookshelf.sourceRemoved")} tone="danger" maxWidth={cellWidth - 12} />
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
                  </ZStack>
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
