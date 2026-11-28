import {
  Button,
  HStack,
  Image,
  Menu,
  ProgressView,
  Spacer,
  Toolbar,
  ToolbarItem,
  VStack,
  WebView,
  ZStack,
  useEffect,
  useRef,
  useState,
} from "scripting"

import { useSubscription } from "../../app/useSubscription"
import { Chip } from "../../design/chip"
import { NoticeBanner } from "../../design/status"
import { log } from "../../engine/log"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { MihonWebView } from "../../sources/mihonWeb"
import { findSource } from "../../sources/registry"

const EVENTS: WebViewEventType[] = ["stateChange", "commit", "loadFinish", "loadError"]

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function SourceWebViewScreen({ sourceKey, title }: { sourceKey: string; title: string }) {
  useSubscription(subscribeLocale)
  const webRef = useRef<MihonWebView | null>(null)
  if (!webRef.current) webRef.current = new MihonWebView(new WebViewController({ ephemeral: true }))
  const web = webRef.current
  const controller = web.controller
  const [state, setState] = useState<WebViewState | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function start(): Promise<void> {
    setMessage(null)
    try {
      const source = findSource(sourceKey)
      if (!source) throw new Error(t("sources.mihon.missing"))
      await web.start(source)
    } catch (error) {
      setMessage(t("common.loadFailed", { message: messageOf(error) }))
    }
  }

  useEffect(() => {
    let alive = true
    const listener = (event: WebViewEvent) => {
      if (alive) setState(event.state)
    }
    for (const type of EVENTS) void controller.addEventListener(type, listener)
    void start()
    return () => {
      alive = false
      void web
        .finish()
        .catch(error => log("warning", "mihon", `${sourceKey} 的網頁 cookie 沒寫回 dexvm`, error))
        .finally(() => {
          try {
            controller.dispose()
          } catch {
          }
        })
    }
  }, [])

  async function clearCookies(): Promise<void> {
    try {
      await web.clearCookies()
      controller.reload()
    } catch (error) {
      setMessage(t("common.failed", { message: messageOf(error) }))
    }
  }

  const loading = state?.isLoading ?? message === null

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <VStack
        spacing={0}
        navigationTitle={state?.title || title}
        navigationBarTitleDisplayMode="inline"
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarTrailing">
              <HStack spacing={16}>
                <Button
                  buttonStyle="plain"
                  disabled={!state?.canNavigateBack}
                  accessibilityLabel={t("browse.web.back")}
                  action={() => controller.goBack()}
                >
                  <Image systemName="chevron.backward" font="body" fontWeight="medium" foregroundStyle="label" />
                </Button>
                <Button
                  buttonStyle="plain"
                  disabled={!state?.canNavigateForward}
                  accessibilityLabel={t("browse.web.forward")}
                  action={() => controller.goForward()}
                >
                  <Image systemName="chevron.forward" font="body" fontWeight="medium" foregroundStyle="label" />
                </Button>
                <Menu
                  accessibilityLabel={t("browse.web.more")}
                  label={<Image systemName="ellipsis.circle" font="body" fontWeight="medium" foregroundStyle="label" />}
                >
                  <Button title={t("browse.refresh")} systemImage="arrow.clockwise" action={() => controller.reload()} />
                  <Button
                    title={t("browse.web.share")}
                    systemImage="square.and.arrow.up"
                    action={() => void ShareSheet.present([web.currentUrl()])}
                  />
                  <Button
                    title={t("browse.web.openInSafari")}
                    systemImage="safari"
                    action={() => void Safari.openURL(web.currentUrl())}
                  />
                  <Button title={t("browse.web.clearCookies")} systemImage="trash" action={() => void clearCookies()} />
                </Menu>
              </HStack>
            </ToolbarItem>
          </Toolbar>
        }
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        {loading ? (
          <ProgressView
            value={state?.estimatedProgress ?? 0}
            total={1}
            progressViewStyle="linear"
            frame={{ maxWidth: "infinity" }}
          />
        ) : null}
        <WebView controller={controller} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} />
      </VStack>

      {message ? (
        <VStack
          spacing={8}
          alignment="leading"
          padding={{ horizontal: 16, bottom: 24 }}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        >
          <Spacer />
          <NoticeBanner tone="error" text={message} />
          <Chip icon="arrow.clockwise" text={t("common.retry")} onTap={() => void start()} />
        </VStack>
      ) : null}
    </ZStack>
  )
}
