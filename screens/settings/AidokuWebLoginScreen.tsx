// Aidoku 的 webview 登入頁：真的載入源的登入網址，按「完成」才收 cookie／localStorage
// 並寫進源設定；按「取消」什麼都不寫。
//
// 不重用 `sources/webLogin.ts` 的 `runWebLogin`：那條是 Venera 的「輪詢 checkStatus、
// 成功自己關」流程，而這裡要使用者自己按「完成」。WebViewController 與 localStorage
// 讀取仍沿用同一套（`dumpLocalStorage`）。

import { Button, Navigation, ProgressView, Spacer, Text, VStack, WebView, ZStack, useEffect, useRef, useState } from "scripting"

import { NoticeBanner } from "../../design/status"
import { useSubscription } from "../../app/useSubscription"
import { subscribe as subscribeLocale, t } from "../../i18n"
import type { AidokuSettingItem } from "../../sources/aidoku"
import { harvestAidokuLogin } from "../../sources/aidokuLogin"
import { loginAidokuWebview, notifyAidokuSource } from "../../sources/registry"

export function AidokuWebLoginScreen({ sourceKey, item }: { sourceKey: string; item: AidokuSettingItem }) {
  const dismiss = Navigation.useDismiss()
  useSubscription(subscribeLocale)
  const controllerRef = useRef<WebViewController | null>(null)
  if (!controllerRef.current) controllerRef.current = new WebViewController({ ephemeral: true })
  const controller = controllerRef.current
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        await controller.loadURL(item.url ?? "")
        await controller.waitForLoad()
      } catch (error) {
        if (alive) {
          setMessage(
            t("settings.aidokuSettings.webLoginFailed", {
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

  async function finish() {
    if (saving || loading) return
    setSaving(true)
    try {
      const data = await harvestAidokuLogin(controller, {
        url: item.url ?? "",
        localStorageKeys: item.localStorageKeys,
      })
      loginAidokuWebview(sourceKey, item.key, data)
      if (item.notification) await notifyAidokuSource(sourceKey, item.notification)
      dismiss()
    } catch (error) {
      setSaving(false)
      setMessage(
        t("settings.aidokuSettings.webLoginFailed", {
          message: error instanceof Error ? error.message : String(error),
        })
      )
    }
  }

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <VStack
        spacing={0}
        navigationTitle={item.title}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: (
            <Button buttonStyle="plain" disabled={saving} action={dismiss}>
              <Text font="body">{t("common.cancel")}</Text>
            </Button>
          ),
          topBarTrailing: (
            <Button buttonStyle="plain" disabled={saving || loading} action={() => void finish()}>
              <Text font="body" fontWeight="semibold">
                {t("settings.aidokuSettings.webLoginFinish")}
              </Text>
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
        <VStack spacing={0} padding={{ horizontal: 16, bottom: 24 }} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
          <Spacer />
          <NoticeBanner tone="error" text={message} />
        </VStack>
      ) : null}
    </ZStack>
  )
}
