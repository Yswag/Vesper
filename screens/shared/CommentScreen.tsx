// 留言頁：從詳情頁進來，看留言（頭像、名字、時間、內容）並在底部輸入框送出。
//
// 四條規則：① 留言不落地、不快取——每次進來都重新讀；② 只有源給了可用的 `maxPage`
// 才出現「載入更多」；③ 送出失敗照源的原話顯示（`nhentai` 的 stub 就是這樣被抓到的）；
// ④ 輸入框是 ScrollView 的 `safeAreaInset`（不是疊在下面的另一層），留言才不會被它蓋住、
// 也不會為了閃它而留一段假的高度。

import {
  Button,
  Divider,
  GeometryReader,
  HStack,
  Image,
  NavigationLink,
  RoundedRectangle,
  ScrollView,
  Spacer,
  Text,
  TextField,
  VStack,
  ZStack,
  useEffect,
  useRef,
  useState,
} from "scripting"

import { CommentContent } from "../../components/CommentContent"
import { type SourceComment } from "../../app/comic"
import { comicLibrary } from "../../app/services"
import { useSubscription } from "../../app/useSubscription"
import { PageBackground, useTint } from "../../app/theme"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { formatCommentTime } from "./commentTime"
import { Card } from "../../design/layout"
import { ActionRow } from "../../design/rows"
import { EmptyState, ListFooter, NoticeBanner, PageLoading, statusTone, type StatusNotice } from "../../design/status"
import {
  avatarSize,
  capsule,
  cardBackground,
  cardGap,
  fill,
  hairlineStroke,
  palette,
  radius,
  rect,
} from "../../design/tokens"
import { SourceAccountScreen } from "../settings/SourceAccountScreen"

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 送出時本機回音的那一則：使用者打的是純文字，先把 HTML 字元跳脫掉再交給渲染層。 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** 頭像抓不到時顯示的首字母。用 Array.from 才不會把 emoji 拆成半個。 */
function firstGlyph(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return "?"
  return Array.from(trimmed)[0].toUpperCase()
}

/** 圓形頭像：抓不到（或源根本沒給）就退回名字首字母，不畫破圖。 */
export function CommentAvatar({ sourceKey, url, name }: { sourceKey: string; url?: string; name: string }) {
  const [image, setImage] = useState<UIImage | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setImage(null)
    setFailed(false)
    if (!url) {
      setFailed(true)
      return
    }
    // 縮圖管線（源的 onThumbnailLoad）；頭像多半需要 Referer。
    void (async () => {
      try {
        const path = await comicLibrary().thumbnailPath(sourceKey, url)
        if (!alive) return
        const decoded = UIImage.fromFile(path)
        if (decoded) setImage(decoded)
        else setFailed(true)
      } catch {
        if (alive) setFailed(true)
      }
    })()

    return () => {
      alive = false
    }
  }, [url, sourceKey])

  return (
    <ZStack
      alignment="center"
      frame={{ width: avatarSize, height: avatarSize }}
      background={fill.surface}
      clipShape={capsule("circular")}
    >
      {image && !failed ? (
        <Image
          image={image}
          resizable={true}
          aspectRatio={{ contentMode: "fill" }}
          frame={{ width: avatarSize, height: avatarSize }}
        />
      ) : (
        <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">
          {firstGlyph(name)}
        </Text>
      )}
    </ZStack>
  )
}

export function CommentRow({
  sourceKey,
  comment,
  isLast,
}: {
  sourceKey: string
  comment: SourceComment
  isLast?: boolean
}) {
  return (
    <VStack spacing={0} frame={{ maxWidth: "infinity" }}>
      <HStack
        spacing={12}
        alignment="top"
        padding={{ horizontal: 16, vertical: 12 }}
        frame={{ maxWidth: "infinity" }}
      >
        <CommentAvatar sourceKey={sourceKey} url={comment.avatar} name={comment.userName} />
        <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <HStack spacing={8} alignment="firstTextBaseline" frame={{ maxWidth: "infinity" }}>
            <Text font="subheadline" fontWeight="semibold" lineLimit={1}>
              {comment.userName || t("comments.anonymous")}
            </Text>
            <Spacer />
            {comment.time ? (
              <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1}>
                {formatCommentTime(comment.time)}
              </Text>
            ) : null}
          </HStack>
          {comment.content ? <CommentContent sourceKey={sourceKey} content={comment.content} /> : null}
          {comment.replyCount && comment.replyCount > 0 ? (
            <HStack
              spacing={4}
              padding={{ horizontal: 8, vertical: 3 }}
              background="quaternarySystemFill"
              clipShape={capsule()}
            >
              <Image systemName="bubble.left" font="caption2" foregroundStyle="secondaryLabel" />
              <Text font="caption2" foregroundStyle="secondaryLabel" fontWeight="medium">
                {t("comments.replyCount", { n: comment.replyCount })}
              </Text>
            </HStack>
          ) : null}
        </VStack>
      </HStack>
      {!isLast ? (
        <HStack padding={{ leading: 64, trailing: 16 }} frame={{ maxWidth: "infinity" }}>
          <Divider />
        </HStack>
      ) : null}
    </VStack>
  )
}

/**
 * 未登入時引導登入的橫幅（未登入也看得到留言，只是送不出去）。
 *
 * 內距、間距、圖示格子都跟 `CommentRow` 同一組：圖示佔一格頭像的寬度，
 * 這樣圖示的中心跟頭像同一條線、文字也跟留言的文字同一條線。
 */
export function LoginBanner({ sourceKey }: { sourceKey: string }) {
  const tint = useTint()
  return (
    <NavigationLink destination={<SourceAccountScreen sourceKey={sourceKey} />} buttonStyle="plain">
      <HStack
        spacing={12}
        alignment="center"
        padding={{ horizontal: 16, vertical: 12 }}
        background={tint.info}
        clipShape={rect(radius.lg)}
        overlay={<RoundedRectangle cornerRadius={radius.lg} stroke={tint.selected} />}
        frame={{ maxWidth: "infinity" }}
      >
        <ZStack alignment="center" frame={{ width: avatarSize, height: avatarSize }}>
          <Image systemName="person.crop.circle.badge.exclamationmark" font="title3" foregroundStyle={tint.tint} />
        </ZStack>
        {/* frame 的 alignment 不給就是中心——文字會被丟到中間去，一定要寫 leading */}
        <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Text font="subheadline" fontWeight="semibold" foregroundStyle={tint.tint}>
            {t("comments.notLoggedIn")}
          </Text>
          <Text font="caption2" foregroundStyle="secondaryLabel">
            {t("comments.loginHint")}
          </Text>
        </VStack>
        <HStack spacing={4} alignment="center">
          <Text font="caption" fontWeight="medium" foregroundStyle={tint.tint}>
            {t("comments.goLogin")}
          </Text>
          <Image systemName="chevron.right" font="caption2" foregroundStyle={tint.tint} />
        </HStack>
      </HStack>
    </NavigationLink>
  )
}

/**
 * 懸浮液態玻璃輸入列。掛在 ScrollView 的 `safeAreaInset(bottom)` 上，
 * 無外層通欄背景，懸浮在列表上方，原生 Liquid Glass 質感。
 */
export function CommentComposer({
  draft,
  sending,
  sendStatus,
  onChanged,
  onSend,
}: {
  draft: string
  sending: boolean
  sendStatus: StatusNotice | null
  onChanged: (value: string) => void
  onSend: () => void
}) {
  const tint = useTint()
  const filled = draft.trim().length > 0
  return (
    <VStack spacing={6} padding={{ horizontal: 16, vertical: 8 }} frame={{ maxWidth: "infinity" }}>
      {sendStatus ? <NoticeBanner tone={statusTone(sendStatus.kind)} text={sendStatus.text} /> : null}
      <HStack
        spacing={10}
        alignment="center"
        padding={{ leading: 14, trailing: 8, vertical: 6 }}
        glassEffect={{ glass: UIGlass.regular().interactive(), shape: capsule() }}
        frame={{ maxWidth: "infinity" }}
      >
        <Image systemName="pencil" font="subheadline" foregroundStyle="secondaryLabel" />
        <TextField
          title=""
          prompt={t("comments.composerPrompt")}
          value={draft}
          axis="vertical"
          lineLimit={{ min: 1, max: 4 }}
          textFieldStyle="plain"
          onChanged={onChanged}
          frame={{ maxWidth: "infinity" }}
        />
        <Button buttonStyle="plain" disabled={sending || !filled} action={onSend}>
          <ZStack
            frame={{ width: 34, height: 34 }}
            background={filled ? tint.tint : "quaternarySystemFill"}
            clipShape={capsule("circular")}
          >
            <Image
              systemName="arrow.up"
              font="subheadline"
              fontWeight="bold"
              foregroundStyle={filled ? tint.onTint : "tertiaryLabel"}
            />
          </ZStack>
        </Button>
      </HStack>
    </VStack>
  )
}

export function CommentScreen({
  sourceKey,
  comicId,
  subId,
}: {
  sourceKey: string
  comicId: string
  subId?: string
}) {
  const library = comicLibrary()
  const tint = useTint()
  const info = library.source(sourceKey)
  const [comments, setComments] = useState<SourceComment[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  // 這一頁的兩處訊息狀態：`status` 是讀取失敗的原因（null＝沒話要說，不是空字串）、
  // `sendStatus` 是底部輸入列那一則。兩者要顯示的字都在 render 時才算。
  const [status, setStatus] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [sendStatus, setSendStatus] = useState<StatusNotice | null>(null)

  // 語言一換就重繪：`t()` 讀的是模組層級的當前語言，畫面得自己訂閱。
  useSubscription(subscribeLocale)

  // 離開頁面後不要再 setState（使用者可能已經退回詳情頁）。
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  async function fetchPage(targetPage: number, replace: boolean) {
    setLoading(true)
    try {
      const result = await library.comments({ sourceKey, comicId, subId }, targetPage)
      if (!alive.current) return
      setComments(previous => (replace ? result.comments : [...previous, ...result.comments]))
      setHasMore(result.hasMore)
      setPage(targetPage)
      setStatus(null)
    } catch (error) {
      if (alive.current) setStatus(messageOf(error))
    } finally {
      if (alive.current) setLoading(false)
    }
  }

  useEffect(() => {
    // 留言不落地：每次進來都重新讀第一頁。
    void fetchPage(1, true)
  }, [sourceKey, comicId])

  async function submit() {
    if (sending) return
    const content = draft.trim()
    if (!content) return
    setSending(true)
    setSendStatus({ kind: "loading", text: t("comments.sending") })
    try {
      await library.postComment({ sourceKey, comicId, subId }, content)
      if (!alive.current) return
      setDraft("")
      Keyboard.hide()
      setSendStatus({ kind: "ready", text: t("comments.sent") })
      // 源的排序不假設：直接把剛送出的那一則放在最前面（內容與帳號名稱都是我們確定的）。
      setComments(previous => [
        {
          id: `sent:${Date.now()}`,
          userName: info?.accountName ?? t("comments.me"),
          content: escapeHtml(content),
          // 時間記「現在」這個時間戳，不寫「剛剛」——那是顯示字，由 commentTime 算。
          time: new Date().toISOString(),
        },
        ...previous,
      ])
    } catch (error) {
      setSendStatus({ kind: "error", text: t("common.failed", { message: messageOf(error) }) })
    } finally {
      if (alive.current) setSending(false)
    }
  }

  const needsLogin = info?.needsLogin === true
  const empty = !loading && status === null && comments.length === 0

  return (
    <ZStack tabBarVisibility="hidden">
      <PageBackground />
      <GeometryReader>
        {proxy => (
          <VStack
            spacing={0}
            navigationTitle={t("comments.title")}
            navigationBarTitleDisplayMode="inline"
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          >
            {loading && comments.length === 0 ? <PageLoading text={t("comments.loading")} /> : null}

            <ScrollView
              scrollContentBackground="hidden"
              scrollDismissesKeyboard="interactively"
              frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
              safeAreaInset={{
                bottom: {
                  content: (
                    <CommentComposer
                      draft={draft}
                      sending={sending}
                      sendStatus={sendStatus}
                      onChanged={setDraft}
                      onSend={() => void submit()}
                    />
                  ),
                },
              }}
            >
              <VStack
                spacing={cardGap}
                padding={{
                  horizontal: 16,
                  top: 14,
                  bottom: 16,
                }}
                frame={{ maxWidth: "infinity" }}
                onTapGesture={() => {
                  if (Keyboard.visible) Keyboard.hide()
                }}
              >
                {!loading && status !== null ? (
                  <NoticeBanner tone="error" text={t("comments.loadFailed")} detail={status} />
                ) : null}

                {needsLogin ? <LoginBanner sourceKey={sourceKey} /> : null}

                {empty ? (
                  <EmptyState icon="bubble.left" title={t("comments.empty")} detail={t("comments.emptyHint")} />
                ) : null}

                {comments.length > 0 ? (
                  <VStack
                    spacing={0}
                    background={cardBackground}
                    clipShape={rect(radius.lg)}
                    overlay={<RoundedRectangle cornerRadius={radius.lg} stroke={hairlineStroke} />}
                    frame={{ maxWidth: "infinity" }}
                  >
                    {comments.map((comment, index) => (
                      <CommentRow
                        key={`${index}:${comment.id}`}
                        sourceKey={sourceKey}
                        comment={comment}
                        isLast={index === comments.length - 1}
                      />
                    ))}
                  </VStack>
                ) : null}

                {hasMore ? (
                  <Card>
                    <ActionRow
                      icon="arrow.down.circle"
                      iconColor={tint.tint}
                      title={loading ? t("common.loadingMore") : t("comments.loadMore")}
                      disabled={loading}
                      onTap={() => void fetchPage(page + 1, false)}
                    />
                  </Card>
                ) : comments.length > 0 ? (
                  <ListFooter loading={false} />
                ) : null}
              </VStack>
            </ScrollView>
          </VStack>
        )}
      </GeometryReader>
    </ZStack>
  )
}
