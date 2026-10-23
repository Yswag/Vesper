// 來源圓角圖標或首字徽章元件（方案 B：iOS 圓角方塊 App Icon 樣式）
// 顯示順序：源自己給的圖示（本機檔案最優先，沒網路也看得到）→ 網站 favicon 快取 → 首字徽章。

import { Image, Text, ZStack, useEffect, useState } from "scripting"
import { cardBackgroundStrong, rect, sourceIconSize } from "../design/tokens"
import { fetchAndCacheSourceIcon, getCachedSourceIcon } from "../engine/sourceicons"

export interface SourceAvatarProps {
  sourceKey: string
  name: string
  size?: number
  instance?: any
  /** 源自己給的圖示：本機檔案路徑或遠端網址。 */
  iconUrl?: string
}

function isRemote(iconUrl: string): boolean {
  return /^https?:\/\//i.test(iconUrl)
}

/** 本機檔案才讀得起來；遠端網址交給 Image 自己去載。 */
function localIconOf(iconUrl?: string): UIImage | null {
  if (!iconUrl || isRemote(iconUrl)) return null
  try {
    return UIImage.fromFile(iconUrl)
  } catch {
    return null
  }
}

export function SourceAvatar({
  sourceKey,
  name,
  size = sourceIconSize,
  instance,
  iconUrl,
}: SourceAvatarProps) {
  const [icon, setIcon] = useState<UIImage | null>(() => localIconOf(iconUrl) ?? getCachedSourceIcon(sourceKey))
  const firstLetter = (name.trim().slice(0, 1) || "?").toUpperCase()
  const cornerRadius = Math.round(size * 0.22)
  const iconShape = rect(cornerRadius)

  useEffect(() => {
    // 源自己給的本機圖示：直接讀，不必碰網路。
    const local = localIconOf(iconUrl)
    if (local) {
      setIcon(local)
      return
    }

    // 檢查或重新整理網站圖標
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
  }, [sourceKey, instance, iconUrl])

  if (icon) {
    return (
      <ZStack
        alignment="center"
        frame={{ width: size, height: size }}
        background={cardBackgroundStrong}
        clipShape={iconShape}
      >
        <Image
          image={icon}
          resizable={true}
          aspectRatio={{ contentMode: "fill" }}
          frame={{ width: size, height: size }}
        />
      </ZStack>
    )
  }

  const remoteIcon = iconUrl && isRemote(iconUrl) ? iconUrl : undefined
  if (remoteIcon) {
    // 首字墊在下面：離線載不到圖時看到的是徽章，不是一個空圓角方塊。
    return (
      <ZStack
        alignment="center"
        frame={{ width: size, height: size }}
        background={cardBackgroundStrong}
        clipShape={iconShape}
      >
        <Text font="subheadline" fontWeight="semibold" foregroundStyle="label">
          {firstLetter}
        </Text>
        <Image
          imageUrl={remoteIcon}
          resizable={true}
          aspectRatio={{ contentMode: "fill" }}
          frame={{ width: size, height: size }}
        />
      </ZStack>
    )
  }

  return (
    <ZStack
      alignment="center"
      frame={{ width: size, height: size }}
      background={cardBackgroundStrong}
      clipShape={iconShape}
    >
      <Text font="subheadline" fontWeight="semibold" foregroundStyle="label">
        {firstLetter}
      </Text>
    </ZStack>
  )
}
