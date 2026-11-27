import {
  Button,
  DefaultToolbarItem,
  Image,
  ToolbarItem,
  useEffect,
  useObservable,
  useState,
  type CommonViewProps,
} from "scripting"

import { liquidGlass } from "./glass"
import { t } from "../i18n"

export interface ToolbarSearch {
  query: string
  active: boolean
  searchable: CommonViewProps["searchable"]
  open: () => void
}

export function useToolbarSearch(prompt: string, initialQuery: string = ""): ToolbarSearch {
  const [text, setText] = useState(initialQuery)
  const [mounted, setMounted] = useState(initialQuery !== "")
  const presented = useObservable(false)

  useEffect(() => {
    const listener = (open: boolean) => {
      if (open) return
      setText("")
      setMounted(false)
    }
    presented.subscribe(listener)
    if (initialQuery) setTimeout(() => presented.setValue(true), 50)
    return () => presented.unsubscribe(listener)
  }, [presented])

  return {
    query: text.trim(),
    active: mounted,
    searchable: mounted ? { placement: "toolbar", prompt, value: text, onChanged: setText, presented } : undefined,
    open: () => {
      setMounted(true)
      setTimeout(() => presented.setValue(true), 50)
    },
  }
}

export function searchToolbarItem(search: ToolbarSearch) {
  if (search.active) return liquidGlass ? <DefaultToolbarItem kind="search" placement="topBarTrailing" /> : null
  return (
    <ToolbarItem placement="topBarTrailing">
      <Button buttonStyle="plain" accessibilityLabel={t("common.tabs.search")} action={search.open}>
        <Image systemName="magnifyingglass" font="body" fontWeight="medium" foregroundStyle="label" />
      </Button>
    </ToolbarItem>
  )
}

export function matchesQuery(query: string, ...fields: Array<string | undefined>): boolean {
  const needle = query.toLowerCase()
  return fields.some(field => field !== undefined && field.toLowerCase().includes(needle))
}
