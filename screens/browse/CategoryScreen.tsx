// 源的分類頁：把源宣告的 `category.parts` 畫成 chips，點下去進大網格。
//
// 分類完全由源決定（類型 / 標籤 / 書庫…），要讀完 parts 才知道有幾組、組裡有什麼；
// 某一組讀不到（dynamic 的 loader 丟錯、要登入）只顯示一行說明，不擋其他組。

import { FlowLayout, NavigationLink, ProgressView, ScrollView, Text, VStack, ZStack, useEffect, useState } from "scripting"

import { type CategoryChip, type CategoryPart } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { SectionGridScreen, type MoreSource } from "./SectionGridScreen"
import { PageBackground } from "../../app/theme"
import { Caption } from "../../design/text"
import { Chip } from "../../design/chip"
import { type StatusKind } from "../../design/status"
import { pageInsets, pageSpacing } from "../../design/tokens"

export function CategoryScreen({ sourceKey }: { sourceKey: string }) {
  const [parts, setParts] = useState<CategoryPart[]>([])
  const [status, setStatus] = useState<StatusKind>("loading")
  const [errorText, setErrorText] = useState("")

  // 畫面自己訂閱語言：下面的狀態字在 render 時取自 `t()`，換語言要重繪才算數。
  useSubscription(subscribeLocale)

  useEffect(() => {
    void load()
  }, [sourceKey])

  async function load() {
    setStatus("loading")
    try {
      const loaded = await comicLibrary().categoryParts(sourceKey)
      setParts(loaded)
      setStatus(loaded.some(part => part.chips.length > 0) ? "ready" : "empty")
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
      setStatus("error")
    }
  }

  const groups = parts.filter(part => part.chips.length > 0 || part.error)
  const named = groups.length > 1
  // 顯示文字在 render 時才算：狀態只負責判斷。
  const statusText =
    status === "error"
      ? errorText
      : status === "loading"
        ? t("common.loading")
        : status === "empty"
          ? t("browse.noCategories")
          : ""

  return (
    <ZStack>
      <PageBackground />
      <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {status !== "ready" ? (
        <VStack alignment="center" spacing={12} padding={{ top: groups.length > 0 ? 12 : 60, horizontal: 20 }}>
          {groups.length === 0 && status === "loading" ? <ProgressView /> : null}
          <Caption>{statusText}</Caption>
        </VStack>
      ) : null}

      <ScrollView scrollContentBackground="hidden">
        <VStack alignment="leading" spacing={pageSpacing} padding={pageInsets}>
          {groups.map(part => (
            <VStack
              key={`part:${part.index}`}
              alignment="leading"
              spacing={10}
              frame={{ maxWidth: "infinity" }}
            >
              {/* 只有一組時不必標名字，標了反而多一行。 */}
              {named ? (
                <Text font="headline" fontWeight="bold">
                  {part.name}
                </Text>
              ) : null}

              {part.error ? (
                <Caption>{t("browse.partError", { error: part.error })}</Caption>
              ) : null}

              <FlowLayout horizontalSpacing={8} verticalSpacing={10}>
                {part.chips.map(chip => (
                  <CategoryChipLink key={`chip:${part.index}:${chip.label}`} sourceKey={sourceKey} chip={chip} />
                ))}
              </FlowLayout>
            </VStack>
          ))}
        </VStack>
      </ScrollView>
    </VStack>
  </ZStack>
  )
}

function CategoryChipLink({ sourceKey, chip }: { sourceKey: string; chip: CategoryChip }) {
  const more: MoreSource = { kind: "target", target: chip.target, page: 1 }
  return (
    <NavigationLink
      accessibilityLabel={t("browse.categoryLabel", { label: chip.label })}
      destination={
        <SectionGridScreen
          sourceKey={sourceKey}
          section={{ title: chip.label, comics: [] }}
          initialMore={more}
        />
      }
    >
      <Chip text={chip.label} />
    </NavigationLink>
  )
}
