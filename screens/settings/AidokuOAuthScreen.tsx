// Aidoku 的 oauth 登入頁：開真的授權頁，攔到自訂 scheme 的 callback 後換 token。
// token 原文（或 callback URL）寫進源設定，`<key>.codeVerifier` 留給源自己刷新用。

import { Button, Navigation, ProgressView, Spacer, Text, VStack, WebView, ZStack, useEffect, useRef, useState } from "scripting"

import { useSubscription } from "../../app/useSubscription"
import { NoticeBanner } from "../../design/status"
import { Chip } from "../../design/chip"
import { subscribe as subscribeLocale, t } from "../../i18n"
import type { AidokuSettingItem } from "../../sources/aidoku"
import { codeOf, exchangeToken, paramsOf, randomVerifier, withPkce } from "../../sources/aidokuOAuth"
import { findSource, loginAidokuOAuth, notifyAidokuSource, updateAidokuSetting } from "../../sources/registry"

export function AidokuOAuthScreen({ sourceKey, item }: { sourceKey: string; item: AidokuSettingItem }) {
  const dismiss = Navigation.useDismiss()
  useSubscription(subscribeLocale)
  const controllerRef = useRef<WebViewController | null>(null)
  if (!controllerRef.current) controllerRef.current = new WebViewController({ ephemeral: true })
  const controller = controllerRef.current
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const finished = useRef(false)
  const authUrlRef = useRef("")
  const verifierRef = useRef("")

  async function complete(callbackUrl: string) {
    try {
      const value =
        item.pkce && item.tokenUrl
          ? await exchangeToken({
              tokenUrl: item.tokenUrl,
              code: codeOf(callbackUrl),
              verifier: verifierRef.current,
              ...paramsOf(authUrlRef.current),
            })
          : callbackUrl
      loginAidokuOAuth(sourceKey, item.key, value)
      if (item.notification) await notifyAidokuSource(sourceKey, item.notification)
      dismiss()
    } catch (error) {
      finished.current = false
      setMessage(
        t("settings.aidokuSettings.oauthFailed", {
          message: error instanceof Error ? error.message : String(error),
        })
      )
    }
  }

  async function retryLoad() {
    setMessage(null)
    setLoading(true)
    try {
      await controller.loadURL(authUrlRef.current)
      await controller.waitForLoad()
    } catch (error) {
      setMessage(
        t("settings.aidokuSettings.oauthFailed", {
          message: error instanceof Error ? error.message : String(error),
        })
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let alive = true
    const scheme = `${item.callbackScheme || "aidoku"}://`
    void (async () => {
      try {
        const source = findSource(sourceKey)
        const raw = item.urlKey ? source?.stored.settings?.[item.urlKey] : item.url
        const authUrl = typeof raw === "string" ? raw.trim() : ""
        if (!authUrl) throw new Error(t("settings.aidokuSettings.oauthMissingUrl"))

        let url = authUrl
        if (item.pkce) {
          verifierRef.current = randomVerifier()
          url = withPkce(authUrl, verifierRef.current)
          // 源刷新 token 時會讀這個 key。
          updateAidokuSetting(sourceKey, `${item.key}.codeVerifier`, verifierRef.current)
        }
        authUrlRef.current = url

        controller.shouldAllowRequest = async request => {
          if (!request.url.toLowerCase().startsWith(scheme.toLowerCase())) return true
          if (!finished.current) {
            finished.current = true
            void complete(request.url)
          }
          return false
        }

        await controller.loadURL(url)
        await controller.waitForLoad()
      } catch (error) {
        if (alive) {
          setMessage(
            t("settings.aidokuSettings.oauthFailed", {
              message: error instanceof Error ? error.message : String(error),
            })
          )
        }
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
      try {
        controller.dispose()
      } catch {
        // 已經壞掉的 controller 就算了
      }
    }
  }, [])

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <VStack
        spacing={0}
        navigationTitle={item.title}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: (
            <Button buttonStyle="plain" action={dismiss}>
              <Text font="body">{t("common.cancel")}</Text>
            </Button>
          ),
        }}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        <WebView controller={controller} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} />
      </VStack>

      {loading ? (
        <VStack spacing={8} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
          <ProgressView />
          <Text font="footnote" foregroundStyle="secondaryLabel">
            {t("common.loading")}
          </Text>
        </VStack>
      ) : null}

      {message ? (
        <VStack
          spacing={8}
          alignment="leading"
          padding={{ horizontal: 16, bottom: 24 }}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        >
          <Spacer />
          <NoticeBanner tone="error" text={message} />
          <Chip icon="arrow.clockwise" text={t("common.retry")} onTap={() => void retryLoad()} />
        </VStack>
      ) : null}
    </ZStack>
  )
}
