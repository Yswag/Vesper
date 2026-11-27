import { HStack, Image, ProgressView, Spacer, Text, VStack, useEffect, useMemo, useState, type Color, type StyledText } from "scripting"

import { comicLibrary } from "../app/services"
import { useResolvedColorScheme, useTint } from "../app/theme"
import { radius, rect } from "../design/tokens"
import { t } from "../i18n"

export interface CommentRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  link?: string
}

export interface CommentBody {
  runs: CommentRun[]
  images: string[]
}

const ALLOWED = new Set(["a", "b", "i", "u", "s", "br", "span", "img"])

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
}

function attr(body: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(body)
  if (!match) return undefined
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? "")
}

function spanStyle(body: string): Omit<CommentRun, "text"> {
  const style = (attr(body, "style") ?? "").toLowerCase().replace(/\s+/g, "")
  return {
    bold: /font-weight:bold|font-weight:(6|7|8|9)00/.test(style),
    italic: style.includes("font-style:italic"),
    underline: style.includes("underline"),
    strike: style.includes("line-through"),
  }
}

function openStyle(tag: string, body: string): Omit<CommentRun, "text"> {
  if (tag === "span") return spanStyle(body)
  if (tag === "b") return { bold: true }
  if (tag === "i") return { italic: true }
  if (tag === "u") return { underline: true }
  if (tag === "s") return { strike: true }
  return {}
}

export function parseComment(html: string): CommentBody {
  const runs: CommentRun[] = []
  const images: string[] = []
  const stack: Array<{ tag: string } & Omit<CommentRun, "text">> = []
  let buffer = ""

  const styles = (): Omit<CommentRun, "text"> => {
    const out: Omit<CommentRun, "text"> = {}
    for (const entry of stack) {
      if (entry.bold) out.bold = true
      if (entry.italic) out.italic = true
      if (entry.underline) out.underline = true
      if (entry.strike) out.strike = true
      if (entry.link) out.link = entry.link
    }
    return out
  }

  const flush = () => {
    if (!buffer) return
    runs.push({ ...styles(), text: decodeEntities(buffer) })
    buffer = ""
  }

  const close = (tag: string) => {
    for (let index = stack.length - 1; index >= 0; index--) {
      if (stack[index].tag === tag) {
        stack.splice(index, 1)
        return
      }
    }
  }

  const handle = (raw: string): boolean => {
    const closing = raw.startsWith("/")
    const body = closing ? raw.slice(1) : raw
    const tag = body.split(/[\s/]/)[0].toLowerCase()
    if (!ALLOWED.has(tag)) return false

    if (tag === "br") {
      flush()
      buffer += "\n"
      return true
    }
    if (tag === "img") {
      const src = closing ? undefined : attr(body, "src")
      if (src) {
        flush()
        images.push(src)
      }
      return true
    }
    if (tag === "a") {
      if (closing) close("a")
      else {
        const href = attr(body, "href")
        stack.push({ tag: "a", link: href && /^https?:/i.test(href) ? href : undefined })
      }
      flush()
      return true
    }
    if (closing) close(tag)
    else stack.push({ tag, ...openStyle(tag, body) })
    flush()
    return true
  }

  let cursor = 0
  while (cursor < html.length) {
    const open = html.indexOf("<", cursor)
    if (open < 0) {
      buffer += html.slice(cursor)
      break
    }
    buffer += html.slice(cursor, open)
    const end = html.indexOf(">", open)
    if (end < 0) {
      buffer += html.slice(open)
      break
    }
    if (!handle(html.slice(open + 1, end))) buffer += html.slice(open, end + 1)
    cursor = end + 1
  }
  flush()
  return { runs, images }
}

function toStyledText(runs: CommentRun[], color: Color, linkColor: Color): StyledText {
  return {
    font: "subheadline",
    foregroundColor: color,
    content: runs.map(run => {
      const node: StyledText = { content: run.text }
      if (run.bold) node.bold = true
      if (run.italic) node.italic = true
      if (run.underline) node.underlineStyle = "single"
      if (run.strike) node.strikethroughStyle = "single"
      if (run.link) {
        node.link = run.link
        node.foregroundColor = linkColor
        node.underlineStyle = "single"
      }
      return node
    }),
  }
}

function CommentImage({ sourceKey, src }: { sourceKey: string; src: string }) {
  const [image, setImage] = useState<UIImage | null>(null)
  const [aspect, setAspect] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setImage(null)
    setAspect(null)
    setFailed(false)

    void (async () => {
      try {
        const local = await comicLibrary().thumbnailPath(sourceKey, src)
        if (!alive) return
        const decoded = UIImage.fromFile(local)
        if (!decoded) {
          setFailed(true)
          return
        }
        setAspect(decoded.width / decoded.height)
        setImage(decoded)
      } catch {
        if (alive) setFailed(true)
      }
    })()

    return () => {
      alive = false
    }
  }, [src, sourceKey])

  if (image && aspect) {
    return (
      <Image
        image={image}
        resizable={true}
        aspectRatio={{ value: aspect, contentMode: "fit" }}
        clipShape={rect(radius.md)}
      />
    )
  }

  return (
    <HStack spacing={6} padding={{ vertical: 4 }} frame={{ maxWidth: "infinity" }}>
      {failed ? (
        <Text font="caption2" foregroundStyle="tertiaryLabel">
          {t("common.imageFailed")}
        </Text>
      ) : (
        <ProgressView />
      )}
      <Spacer />
    </HStack>
  )
}

export function CommentContent({
  sourceKey,
  content,
  color = "label",
}: {
  sourceKey: string
  content: string
  color?: Color
}) {
  const body = useMemo(() => parseComment(content), [content])
  const tint = useTint()
  const scheme = useResolvedColorScheme()
  const linkColor = String(tint.tint[scheme]) as Color
  const styled = useMemo(() => toStyledText(body.runs, color, linkColor), [body, color, linkColor])

  return (
    <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      {body.runs.length > 0 ? <Text styledText={styled} multilineTextAlignment="leading" /> : null}
      {body.images.map((src, index) => (
        <CommentImage key={`${index}:${src}`} sourceKey={sourceKey} src={src} />
      ))}
    </VStack>
  )
}
