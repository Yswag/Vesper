// 源登入：三種形狀都支援 —— 帳密（`account.login`）、Cookie 欄位（`loginWithCookies`）、
// 瀏覽器（`loginWithWebview`：真的開一個瀏覽器，Cloudflare 過盾與 localStorage 型憑證都在這條）。
//
// 版面全走 design/（頁面殼 · 卡片 · 列 · 狀態橫幅），跟設定分頁其他頁面同一套語言。
//
// 注意：Scripting 的 TextField 沒有遮蔽輸入的選項，所以密碼欄位是可見的。

import { Divider, HStack, Image, ProgressView, Text, VStack, useEffect, useState } from "scripting"
import { CardGroup, PageScroll } from "../../design/layout"
import { ActionRow, FormInputRow, InfoRow, TextInputRow, rowSeparatorInset } from "../../design/rows"
import { EmptyState, NoticeBanner, statusTone, type StatusNotice } from "../../design/status"
import { SkeletonCardGroups } from "../../design/skeleton"
import { radius, rect } from "../../design/tokens"
import { useTint } from "../../app/theme"
import { t } from "../../i18n"
import { accountSpec, findSource, loginWithCookies, loginWithPassword, loginWithWebview, logoutSource, reloadRegistry, type AccountSpec, type InstalledSource } from "../../sources/registry"

export function SourceAccountScreen({ sourceKey }: { sourceKey: string }) {
  const tint = useTint()
  const [source, setSource] = useState<InstalledSource | undefined>(undefined)
  const [spec, setSpec] = useState<AccountSpec | null>(null)
  const [values, setValues] = useState<string[]>([])
  const [account, setAccount] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<StatusNotice | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    reloadRegistry()
    const found = findSource(sourceKey)
    setSource(found)
    const detected = found ? accountSpec(found) : null
    setSpec(detected)
    setValues(detected ? detected.cookieFields.map(() => "") : [])
    setLoaded(true)
  }, [sourceKey])

  /** `label` 是動作本身（`settings.shared.login`…）：狀態與對話框標題都用它。 */
  async function run(label: string, task: () => Promise<string | void>) {
    setBusy(true)
    setStatus({ kind: "loading", text: t("common.inProgress", { label }) })
    try {
      const message = await task()
      // 源沒有回訊息就沒有橫幅（訊息是資料，不是狀態）。
      setStatus(message ? { kind: "ready", text: message } : null)
      setSource(findSource(sourceKey))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus({ kind: "error", text: t("common.failed", { message }) })
      await Dialog.alert({ title: label, message })
    } finally {
      setBusy(false)
    }
  }

  const login = t("settings.shared.login")
  const logout = t("settings.shared.logout")
  const loggedIn = source?.stored.loggedIn === true
  const unsupported = spec !== null && !spec.supportsPassword && spec.cookieFields.length === 0 && !spec.webviewUrl

  return (
    <PageScroll title={login}>
      {status ? <NoticeBanner tone={statusTone(status.kind)} text={status.text} /> : null}

      {!loaded ? (
        <SkeletonCardGroups />
      ) : !spec ? (
        <EmptyState variant="page" icon="person.crop.circle" title={t("settings.account.noLoginNeeded")} />
      ) : loggedIn ? (
        <CardGroup title={t("settings.shared.loggedIn")} footnote={t("settings.account.logoutFootnote")}>
          <InfoRow
            label={t("settings.shared.account")}
            value={source?.stored.accountName ?? t("settings.shared.loggedIn")}
          />
          <Divider padding={{ leading: rowSeparatorInset }} />
          <ActionRow
            icon="rectangle.portrait.and.arrow.right"
            title={logout}
            tone="destructive"
            busy={busy}
            onTap={() => void run(logout, () => logoutSource(sourceKey))}
          />
        </CardGroup>
      ) : (
        <>
          {spec.supportsPassword ? (
            <VStack spacing={14}>
              <CardGroup title={t("settings.account.passwordGroup")}>
                <FormInputRow
                  icon="person"
                  label={t("settings.shared.account")}
                  value={account}
                  prompt={t("settings.account.accountPrompt")}
                  onChanged={setAccount}
                />
                <Divider padding={{ leading: rowSeparatorInset }} />
                <FormInputRow
                  icon="key"
                  label={t("settings.shared.password")}
                  value={password}
                  prompt={t("settings.account.passwordPrompt")}
                  onChanged={setPassword}
                />
              </CardGroup>

              <HStack
                alignment="center"
                frame={{ maxWidth: "infinity", minHeight: 50 }}
                background={tint.tint}
                clipShape={rect(radius.md)}
                opacity={busy ? 0.75 : 1}
                onTapGesture={busy ? undefined : () => void run(login, () => loginWithPassword(sourceKey, account.trim(), password))}
              >
                {busy ? (
                  <ProgressView controlSize="small" />
                ) : (
                  <HStack spacing={6} alignment="center">
                    <Text font="headline" fontWeight="semibold" foregroundStyle={tint.onTint}>
                      {login}
                    </Text>
                  </HStack>
                )}
              </HStack>

              {spec.registerUrl ? (
                <HStack
                  alignment="center"
                  frame={{ maxWidth: "infinity" }}
                  padding={{ top: 2, bottom: 4 }}
                  onTapGesture={() => void Safari.openURL(spec.registerUrl ?? "")}
                >
                  <Text font="subheadline" foregroundStyle={tint.tint}>
                    {t("settings.account.registerNow")}
                  </Text>
                  <Image systemName="arrow.up.forward" font="caption2" foregroundStyle={tint.tint} />
                </HStack>
              ) : null}
            </VStack>
          ) : null}

          {spec.cookieFields.length > 0 ? (
            <VStack spacing={14}>
              <CardGroup title={t("settings.account.cookieGroup")} footnote={t("settings.account.cookieFootnote")}>
                {spec.cookieFields.map((field, index) => (
                  <VStack key={field} spacing={0}>
                    {index > 0 ? <Divider padding={{ leading: rowSeparatorInset }} /> : null}
                    <TextInputRow
                      label={field}
                      value={values[index] ?? ""}
                      onChanged={next => {
                        const copy = [...values]
                        copy[index] = next
                        setValues(copy)
                      }}
                    />
                  </VStack>
                ))}
              </CardGroup>

              <HStack
                alignment="center"
                frame={{ maxWidth: "infinity", minHeight: 50 }}
                background={tint.tint}
                clipShape={rect(radius.md)}
                opacity={busy ? 0.75 : 1}
                onTapGesture={busy ? undefined : () => void run(login, () => loginWithCookies(sourceKey, values.map(value => value.trim())))}
              >
                {busy ? (
                  <ProgressView controlSize="small" />
                ) : (
                  <Text font="headline" fontWeight="semibold" foregroundStyle={tint.onTint}>
                    {login}
                  </Text>
                )}
              </HStack>

              {!spec.supportsPassword && spec.registerUrl ? (
                <HStack
                  alignment="center"
                  frame={{ maxWidth: "infinity" }}
                  padding={{ top: 2, bottom: 4 }}
                  onTapGesture={() => void Safari.openURL(spec.registerUrl ?? "")}
                >
                  <Text font="subheadline" foregroundStyle={tint.tint}>
                    {t("settings.account.registerNow")}
                  </Text>
                  <Image systemName="arrow.up.forward" font="caption2" foregroundStyle={tint.tint} />
                </HStack>
              ) : null}
            </VStack>
          ) : null}

          {spec.webviewUrl ? (
            <CardGroup
              title={t("settings.account.webviewGroup")}
              footnote={t("settings.account.webviewFootnote")}
            >
              <ActionRow
                icon="safari"
                iconColor={tint.tint}
                title={t("settings.account.webviewAction")}
                busy={busy}
                onTap={() => void run(login, () => loginWithWebview(sourceKey))}
              />
            </CardGroup>
          ) : null}
        </>
      )}

      {unsupported ? (
        <NoticeBanner
          tone="error"
          text={t("settings.account.unsupported")}
          detail={t("settings.account.unsupportedDetail")}
        />
      ) : null}
    </PageScroll>
  )
}
