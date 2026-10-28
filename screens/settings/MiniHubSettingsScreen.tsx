// Mini Hub 管理：長按拖曳排序；拖過「停用」分隔列就停用，拖回上面就啟用。
//
// 系統拖曳只能在同一個 ForEach 裡移動，所以兩區是同一串資料，中間夾一列「停用」分隔列。
// 分隔列不加 moveDisabled（實機上它旁邊放不下去），放手後依它的位置切兩區。

import {
  Divider, ForEach, List, Rectangle, Section, UnevenRoundedRectangle, VStack, ZStack, useEffect, useObservable,
} from "scripting"

import {
  getMiniHubLayout,
  setMiniHubLayout,
  subscribeMiniHubLayout,
  type MiniHubLayout,
  type MiniHubSection,
} from "../../app/miniHubLayout"
import { PageBackground } from "../../app/theme"
import { scrollTopBar } from "../../design/glass"
import { GroupHeader } from "../../design/layout"
import { IconRow, rowSeparatorInset } from "../../design/rows"
import { cardBackground, cardGap, pageSpacing, radius } from "../../design/tokens"
import { t } from "../../i18n"

const DIVIDER = "divider"

export type MiniHubRow = { id: string; section?: MiniHubSection }

const SECTION_ICONS: Record<MiniHubSection, string> = {
  resume: "play.circle",
  updates: "bell.badge",
  activity: "square.grid.3x3",
}

function sectionTitle(section: MiniHubSection): string {
  switch (section) {
    case "resume":
      return t("home.resumeTitle")
    case "updates":
      return t("home.miniHub.updatesTitle")
    case "activity":
      return t("home.miniHub.activityTitle")
  }
}

export function toRows(layout: MiniHubLayout): MiniHubRow[] {
  return [
    ...layout.enabled.map(section => ({ id: section, section })),
    { id: DIVIDER },
    ...layout.disabled.map(section => ({ id: section, section })),
  ]
}

function toLayout(rows: MiniHubRow[]): MiniHubLayout {
  const split = rows.findIndex(row => row.id === DIVIDER)
  const sections = (list: MiniHubRow[]) => list.flatMap(row => (row.section ? [row.section] : []))
  return { enabled: sections(rows.slice(0, split)), disabled: sections(rows.slice(split + 1)) }
}

export function MiniHubSettingsScreen() {
  const rows = useObservable<MiniHubRow[]>(() => toRows(getMiniHubLayout()))

  useEffect(() => {
    // 順序不同才重設，避免跟 persist 無限互觸。
    const refresh = () => {
      const next = toRows(getMiniHubLayout())
      if (next.map(row => row.id).join() !== rows.value.map(row => row.id).join()) rows.setValue(next)
    }
    // 系統拖曳放手後 ForEach 直接改寫 rows。重排延到下一拍，不在系統寫回的途中改資料。
    const persist = (next: MiniHubRow[]) => {
      setMiniHubLayout(toLayout(next))
      setTimeout(refresh, 0)
    }
    rows.subscribe(persist)
    const off = subscribeMiniHubLayout(refresh)
    return () => {
      rows.unsubscribe(persist)
      off()
    }
  }, [])

  return <MiniHubSettingsView rows={rows} />
}

/**
 * 兩區共用一個 Section，系統只會把整串裁成一張卡；所以卡片底自己畫，區頭區尾才有圓角。
 * 仍用 insetGroup：列本身就內縮，長按拿起的預覽才不會拉到螢幕邊。
 */
function cardRowBackground(first: boolean, last: boolean) {
  return (
    <UnevenRoundedRectangle
      fill={cardBackground}
      topLeadingRadius={first ? radius.lg : 0}
      topTrailingRadius={first ? radius.lg : 0}
      bottomLeadingRadius={last ? radius.lg : 0}
      bottomTrailingRadius={last ? radius.lg : 0}
    />
  )
}

const clearRowBackground = <Rectangle fill="clear" />

/** 「停用」分隔列：長得像 Section 的標題。 */
const dividerRow = {
  listRowBackground: clearRowBackground,
  listRowInsets: { top: pageSpacing, bottom: cardGap, leading: 0, trailing: 0 },
  listRowSeparator: "hidden",
} as const

export function MiniHubSettingsView({ rows }: { rows: Observable<MiniHubRow[]> }) {
  const count = rows.value.length
  const split = rows.value.findIndex(row => row.id === DIVIDER)

  return (
    <ZStack>
      <PageBackground />
      <List
        navigationTitle={t("settings.miniHub.title")}
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        scrollContentBackground="hidden"
        {...scrollTopBar(null)}
      >
        <Section
          header={
            <VStack padding={{ leading: -16 }}>
              <GroupHeader title={t("settings.miniHub.enabledGroup")} />
            </VStack>
          }
        >
          <ForEach
            data={rows}
            editActions="move"
            builder={(row, index) => {
              if (!row.section) {
                return (
                  <VStack key={row.id} {...dividerRow}>
                    <GroupHeader title={t("settings.miniHub.disabledGroup")} />
                  </VStack>
                )
              }
              const disabled = index > split
              const last = index === split - 1 || index === count - 1
              return (
                <VStack
                  key={row.id}
                  spacing={0}
                  listRowBackground={cardRowBackground(index === 0 || index === split + 1, last)}
                  listRowInsets={0}
                  listRowSeparator="hidden"
                >
                  <IconRow
                    icon={SECTION_ICONS[row.section]}
                    iconColor={disabled ? "tertiaryLabel" : "secondaryLabel"}
                    title={sectionTitle(row.section)}
                    titleColor={disabled ? "secondaryLabel" : "label"}
                  />
                  {last ? null : <Divider padding={{ leading: rowSeparatorInset }} />}
                </VStack>
              )
            }}
          />
          {/* 讓 Section 的尾巴落在透明列上：系統的卡片圓角裁不到最後一張卡。 */}
          <Rectangle
            fill="clear"
            frame={{ height: 1 }}
            listRowBackground={clearRowBackground}
            listRowInsets={0}
            listRowSeparator="hidden"
          />
        </Section>
      </List>
    </ZStack>
  )
}
