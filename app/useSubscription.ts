import { useEffect, useState } from "scripting"

export type Subscribe = (notify: () => void) => () => void

export function useSubscription(...sources: Subscribe[]): () => void {
  const [, setVersion] = useState(0)
  const refresh = () => setVersion(value => value + 1)

  useEffect(() => {
    const unsubscribes = sources.map(source => source(refresh))
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  }, [])

  return refresh
}
