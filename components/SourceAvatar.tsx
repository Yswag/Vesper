import { Image, Text, ZStack, useEffect, useState } from "scripting"
import { cardBackgroundStrong, rect, sourceIconSize } from "../design/tokens"
import { fetchAndCacheSourceIcon, getCachedSourceIcon } from "../engine/sourceicons"

export interface SourceAvatarProps {
  sourceKey: string
  name: string
  size?: number
  instance?: any
  iconUrl?: string
}

function isRemote(iconUrl: string): boolean {
  return /^https?:\/\//i.test(iconUrl)
}

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
  const letter = (
    <ZStack
      frame={{ width: size, height: size }}
      overlay={
        <Text font="subheadline" fontWeight="semibold" foregroundStyle="label">
          {firstLetter}
        </Text>
      }
    />
  )

  useEffect(() => {
    const local = localIconOf(iconUrl)
    const cached = local ? null : getCachedSourceIcon(sourceKey)
    setIcon(local ?? cached)
    if (local || cached) return

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
    return (
      <ZStack
        alignment="center"
        frame={{ width: size, height: size }}
        background={cardBackgroundStrong}
        clipShape={iconShape}
      >
        {letter}
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
      {letter}
    </ZStack>
  )
}
