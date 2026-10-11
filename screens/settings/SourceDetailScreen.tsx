// 單一源的詳情：基本資料、能力徽章、啟用/停用、移除。

import { Button, Divider, NavigationLink, VStack, useEffect, useState } from "scripting"

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
import { SourceAccountScreen } from "./SourceAccountScreen"
import { SourceSettingsScreen } from "./SourceSettingsScreen"

export function SourceDetailScreen({ sourceKey }: { sourceKey: string }) {
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
          value={source.stored.origin ?? t("settings.sourceDetail.manualInstall")}
        />
      </CardGroup>

      {/* 3. 支援能力 */}
      <CardGroup
        title={t("settings.sourceDetail.capabilities")}
        footnote={t("settings.sourceDetail.capabilitiesFootnote", {
          value: t("settings.sourceDetail.declaredNotImplemented"),
        })}
      >
        {meta ? <CapabilityRows source={source} /> : null}
      </CardGroup>

      {/* 4. 危險操作 */}
      <Card>
        <Button
          title={t("settings.sourceDetail.remove")}
          role="destructive"
          systemImage="trash"
          action={() => {
            void Dialog.confirm({
              title: t("settings.sourceDetail.removeTitle", { name: meta?.name ?? sourceKey }),
              message: t("settings.sourceDetail.removeMessage"),
              confirmLabel: t("common.remove"),
            }).then((ok: boolean) => {
              if (ok) {
                uninstallSource(sourceKey)
                setSource(findSource(sourceKey))
              }
            })
          }}
        />
      </Card>
    </PageScroll>
  )
}

/** 能力表：`[標籤, 源有宣告, Vesper 有實作, 對應的 API 名稱]`（標籤在 render 時才算）。 */
function CapabilityRows({ source }: { source: InstalledSource }) {
  const capability = source.capabilities
  if (!capability) return null
  const items: Array<[string, boolean, boolean, string]> = [
    [t("settings.sourceDetail.capability.search"), capability.search, true, "search.load"],
    [t("settings.sourceDetail.capability.explore"), capability.explore, true, "explore"],
    [t("settings.sourceDetail.capability.category"), capability.categoryComics, true, "categoryComics"],
    [t("settings.sourceDetail.capability.comic"), capability.comic, true, "comic.loadInfo"],
    [t("settings.sourceDetail.capability.comments"), capability.comments, true, "comic.loadComments"],
    [t("settings.sourceDetail.capability.sendComment"), capability.sendComment, true, "comic.sendComment"],
    [t("settings.sourceDetail.capability.starRating"), capability.starRating, false, "comic.starRating"],
    [t("settings.sourceDetail.capability.archive"), capability.archive, false, "comic.archive"],
    [t("settings.sourceDetail.capability.favorites"), capability.favorites, false, "favorites"],
    [t("settings.sourceDetail.capability.modifyImage"), capability.modifyImage, true, "modifyImage"],
    [t("settings.sourceDetail.capability.loginWithPassword"), capability.loginWithPassword, true, "account.login"],
    [t("settings.sourceDetail.capability.loginWithCookies"), capability.loginWithCookies, true, "account.loginWithCookies"],
    [t("settings.sourceDetail.capability.loginWithWebview"), capability.loginWithWebview, true, "account.loginWithWebview"],
  ]
  return (
    <>
      {items.map(([label, declared, implemented, api], index) => (
        <VStack key={api} spacing={0}>
          {index > 0 ? <Divider padding={{ leading: 16 }} /> : null}
          <InfoRow
            label={label}
            value={
              !declared
                ? t("settings.sourceDetail.notProvided")
                : implemented
                  ? t("settings.sourceDetail.implemented")
                  : t("settings.sourceDetail.declaredNotImplemented")
            }
            valueColor={!declared || implemented ? "secondaryLabel" : "systemOrange"}
          />
        </VStack>
      ))}
    </>
  )
}
