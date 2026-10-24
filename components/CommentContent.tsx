// 留言內容的受限富文本。
//
// 源的約定（見源模板）：留言只會給 `a / b / i / u / s / br / span / img` 這幾種標籤，
// 我們也只認這幾種；**其他標籤連同標籤本身當純文字顯示**——不破版，也不會讓內容消失。
// 圖片一律放到留言最後面（上游就是這樣約定的），所以不需要做圖文混排。
//
// 頭像與圖片都走既有的圖片管線（源多半需要 Referer），失敗時誠實顯示，不畫破圖。
// 解析與快取都在 ComicLibrary.thumbnailPath 後面；這裡只認來源鍵與網址。

import { HStack, Image, ProgressView, Spacer, Text, VStack, useEffect, useMemo, useState, useColorScheme, type Color, type StyledText } from "scripting"

import { comicLibrary } from "../app/services"
import { useTint } from "../app/theme"
import { radius, rect } from "../design/tokens"
import { t } from "../i18n"

/** 一段文字與它身上的樣式；`link` 有值就是 `<a href>`。 */
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
  /** `img` 的 src，照出現順序；上游的約定是一律畫在文字後面。 */
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

/** 抓標籤裡的屬性（雙引號、單引號、無引號三種寫法）。 */
function attr(body: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(body)
  if (!match) return undefined
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? "")
}

/** `span` 的 `style` 只支援上游載明的三種。 */
function spanStyle(body: string): Omit<CommentRun, "text"> {
  const style = (attr(body, "style") ?? "").toLowerCase().replace(/\s+/g, "")
  return {
    bold: /font-weight:bold|font-weight:(6|7|8|9)00/.test(style),
    italic: style.includes("font-style:italic"),
    underline: style.includes("underline"),
    strike: style.includes("line-through"),
  }
}

/** 開始標籤身上的樣式。 */
function openStyle(tag: string, body: string): Omit<CommentRun, "text"> {
  if (tag === "span") return spanStyle(body)
  if (tag === "b") return { bold: true }
  if (tag === "i") return { italic: true }
  if (tag === "u") return { underline: true }
  if (tag === "s") return { strike: true }
  return {}
}

/**
 * 把留言的受限 HTML 拆成「文字片段 + 圖片」。
 *
 * 不認得的標籤不做任何解讀、也不會被吃掉：它連同 `<` `>` 一起留在文字裡，
 * 使用者至少還看得懂原始內容。`br` 變成換行。
 */
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

  /** 回 false ＝不是我們認得的標籤（呼叫端要把它當純文字留下）。 */
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

/** 片段 → 一個 `Text` 的 rich text（Scripting 的 Text 只吃字串，樣式只能靠 styledText）。 */
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

/** 留言裡附的圖。跟章節圖同一條管線（自己抓 → 快取 → 本地檔案）。 */
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
  const scheme = useColorScheme()
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
