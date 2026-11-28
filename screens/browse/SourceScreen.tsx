import {
  Button,
  DefaultToolbarItem,
  Image,
  Menu,
  NavigationLink,
  Picker,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
  useEffect,
  useObservable,
  useState,
} from "scripting"

import { comicLibrary } from "../../app/services"
import { liquidGlass } from "../../design/glass"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { CategoryScreen } from "./CategoryScreen"
import { ExploreScreen } from "./ExploreScreen"
import { RankingScreen } from "./RankingScreen"
import { SourceSearchResults } from "./SourceSearchResults"
import { SourceWebViewScreen } from "./SourceWebViewScreen"

export function SourceScreen({ sourceKey }: { sourceKey: string }) {
  const info = comicLibrary().source(sourceKey)
  const [mode, setMode] = useState("explore")
  const [keyword, setKeyword] = useState("")
  const [submitted, setSubmitted] = useState<string | null>(null)
  const searchOpen = useObservable(false)
  const [searchActive, setSearchActive] = useState(false)
  const [searchMounted, setSearchMounted] = useState(false)
  useSubscription(subscribeLocale)

  useEffect(() => {
    setKeyword("")
    setSubmitted(null)
    setSearchMounted(false)
  }, [sourceKey])

  useEffect(() => {
    const listener = (open: boolean) => {
      setSearchActive(open)
      if (!open) {
        setKeyword("")
        setSubmitted(null)
        setSearchMounted(false)
      }
    }
    searchOpen.subscribe(listener)
    return () => searchOpen.unsubscribe(listener)
  }, [searchOpen])

  const hasCategory = info?.hasCategory ?? false
  const hasBoard = info?.hasRanking ?? false
  const pages = [
    { value: "explore", label: t("browse.explore") },
    ...(hasCategory ? [{ value: "category", label: t("browse.category") }] : []),
    ...(hasBoard ? [{ value: "ranking", label: t("browse.ranking") }] : []),
  ]

  const showCategory = hasCategory && mode === "category"
  const showRanking = hasBoard && mode === "ranking"
  const title = info?.name ?? t("browse.source")
  const allowsEmptySearch = info?.kind === "aidoku" || info?.kind === "mihon"
  const searchMode = submitted !== null || (allowsEmptySearch && searchActive)

  function handleKeywordChange(text: string) {
    setKeyword(text)
    if (text.trim() === "") setSubmitted(null)
  }

  function handleSubmitSearch() {
    const term = keyword.trim()
    if (!term && !allowsEmptySearch) return
    if (Keyboard.visible) Keyboard.hide()
    setSubmitted(term)
  }

  return (
    <VStack
      spacing={0}
      navigationTitle={title}
      navigationBarTitleDisplayMode="inline"
      searchable={
        searchMounted
          ? {
              placement: "toolbar",
              prompt: t("browse.searchInSource", { name: title }),
              value: keyword,
              onChanged: handleKeywordChange,
              presented: searchOpen,
            }
          : undefined
      }
      onSubmit={{ triggers: "search", action: handleSubmitSearch }}
      toolbar={
        <Toolbar>
          {searchMounted ? (
            liquidGlass ? <DefaultToolbarItem kind="search" placement="topBarTrailing" /> : null
          ) : (
            <ToolbarItem placement="topBarTrailing">
              <Button
                buttonStyle="plain"
                action={() => {
                  setSearchMounted(true)
                  setTimeout(() => searchOpen.setValue(true), 50)
                }}
              >
                <Image systemName="magnifyingglass" font="body" fontWeight="medium" foregroundStyle="label" />
              </Button>
            </ToolbarItem>
          )}
          {info?.kind === "mihon" && !searchActive && (
            <ToolbarItem placement="topBarTrailing">
              <NavigationLink
                accessibilityLabel={t("browse.web.open")}
                destination={<SourceWebViewScreen sourceKey={sourceKey} title={title} />}
              >
                <Image systemName="globe" font="body" fontWeight="medium" foregroundStyle="label" />
              </NavigationLink>
            </ToolbarItem>
          )}
          {pages.length > 1 && (
            <ToolbarItem placement="topBarTrailing">
              <Menu
                label={
                  <Image
                    systemName={
                      mode === "explore"
                        ? "line.3.horizontal.decrease.circle"
                        : "line.3.horizontal.decrease.circle.fill"
                    }
                    font="body"
                    fontWeight="medium"
                    foregroundStyle="label"
                  />
                }
              >
                <Picker
                  title={t("browse.viewLabel", {
                    label: pages.find(page => page.value === mode)?.label ?? t("browse.explore"),
                  })}
                  value={mode}
                  onChanged={setMode}
                >
                  {pages.map(page => (
                    <Text key={page.value} tag={page.value}>
                      {page.label}
                    </Text>
                  ))}
                </Picker>
              </Menu>
            </ToolbarItem>
          )}
        </Toolbar>
      }
    >
      {searchMode ? (
        <SourceSearchResults sourceKey={sourceKey} term={submitted ?? ""} />
      ) : showRanking ? (
        <RankingScreen sourceKey={sourceKey} />
      ) : showCategory ? (
        <CategoryScreen sourceKey={sourceKey} />
      ) : (
        <ExploreScreen sourceKey={sourceKey} />
      )}
    </VStack>
  )
}
