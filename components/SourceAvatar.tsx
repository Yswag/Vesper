// 來源圓形圖標或首字徽章元件
// 若已有快取圖標則顯示來源網站圖標（以圓形剪裁），否則顯示首字圓形徽章並在背景靜默抓取。

import { Image, Text, VStack, ZStack, useEffect, useState } from "scripting"
import { cardBackgroundStrong, capsule } from "../design/tokens"
import { fetchAndCacheSourceIcon, getCachedSourceIcon } from "../engine/sourceicons"

export interface SourceAvatarProps {
  sourceKey: string
  name: string
  size?: number
  instance?: any
}

export function SourceAvatar({
  sourceKey,
  name,
  size = 40,
  instance,
}: SourceAvatarProps) {
  const [icon, setIcon] = useState<UIImage | null>(() => getCachedSourceIcon(sourceKey))
  const firstLetter = (name.trim().slice(0, 1) || "?").toUpperCase()

  useEffect(() => {
    // 檢查或重新整理圖標
    const cached = getCachedSourceIcon(sourceKey)
    if (cached) {
      setIcon(cached)
      return
    }

    let alive = true
    void (async () => {
      const cachedPath = await fetchAndCacheSourceIcon(sourceKey, instance)
      if (alive && cachedPath) {
        const decoded = getCachedSourceIcon(sourceKey)
        if (alive && decoded) {
          setIcon(decoded)
        }
      }
    })()

    return () => {
      alive = false
    }
  }, [sourceKey, instance])

  if (icon) {
    const innerSize = Math.round(size * 0.65)
    return (
      <ZStack
        alignment="center"
        frame={{ width: size, height: size }}
        background={cardBackgroundStrong}
        clipShape={capsule("circular")}
      >
        <Image
          image={icon}
          resizable={true}
          aspectRatio={{ contentMode: "fit" }}
          frame={{ width: innerSize, height: innerSize }}
        />
      </ZStack>
    )
  }

  return (
    <ZStack alignment="center" frame={{ width: size, height: size }}>
      <VStack
        alignment="center"
        frame={{ width: size, height: size }}
        background={cardBackgroundStrong}
        clipShape={capsule("circular")}
      >
        <Text font="subheadline" fontWeight="semibold" foregroundStyle="label">
          {firstLetter}
        </Text>
      </VStack>
    </ZStack>
  )
}
