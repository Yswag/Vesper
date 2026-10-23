// Aidoku 源的設定頁：把 `Payload/settings.json` 的 schema 畫成列。
//
// 範圍（v1）：group 一張卡片、page 攤平成同一頁（不做巢狀子頁）；
// `login` 做 `method: "basic"`（寫 `<key>.username` / `<key>.password` / `<key>`）
// 與 `method: "webview"`（開登入頁，寫 `<key>.keys` / `.values` / `.ls.*` / `<key>`）；
// `oauth` 的登入、`editable-list`、`button` 只顯示「尚未支援」。
//
// 值只寫使用者改過的 key（`installed.json` 的 `settings`），沒改的就是 schema 預設；
// 改完會讓源下次呼叫時重載（見 `sources/aidoku.ts` 的 `setSetting`）。

import { Divider, HStack, Navigation, NavigationLink, NavigationStack, Slider, Spacer, Stepper, Text, VStack, useEffect, useState } from "scripting"

import { languageName } from "../../app/languageNames"
import { Card, CardGroup, PageScroll } from "../../design/layout"
import {
  ActionRow,
  IconBadge,
  IconRow,
  InfoRow,
  OptionRow,
  SelectRow,
  TextInputRow,
  ToggleRow,
  rowSeparatorInset,
} from "../../design/rows"
import { EmptyState, NoticeBanner, statusTone, type StatusNotice } from "../../design/status"
import { rowPadding } from "../../design/tokens"
import { hostOf } from "../../engine/cookies"
import { t } from "../../i18n"
import type { AidokuSettingControl, AidokuSettingGroup, AidokuSettingItem, AidokuSettingsSpec } from "../../sources/aidoku"
import {
  findSource,
  loginAidokuBasic,
  logoutAidokuBasic,
  logoutAidokuOAuth,
  logoutAidokuWebview,
  reloadRegistry,
  resetAidokuSettings,
  subscribeSources,
  updateAidokuSetting,
  type InstalledSource,
} from "../../sources/registry"
import { AidokuWebLoginScreen } from "./AidokuWebLoginScreen"
import { AidokuOAuthScreen } from "./AidokuOAuthScreen"
import { AidokuLanguageScreen } from "./AidokuLanguageScreen"

const CONTROL_ICON: Record<AidokuSettingControl, string> = {
  select: "list.bullet",
  multi: "checklist",
  switch: "switch.2",
  text: "character.cursor.ibeam",
  slider: "slider.horizontal.3",
  stepper: "plus.forwardslash.minus",
  login: "person.crop.circle",
  unsupported: "nosign",
}

/** 多選的值（不是陣列就當成空）。 */
function valuesOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(value => String(value ?? "")) : []
}

/** basic 登入寫進去的三個鍵（子鍵在 source 的 `login.username` 這種位置）。 */
function loginKeys(settingKey: string): { name: string; password: string; state: string } {
  return {
    name: `${settingKey}.username`,
    password: `${settingKey}.password`,
    state: settingKey,
  }
}

/** 語言列的右側摘要：選了什麼（最多兩顆名字，其餘給 +N）。 */
function languageDetail(spec: AidokuSettingsSpec, overrides: Record<string, unknown>): string {
  const stored = Array.isArray(overrides.languages) ? overrides.languages.map(value => String(value ?? "")) : null
  const selected = stored ?? spec.defaultLanguages
  if (selected.length === 0) return t("settings.aidokuSettings.languageNone")
  const names = selected.slice(0, 2).map(languageName)
  return selected.length > 2 ? `${names.join("、")} +${selected.length - 2}` : names.join("、")
}

export function AidokuSettingsScreen({ sourceKey }: { sourceKey: string }) {
  const [source, setSource] = useState<InstalledSource | undefined>(undefined)
  const [status, setStatus] = useState<StatusNotice | null>(null)

  useEffect(() => {
    reloadRegistry()
    setSource(findSource(sourceKey))
    setStatus(null)
  }, [sourceKey])

  // 從語言子頁回來時，registry 已經換了新值：跟著重讀，摘要才會是對的。
  useEffect(() => subscribeSources(() => setSource(findSource(sourceKey))), [sourceKey])

  const spec = source?.settingsSpec
  const overrides = source?.stored.settings ?? {}
  const hasContent = Boolean(spec && (spec.groups.length > 0 || spec.languages.length > 1))

  function refresh() {
    setSource(findSource(sourceKey))
  }

  function apply(id: string, value: unknown) {
    if (value === overrides[id]) return
    updateAidokuSetting(sourceKey, id, value)
    refresh()
    setStatus({ kind: "ready", text: t("settings.aidokuSettings.saved") })
  }

  function login(settingKey: string, username: string, password: string) {
    loginAidokuBasic(sourceKey, settingKey, username, password)
    refresh()
    setStatus({ kind: "ready", text: t("settings.aidokuSettings.loggedIn") })
  }

  async function webLogin(item: AidokuSettingItem) {
    if (!item.url) return
    await Navigation.present({
      element: (
        <NavigationStack>
          <AidokuWebLoginScreen sourceKey={sourceKey} item={item} />
        </NavigationStack>
      ),
      modalPresentationStyle: "fullScreen",
    })
    refresh()
    const next = findSource(sourceKey)
    if (next?.stored.settings?.[item.key] === "logged_in") {
      setStatus({ kind: "ready", text: t("settings.aidokuSettings.loggedIn") })
    }
  }

  async function oauthLogin(item: AidokuSettingItem) {
    await Navigation.present({
      element: (
        <NavigationStack>
          <AidokuOAuthScreen sourceKey={sourceKey} item={item} />
        </NavigationStack>
      ),
      modalPresentationStyle: "fullScreen",
    })
    refresh()
    const next = findSource(sourceKey)
    if (typeof next?.stored.settings?.[item.key] === "string") {
      setStatus({ kind: "ready", text: t("settings.aidokuSettings.loggedIn") })
    }
  }

  function logout(settingKey: string, method?: string) {
    if (method === "webview") logoutAidokuWebview(sourceKey, settingKey)
    else if (method === "oauth") logoutAidokuOAuth(sourceKey, settingKey)
    else logoutAidokuBasic(sourceKey, settingKey)
    refresh()
    setStatus({ kind: "ready", text: t("settings.aidokuSettings.loggedOut") })
  }

  async function confirmReset() {
    const ok = await Dialog.confirm({
      title: t("settings.aidokuSettings.resetTitle", { name: source?.stored.name ?? sourceKey }),
      message: t("settings.aidokuSettings.resetMessage"),
      confirmLabel: t("settings.aidokuSettings.reset"),
    })
    if (!ok) return
    resetAidokuSettings(sourceKey)
    refresh()
    setStatus({ kind: "ready", text: t("settings.aidokuSettings.resetDone") })
  }

  return (
    <PageScroll title={t("settings.aidokuSettings.title")}>
      {status ? <NoticeBanner tone={statusTone(status.kind)} text={status.text} /> : null}

      {spec && spec.languages.length > 1 ? (
        <CardGroup title={t("settings.aidokuSettings.languageGroup")}>
          <NavigationLink destination={<AidokuLanguageScreen sourceKey={sourceKey} />}>
            <IconRow
              icon="globe"
              title={t("settings.aidokuSettings.language")}
              detail={languageDetail(spec, overrides)}
              chevron
            />
          </NavigationLink>
        </CardGroup>
      ) : null}

      {!hasContent || !spec ? (
        <EmptyState icon="slider.horizontal.3" title={t("settings.aidokuSettings.empty")} />
      ) : (
        spec.groups.map((group, index) => (
          <GroupCard
            key={`${index}:${group.title}`}
            group={group}
            overrides={overrides}
            onApply={apply}
            onLogin={login}
            onWebLogin={item => void webLogin(item)}
            onOAuth={item => void oauthLogin(item)}
            onLogout={logout}
          />
        ))
      )}

      {hasContent && spec ? (
        <>
          <Card>
            <ActionRow
              icon="arrow.counterclockwise"
              title={t("settings.aidokuSettings.reset")}
              tone="destructive"
              onTap={() => void confirmReset()}
            />
          </Card>
          {spec.count > 0 ? (
            <Text font="caption2" foregroundStyle="tertiaryLabel" padding={{ leading: 6, top: 2 }}>
              {t("settings.aidokuSettings.footer", { n: spec.count })}
            </Text>
          ) : null}
        </>
      ) : null}
    </PageScroll>
  )
}

interface LoginActions {
  onLogin: (settingKey: string, username: string, password: string) => void
  onWebLogin: (item: AidokuSettingItem) => void
  onOAuth: (item: AidokuSettingItem) => void
  onLogout: (settingKey: string, method?: string) => void
}

interface GroupActions extends LoginActions {
  onApply: (id: string, value: unknown) => void
}

interface RowActions extends LoginActions {
  onApply: (value: unknown) => void
}

/** 一組＝一張卡片（標題＋註腳）；`page` 來的組也走這裡。 */
function GroupCard({
  group,
  overrides,
  onApply,
  onLogin,
  onWebLogin,
  onOAuth,
  onLogout,
}: {
  group: AidokuSettingGroup
  overrides: Record<string, unknown>
} & GroupActions) {
  return (
    <CardGroup title={group.title || undefined} footnote={group.footer}>
      {group.items.map((item, index) => (
        <VStack key={`${index}:${item.key}:${item.type}`} spacing={0}>
          {index > 0 ? <Divider padding={{ leading: rowSeparatorInset }} /> : null}
          <ItemRows
            item={item}
            value={item.key && item.key in overrides ? overrides[item.key] : item.default}
            overrides={overrides}
            onApply={value => onApply(item.key, value)}
            onLogin={onLogin}
            onWebLogin={onWebLogin}
            onOAuth={onOAuth}
            onLogout={onLogout}
          />
        </VStack>
      ))}
    </CardGroup>
  )
}

function ItemRows({
  item,
  value,
  overrides,
  onApply,
  onLogin,
  onWebLogin,
  onOAuth,
  onLogout,
}: {
  item: AidokuSettingItem
  value: unknown
  overrides: Record<string, unknown>
} & RowActions) {
  if (item.control === "unsupported") {
    return (
      <IconRow
        icon={CONTROL_ICON.unsupported}
        title={item.title}
        detail={unsupportedLabel(item)}
        detailColor="tertiaryLabel"
      />
    )
  }

  if (item.control === "login") {
    const keys = loginKeys(item.key)
    // oauth 存的是 token 原文（或 callback URL），不是 `logged_in`。
    const loggedIn =
      item.method === "oauth"
        ? typeof overrides[item.key] === "string" && String(overrides[item.key]).length > 0
        : overrides[keys.state] === "logged_in"

    if (item.method === "oauth") {
      return (
        <WebLoginItem
          item={item}
          loggedIn={loggedIn}
          onLogin={() => onOAuth(item)}
          onLogout={() => onLogout(item.key, item.method)}
        />
      )
    }

    if (item.method === "webview") {
      if (!item.url) {
        return (
          <IconRow
            icon={CONTROL_ICON.unsupported}
            title={item.title}
            detail={t("settings.aidokuSettings.unsupportedLogin")}
            detailColor="tertiaryLabel"
          />
        )
      }
      return (
        <WebLoginItem
          item={item}
          loggedIn={loggedIn}
          onLogin={() => onWebLogin(item)}
          onLogout={() => onLogout(item.key, item.method)}
        />
      )
    }

    return (
      <LoginItem
        item={item}
        username={typeof overrides[keys.name] === "string" ? String(overrides[keys.name]) : ""}
        loggedIn={loggedIn}
        onLogin={(username, password) => onLogin(item.key, username, password)}
        onLogout={() => onLogout(item.key)}
      />
    )
  }

  if (item.control === "switch") {
    return (
      <ToggleRow
        icon={CONTROL_ICON.switch}
        title={item.title}
        subtitle={item.subtitle}
        value={value === true}
        onChanged={next => onApply(next)}
      />
    )
  }

  if (item.control === "select") {
    return (
      <SelectRow
        icon={CONTROL_ICON.select}
        title={item.title}
        value={value == null ? "" : String(value)}
        options={item.options}
        onChanged={next => onApply(next)}
      />
    )
  }

  if (item.control === "multi") {
    return <MultiSelect item={item} selected={valuesOf(value)} onApply={onApply} />
  }

  if (item.control === "text") {
    return <TextItem item={item} value={value == null ? "" : String(value)} onApply={onApply} />
  }

  return <NumberItem item={item} value={typeof value === "number" ? value : undefined} onApply={onApply} />
}

/** 「尚未支援」右側那句話：分得出是登入、清單還是動作。 */
function unsupportedLabel(item: AidokuSettingItem): string {
  if (item.unsupported === "login") return t("settings.aidokuSettings.unsupportedLogin")
  if (item.unsupported === "list") return t("settings.aidokuSettings.unsupportedList")
  if (item.unsupported === "action") return t("settings.aidokuSettings.unsupportedAction")
  return t("settings.aidokuSettings.unsupported")
}

/**
 * `method: "webview"` 的登入：沒有帳號可顯示，只有「未登入 → 開瀏覽器」與「已登入 → 登出」。
 */
function WebLoginItem({
  item,
  loggedIn,
  onLogin,
  onLogout,
}: {
  item: AidokuSettingItem
  loggedIn: boolean
  onLogin: () => void
  onLogout: () => void
}) {
  if (loggedIn) {
    return (
      <VStack spacing={0}>
        <IconRow icon={CONTROL_ICON.login} title={item.title} detail={t("settings.shared.loggedIn")} />
        <Divider padding={{ leading: rowSeparatorInset }} />
        <ActionRow
          icon="rectangle.portrait.and.arrow.right"
          title={item.logoutTitle ?? t("settings.shared.logout")}
          tone="destructive"
          onTap={onLogout}
        />
      </VStack>
    )
  }

  return (
    <VStack spacing={0}>
      <IconRow
        icon={CONTROL_ICON.login}
        title={item.title}
        detail={t("settings.shared.notLoggedIn")}
        detailColor="tertiaryLabel"
      />
      <Divider padding={{ leading: rowSeparatorInset }} />
      <ActionRow
        icon="safari"
        title={t("settings.aidokuSettings.webLogin")}
        detail={hostOf(item.url ?? "")}
        onTap={onLogin}
      />
    </VStack>
  )
}

/**
 * `method: "basic"` 的登入：兩欄帳密＋登入；登入後只顯示帳號與登出。
 * 帳密不寫進 log，也不顯示在畫面上（登入後連輸入框都不留）。
 */
function LoginItem({
  item,
  username,
  loggedIn,
  onLogin,
  onLogout,
}: {
  item: AidokuSettingItem
  username: string
  loggedIn: boolean
  onLogin: (username: string, password: string) => void
  onLogout: () => void
}) {
  const [account, setAccount] = useState("")
  const [password, setPassword] = useState("")

  if (loggedIn) {
    return (
      <VStack spacing={0}>
        <InfoRow label={t("settings.shared.account")} value={username} />
        <Divider padding={{ leading: rowSeparatorInset }} />
        <ActionRow
          icon="rectangle.portrait.and.arrow.right"
          title={item.logoutTitle ?? t("settings.shared.logout")}
          tone="destructive"
          onTap={onLogout}
        />
      </VStack>
    )
  }

  const ready = account.trim().length > 0 && password.length > 0

  return (
    <VStack spacing={0}>
      <IconRow
        icon={CONTROL_ICON.login}
        title={item.title}
        detail={t("settings.shared.notLoggedIn")}
        detailColor="tertiaryLabel"
      />
      <Divider padding={{ leading: rowSeparatorInset }} />
      <TextInputRow
        label={t("settings.shared.account")}
        prompt={t("settings.shared.account")}
        value={account}
        keyboardType={item.useEmail ? "emailAddress" : "default"}
        onChanged={setAccount}
      />
      <Divider padding={{ leading: rowSeparatorInset }} />
      <TextInputRow
        label={t("settings.shared.password")}
        prompt={t("settings.shared.password")}
        value={password}
        secure
        onChanged={setPassword}
      />
      <Divider padding={{ leading: rowSeparatorInset }} />
      <ActionRow
        icon="person.badge.key"
        title={t("settings.shared.login")}
        disabled={!ready}
        onTap={() => {
          if (ready) onLogin(account.trim(), password)
        }}
      />
    </VStack>
  )
}

/** 多選：標題一列，選項各一列（`multi-single-select` 不准把最後一個取消）。 */
function MultiSelect({
  item,
  selected,
  onApply,
}: {
  item: AidokuSettingItem
  selected: string[]
  onApply: (value: unknown) => void
}) {
  function toggle(value: string) {
    const has = selected.includes(value)
    if (has && item.type === "multi-single-select" && selected.length <= 1) return
    const next = has ? selected.filter(entry => entry !== value) : [...selected, value]
    // 順序照 schema，不照點擊順序：源比對陣列時比較穩。
    onApply(item.options.filter(option => next.includes(option.value)).map(option => option.value))
  }

  return (
    <VStack spacing={0}>
      <IconRow
        icon={CONTROL_ICON.multi}
        title={item.title}
        detail={t("settings.aidokuSettings.selected", { n: selected.length })}
      />
      {item.options.map((option, index) => (
        <VStack key={option.value} spacing={0}>
          {index === 0 ? <Divider padding={{ leading: rowSeparatorInset }} /> : null}
          <OptionRow title={option.text} checked={selected.includes(option.value)} onTap={() => toggle(option.value)} />
        </VStack>
      ))}
    </VStack>
  )
}

/** 文字：邊打邊存會每次重載源，所以在失焦（或鍵盤關掉）時才寫。 */
function TextItem({
  item,
  value,
  onApply,
}: {
  item: AidokuSettingItem
  value: string
  onApply: (value: unknown) => void
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  return (
    <TextInputRow
      icon={CONTROL_ICON.text}
      label={item.title}
      prompt={item.placeholder}
      secure={item.secure}
      value={draft}
      onChanged={setDraft}
      onBlur={() => {
        if (draft !== value) onApply(draft)
      }}
    />
  )
}

/** 滑桿與步進器：`min`／`max`／`step` 由源給，沒給就用 0–1（滑桿）或 0–10（步進器）。 */
function NumberItem({
  item,
  value,
  onApply,
}: {
  item: AidokuSettingItem
  value?: number
  onApply: (value: unknown) => void
}) {
  const min = item.min ?? 0
  const max = item.max ?? (item.control === "stepper" ? 10 : 1)
  const step = item.step && item.step > 0 ? item.step : 1
  const current = value ?? min
  const clamp = (next: number) => Math.min(max, Math.max(min, next))

  if (item.control === "slider") {
    return (
      <VStack spacing={8} padding={rowPadding} alignment="leading" frame={{ maxWidth: "infinity" }}>
        <HStack spacing={14} alignment="center" frame={{ maxWidth: "infinity" }}>
          <IconBadge icon={CONTROL_ICON.slider} />
          <Text font="body" fontWeight="regular" foregroundStyle="label">
            {item.title}
          </Text>
          <Spacer />
          <Text font="subheadline" foregroundStyle="secondaryLabel">
            {String(current)}
          </Text>
        </HStack>
        <Slider min={min} max={max} step={step} value={current} onChanged={next => onApply(clamp(next))} />
      </VStack>
    )
  }

  return (
    <HStack spacing={14} padding={rowPadding} alignment="center" frame={{ maxWidth: "infinity" }}>
      <IconBadge icon={CONTROL_ICON.stepper} />
      <Text font="body" fontWeight="regular" foregroundStyle="label">
        {item.title}
      </Text>
      <Spacer />
      <Stepper onIncrement={() => onApply(clamp(current + step))} onDecrement={() => onApply(clamp(current - step))}>
        <Text font="subheadline" foregroundStyle="secondaryLabel">
          {String(current)}
        </Text>
      </Stepper>
    </HStack>
  )
}
