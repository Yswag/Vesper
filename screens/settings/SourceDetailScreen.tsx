// 單一源的詳情：基本資料、能力徽章、啟用/停用、移除。

import { Button, Divider, Navigation, NavigationLink, VStack, useEffect, useState } from "scripting"

import { Card, CardGroup, PageScroll } from "../../design/layout"
import { IconRow, InfoRow, ToggleRow, rowSeparatorInset } from "../../design/rows"
import { EmptyState, NoticeBanner } from "../../design/status"
import { badgeOff, palette } from "../../design/tokens"
import { t } from "../../i18n"
import {
  accountSpec,
  findSource,
  reloadRegistry,
  setSourceEnabled,
  uninstallSource,
  type InstalledSource,
} from "../../sources/registry"
import { getRepository, repositoryNameFor } from "../../sources/repository"
import { SourceAccountScreen } from "./SourceAccountScreen"
import { SourceSettingsScreen } from "./SourceSettingsScreen"

export function SourceDetailScreen({ sourceKey }: { sourceKey: string }) {
  const dismiss = Navigation.useDismiss()
  const [source, setSource] = useState<InstalledSource | undefined>(undefined)

  useEffect(() => {
    reloadRegistry()
    setSource(findSource(sourceKey))
  }, [sourceKey])

  if (!source) {
    return (
      <PageScroll title={t("settings.sourceDetail.title")}>
        <EmptyState
          icon="questionmark.circle"
          title={t("settings.sourceDetail.notFound")}
          detail={t("settings.sourceDetail.notFoundDetail")}
        />
      </PageScroll>
    )
  }

  const meta = source.meta
  const originUrl = source.stored.origin
  const originRepoName = originUrl ? (getRepository(originUrl)?.name ?? repositoryNameFor(originUrl)) : null

  return (
    <PageScroll title={meta?.name ?? source.stored.name}>
      {source.error ? (
        <NoticeBanner tone="error" text={t("settings.shared.loadFailed")} detail={source.error} />
      ) : null}

      {/* 1. 控制與操作 */}
      <CardGroup title={t("settings.sourceDetail.controls")}>
        <ToggleRow
          icon="power"
          title={t("settings.sourceDetail.enable")}
          value={source.enabled}
          onChanged={enabled => {
            setSourceEnabled(sourceKey, enabled)
            setSource(findSource(sourceKey))
          }}
        />

        {source.settingsSpecs && source.settingsSpecs.length > 0 ? (
          <>
            <Divider padding={{ leading: rowSeparatorInset }} />
            <NavigationLink destination={<SourceSettingsScreen sourceKey={sourceKey} />}>
              <IconRow
                icon="slider.horizontal.3"
                title={t("settings.sourceDetail.settingsRow")}
                detail={t("settings.shared.countItems", { n: source.settingsSpecs.length })}
                chevron
              />
            </NavigationLink>
          </>
        ) : null}

        {accountSpec(source) ? (
          <>
            <Divider padding={{ leading: rowSeparatorInset }} />
            <NavigationLink destination={<SourceAccountScreen sourceKey={sourceKey} />}>
              <IconRow
                icon="person.crop.circle"
                title={t("settings.sourceDetail.accountRow")}
                detail={
                  source.stored.loggedIn
                    ? (source.stored.accountName ?? t("settings.shared.loggedIn"))
                    : t("settings.shared.notLoggedIn")
                }
                chevron
              />
            </NavigationLink>
          </>
        ) : null}
      </CardGroup>

      {/* 2. 基本資料 */}
      <CardGroup title={t("settings.sourceDetail.profile")}>
        <InfoRow label={t("settings.sourceDetail.name")} value={meta?.name ?? source.stored.name} />
        <Divider padding={{ leading: 16 }} />
        <InfoRow label={t("settings.sourceDetail.key")} value={source.stored.key} />
        <Divider padding={{ leading: 16 }} />
        <InfoRow label={t("settings.sourceDetail.version")} value={meta?.version ?? source.stored.version} />
        <Divider padding={{ leading: 16 }} />
        <InfoRow label={t("settings.sourceDetail.minAppVersion")} value={meta?.minAppVersion ?? "—"} />
        <Divider padding={{ leading: 16 }} />
        <InfoRow label={t("settings.sourceDetail.updateUrl")} value={meta?.url ?? "—"} />
        <Divider padding={{ leading: 16 }} />
        <InfoRow
          label={t("settings.sourceDetail.origin")}
          value={originRepoName ?? t("settings.sourceDetail.manualInstall")}
        />
      </CardGroup>

      {/* 3. 危險操作 */}
      <Card>
        <IconRow
          icon="trash"
          iconColor="systemRed"
          title={t("settings.sourceDetail.remove")}
          titleColor="systemRed"
          onTap={() => {
            void Dialog.confirm({
              title: t("settings.sourceDetail.removeTitle", { name: meta?.name ?? sourceKey }),
              message: t("settings.sourceDetail.removeMessage"),
              confirmLabel: t("common.remove"),
            }).then((ok: boolean) => {
              if (ok) {
                uninstallSource(sourceKey)
                dismiss()
              }
            })
          }}
        />
      </Card>
    </PageScroll>
  )
}
