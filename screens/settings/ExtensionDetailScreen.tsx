import {
  Button,
  Divider,
  HStack,
  Image,
  Navigation,
  ProgressView,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  ZStack,
  useEffect,
  useState,
} from "scripting"

import { compareContentLanguage, contentLanguageName, getContentLanguages, isContentLanguage, subscribeContentLanguages } from "../../app/contentLanguages"
import { availableSourceUpdates, checkSourceUpdates, subscribeSourceUpdates, updateSource } from "../../app/sourceUpdates"
import { useTint } from "../../app/theme"
import { useSubscription } from "../../app/useSubscription"
import { Card, CardGroup, PageScroll } from "../../design/layout"
import { InfoRow, rowSeparatorInset, toggleTint } from "../../design/rows"
import { EmptyState, NoticeBanner } from "../../design/status"
import { SkeletonCardGroups } from "../../design/skeleton"
import { palette, rowPadding } from "../../design/tokens"
import { subscribe as subscribeLocale, t } from "../../i18n"
import { packageIdOf } from "../../sources/mihon"
import {
  allSources,
  reloadRegistry,
  setSourceEnabled,
  subscribeSources,
  uninstallSource,
} from "../../sources/registry"
import { getRepository, repositoryNameFor } from "../../sources/repository"
import { sourceGroups, type SourceGroup } from "../../sources/groups"

function groupOf(packageKey: string): SourceGroup | undefined {
  return sourceGroups(allSources()).find(group => group.id === packageKey)
}

export function ExtensionDetailScreen({ packageKey }: { packageKey: string }) {
  useSubscription(subscribeLocale, subscribeContentLanguages, subscribeSources, subscribeSourceUpdates)
  const dismiss = Navigation.useDismiss()
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<"check" | "update" | "remove" | null>(null)
  const [message, setMessage] = useState<{ kind: "ready" | "error"; text: string } | null>(null)

  useEffect(() => {
    reloadRegistry()
    setLoaded(true)
  }, [packageKey])

  const group = groupOf(packageKey)

  if (!loaded) {
    return (
      <PageScroll title={t("settings.extensionDetail.title")}>
        <SkeletonCardGroups />
      </PageScroll>
    )
  }

  if (!group) {
    return (
      <PageScroll title={t("settings.extensionDetail.title")}>
        <EmptyState
          variant="page"
          icon="questionmark.circle"
          title={t("settings.extensionDetail.notFound")}
          detail={t("settings.extensionDetail.notFoundDetail")}
        />
      </PageScroll>
    )
  }

  const current = group
  const update = availableSourceUpdates().find(item => packageIdOf(item.source.stored.key) === packageIdOf(packageKey))
  const entry = group.origin ? getRepository(group.origin)?.entries.find(item => item.key === packageKey) : undefined
  const originName = group.origin
    ? (getRepository(group.origin)?.name ?? repositoryNameFor(group.origin))
    : t("settings.extensionDetail.manualInstall")

  async function check() {
    if (busy !== null) return
    setBusy("check")
    try {
      await checkSourceUpdates({ force: true })
      setMessage({ kind: "ready", text: t("settings.extensionDetail.upToDate") })
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
    }
  }

  async function runUpdate() {
    if (busy !== null) return
    const target = availableSourceUpdates().find(item => packageIdOf(item.source.stored.key) === packageIdOf(packageKey))
    if (!target) return
    setBusy("update")
    try {
      await updateSource(target)
      setMessage({ kind: "ready", text: t("settings.extensionDetail.upToDate") })
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (busy !== null) return
    const ok = await Dialog.confirm({
      title: t("settings.extensionDetail.removeTitle", { name: current.name }),
      message: t("settings.extensionDetail.removeMessage", { n: current.total }),
      confirmLabel: t("common.remove"),
      cancelLabel: t("common.cancel"),
    })
    if (!ok) return
    setBusy("remove")
    uninstallSource(packageKey)
    dismiss()
  }

  return (
    <ExtensionDetailView
      group={group}
      extensionLib={entry?.extensionLib}
      originName={originName}
      updateVersion={update?.to}
      busy={busy}
      message={message}
      onCheck={() => void check()}
      onUpdate={() => void runUpdate()}
      onRemove={() => void remove()}
      onToggle={(key, enabled) => setSourceEnabled(key, enabled)}
    />
  )
}

export function ExtensionDetailView({
  group,
  extensionLib,
  originName,
  updateVersion,
  busy,
  message,
  onCheck,
  onUpdate,
  onRemove,
  onToggle,
}: {
  group: SourceGroup
  extensionLib?: string
  originName: string
  updateVersion?: string
  busy: "check" | "update" | "remove" | null
  message: { kind: "ready" | "error"; text: string } | null
  onCheck: () => void
  onUpdate: () => void
  onRemove: () => void
  onToggle: (sourceKey: string, enabled: boolean) => void
}) {
  useSubscription(subscribeLocale, subscribeContentLanguages)
  const tint = useTint()
  const [query, setQuery] = useState("")
  const [copied, setCopied] = useState(false)
  const packageId = packageIdOf(group.id)
  const single = group.sources.length === 1

  const selected = getContentLanguages()
  const children = [...group.sources].sort((a, b) =>
    compareContentLanguage(a.language ?? "", b.language ?? "", selected)
  )
  const needle = query.trim().toLowerCase()
  const visible = children.filter(child => {
    if (needle.length === 0) return true
    const language = contentLanguageName(child.language ?? "")
    return language.toLowerCase().includes(needle) || (child.language ?? "").toLowerCase().includes(needle)
  })

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      toast={{
        message: t("common.copied"),
        isPresented: copied,
        onChanged: presented => setCopied(presented),
        duration: 1.5,
        position: "bottom",
      }}
    >
      <PageScroll title={group.name}>
        {group.error ? (
          <NoticeBanner tone="error" text={t("settings.shared.loadFailed")} detail={group.error} />
        ) : null}

        <CardGroup title={t("settings.extensionDetail.profile")}>
          <InfoRow label={t("settings.extensionDetail.version")} value={`v${group.version}`} />
          <Divider padding={{ leading: 16 }} />
          <InfoRow label={t("settings.extensionDetail.extensionLib")} value={extensionLib || "—"} />
          <Divider padding={{ leading: 16 }} />
          <InfoRow label={t("settings.extensionDetail.origin")} value={originName} />
          <Divider padding={{ leading: 16 }} />
          <VStack
            spacing={0}
            contextMenu={{
              menuItems: (
                <Button
                  title={t("common.copy")}
                  action={() => {
                    void Pasteboard.setString(packageId)
                    setCopied(true)
                  }}
                />
              ),
            }}
          >
            <InfoRow label={t("settings.extensionDetail.packageName")} value={packageId} />
          </VStack>
        </CardGroup>

        <CardGroup title={t("settings.extensionDetail.actions")}>
          <HStack spacing={10} padding={rowPadding} alignment="center" frame={{ maxWidth: "infinity" }}>
            {updateVersion ? (
              <Button
                title={
                  busy === "update"
                    ? t("settings.extensionDetail.updating")
                    : t("settings.extensionDetail.updateTo", { version: updateVersion })
                }
                buttonStyle="bordered"
                controlSize="regular"
                tint={tint.tint}
                disabled={busy !== null}
                action={onUpdate}
              />
            ) : (
              <Button
                title={busy === "check" ? t("settings.extensionDetail.updating") : t("settings.extensionDetail.checkUpdates")}
                buttonStyle="bordered"
                controlSize="regular"
                tint={tint.tint}
                disabled={busy !== null}
                action={onCheck}
              />
            )}
            {busy === "check" || busy === "update" ? <ProgressView controlSize="small" /> : null}
            <Spacer />
            <Button
              title={t("common.remove")}
              buttonStyle="bordered"
              controlSize="regular"
              tint={palette.red}
              disabled={busy !== null}
              action={onRemove}
            />
          </HStack>
          {single ? (
            <>
              <Divider padding={{ leading: rowSeparatorInset }} />
              <HStack spacing={14} padding={rowPadding} alignment="center" frame={{ maxWidth: "infinity" }}>
                <Image systemName="power" foregroundStyle="secondaryLabel" />
                <VStack spacing={2} alignment="leading">
                  <Text font="body" fontWeight="medium" foregroundStyle="label">
                    {t("settings.extensionDetail.enable")}
                  </Text>
                  {!isContentLanguage(group.sources[0].language) ? (
                    <Text font="caption2" foregroundStyle="tertiaryLabel">
                      {t("settings.extensionDetail.outsideLanguages")}
                    </Text>
                  ) : null}
                </VStack>
                <Spacer />
                <Toggle
                  title=""
                  value={!group.sources[0].manualDisabled}
                  tint={toggleTint(tint)}
                  onChanged={enabled => onToggle(group.sources[0].stored.key, enabled)}
                />
              </HStack>
            </>
          ) : null}
        </CardGroup>

        {single ? null : (
          <>
            {group.total > 10 ? (
              <Card>
                <HStack spacing={10} padding={rowPadding} alignment="center">
                  <Image systemName="magnifyingglass" font="footnote" foregroundStyle="tertiaryLabel" />
                  <TextField
                    title=""
                    prompt={t("settings.extensionDetail.languageSearch")}
                    value={query}
                    textFieldStyle="plain"
                    onChanged={setQuery}
                  />
                </HStack>
              </Card>
            ) : null}
            <CardGroup title={t("settings.extensionDetail.languagesGroup", { on: group.enabledCount, total: group.total })}>
              {visible.length === 0 ? (
                <EmptyState variant="card" icon="magnifyingglass" title={t("settings.repo.noResults")} />
              ) : (
                visible.map((child, index) => (
                  <VStack key={child.stored.key} spacing={0}>
                    {index > 0 ? <Divider padding={{ leading: rowSeparatorInset }} /> : null}
                    <ChildRow
                      language={child.language ?? ""}
                      name={child.stored.name}
                      extensionName={group.name}
                      enabled={!child.manualDisabled}
                      onChanged={enabled => onToggle(child.stored.key, enabled)}
                    />
                  </VStack>
                ))
              )}
            </CardGroup>
          </>
        )}

        {message ? (
          <NoticeBanner tone={message.kind === "error" ? "error" : "success"} text={message.text} />
        ) : null}
      </PageScroll>
    </ZStack>
  )
}

function ChildRow({
  language,
  name,
  extensionName,
  enabled,
  onChanged,
  onOpenSettings,
}: {
  language: string
  name: string
  extensionName: string
  enabled: boolean
  onChanged: (enabled: boolean) => void
  onOpenSettings?: () => void
}) {
  const tint = useTint()
  const rawName = language && name.endsWith(` (${language})`) ? name.slice(0, -(language.length + 3)) : name
  const detail = [
    rawName !== extensionName ? rawName : "",
    isContentLanguage(language) ? "" : t("settings.extensionDetail.outsideLanguages"),
  ]
    .filter(Boolean)
    .join(" · ")
  return (
    <HStack spacing={14} padding={rowPadding} alignment="center" frame={{ maxWidth: "infinity" }}>
      <VStack
        spacing={2}
        alignment="leading"
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        contentShape={onOpenSettings ? "rect" : undefined}
        onTapGesture={onOpenSettings}
      >
        <Text font="body" fontWeight="medium" foregroundStyle="label" lineLimit={1}>
          {contentLanguageName(language)}
        </Text>
        {detail ? (
          <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
            {detail}
          </Text>
        ) : null}
      </VStack>
      <Toggle title="" value={enabled} tint={toggleTint(tint)} onChanged={onChanged} />
    </HStack>
  )
}
