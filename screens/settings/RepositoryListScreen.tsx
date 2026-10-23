// 源倉庫：加入與管理。加入只保存索引（index.json），**不會**自動安裝任何源；
// 要裝哪個源進去倉庫裡逐筆挑（RepositoryDetailScreen）。

import {
  Button,
  Divider,
  HStack,
  Image,
  LazyVStack,
  NavigationLink,
  ProgressView,
  Spacer,
  Text,
  TextField,
  VStack,
  ZStack,
  useEffect,
  useState,
} from "scripting"

import { Card, GroupHeader, PageScroll } from "../../design/layout"
import { Chevron, IconBadge, rowSeparatorInset } from "../../design/rows"
import { EmptyState, NoticeBanner, statusTone, type StatusNotice } from "../../design/status"
import { cardBackground, cardShape, fill, palette, radius, rect, rowPadding } from "../../design/tokens"
import { t } from "../../i18n"
import { addRepository, refreshRepository } from "../../sources/registry"
import { listRepositories, removeRepository, saveRepository, subscribeRepositories, type StoredRepository } from "../../sources/repository"
import { RepositoryDetailScreen } from "./RepositoryDetailScreen"

export function RepositoryListScreen() {
  const [repositories, setRepositories] = useState<StoredRepository[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<StatusNotice | null>(null)
  const [refreshProgress, setRefreshProgress] = useState<{ current: number; total: number } | null>(null)

  useEffect(() => {
    const refresh = () => setRepositories(listRepositories())
    refresh()
    return subscribeRepositories(refresh)
  }, [])

  async function handleRefreshAll() {
    const list = listRepositories()
    if (list.length === 0) return

    let finished = 0
    setRefreshProgress({ current: 0, total: list.length })

    const tasks = list.map(async repo => {
      try {
        await Promise.race([
          refreshRepository(repo.url),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(t("settings.repos.timeout"))), 8000)
          ),
        ])
      } finally {
        finished++
        setRefreshProgress({ current: finished, total: list.length })
      }
    })

    const results = await Promise.allSettled(tasks)
    setRefreshProgress(null)

    const failed = results.filter(r => r.status === "rejected").length
    const success = results.filter(r => r.status === "fulfilled").length
    if (failed > 0) {
      setStatus({
        kind: "ready",
        text: t("settings.repos.refreshPartial", { done: success, failed }),
      })
    } else {
      setStatus({ kind: "ready", text: t("settings.repos.refreshAll", { n: success }) })
    }
  }

  async function run(label: string, task: () => Promise<StoredRepository>) {
    setBusy(true)
    setStatus({ kind: "loading", text: t("common.inProgress", { label }) })
    try {
      const repository = await task()
      setStatus({
        kind: "ready",
        text: t("settings.repos.addDone", {
          label,
          name: repository.name,
          count: repository.entries.length,
        }),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus({ kind: "error", text: t("common.failed", { message }) })
    } finally {
      setBusy(false)
    }
  }

  async function handleRename(repository: StoredRepository) {
    const nextName = await Dialog.prompt({
      title: t("settings.repos.renameTitle"),
      defaultValue: repository.name,
      placeholder: t("settings.repos.renamePlaceholder"),
      confirmLabel: t("common.save"),
      cancelLabel: t("common.cancel"),
    })
    if (nextName === null) return
    const trimmed = nextName.trim()
    if (!trimmed) return
    saveRepository({ ...repository, name: trimmed })
  }

  async function handleDelete(repository: StoredRepository) {
    const ok = await Dialog.confirm({
      title: t("settings.repos.removeTitle"),
      message: t("settings.repos.removeMessage", { name: repository.name }),
      confirmLabel: t("common.remove"),
      cancelLabel: t("common.cancel"),
    })
    if (!ok) return
    removeRepository(repository.url)
  }

  async function handleAddRepository() {
    const targetUrl = await Dialog.prompt({
      title: t("settings.repos.addTitle"),
      placeholder: t("settings.repos.addPlaceholder"),
      confirmLabel: t("common.add"),
      cancelLabel: t("common.cancel"),
    })
    if (!targetUrl || !targetUrl.trim()) return
    void run(t("common.add"), () => addRepository(targetUrl.trim()))
  }

  const TrailingButton = () => (
    <Button
      title=""
      systemImage="plus"
      buttonStyle="plain"
      font="headline"
      action={() => void handleAddRepository()}
    />
  )

  return (
    <PageScroll title={t("settings.shared.repository")} trailing={TrailingButton} onRefresh={handleRefreshAll}>
      <VStack spacing={8} alignment="leading">
        <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
          <GroupHeader title={t("settings.repos.joined", { n: repositories.length })} />
          <Spacer />
          {refreshProgress ? (
            <Text font="caption2" foregroundStyle="secondaryLabel">
              {t("settings.repos.refreshing", { done: refreshProgress.current, total: refreshProgress.total })}
            </Text>
          ) : null}
        </HStack>

        {repositories.length === 0 ? (
          <EmptyState
            icon="shippingbox"
            title={t("settings.repos.empty")}
            detail={t("settings.repos.emptyDetail")}
          />
        ) : (
          <LazyVStack
            spacing={0}
            background={cardBackground}
            clipShape={cardShape}
            frame={{ maxWidth: "infinity" }}
            swipeActionsContainer={true}
          >
            {repositories.map((repository, index) => {
              const hasError = !!repository.error

              return (
                <VStack
                  key={repository.url}
                  spacing={0}
                  trailingSwipeActions={{
                    allowsFullSwipe: false,
                    actions: [
                      <Button
                        key="delete"
                        title={t("common.delete")}
                        systemImage="trash"
                        role="destructive"
                        action={() => void handleDelete(repository)}
                      />,
                      <Button
                        key="rename"
                        title={t("settings.repos.rename")}
                        systemImage="pencil"
                        tint="orange"
                        action={() => void handleRename(repository)}
                      />,
                    ],
                  }}
                >
                  {index > 0 ? <Divider padding={{ leading: 52 }} /> : null}
                  <NavigationLink
                    destination={<RepositoryDetailScreen repositoryUrl={repository.url} />}
                  >
                    <HStack
                      spacing={14}
                      padding={rowPadding}
                      alignment="center"
                      frame={{ maxWidth: "infinity" }}
                    >
                      {/* 純色線條圖示 */}
                      <Image
                        systemName={hasError ? "exclamationmark.triangle" : "shippingbox"}
                        font="title3"
                        foregroundStyle={hasError ? palette.red : "secondaryLabel"}
                      />

                      {/* 倉庫名稱與網址 */}
                      <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                        <Text font="body" fontWeight="medium" foregroundStyle="label" lineLimit={1}>
                          {repository.name}
                        </Text>
                        <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                          {repository.url.replace(/^https?:\/\//, "")}
                        </Text>
                      </VStack>

                      <Spacer />

                      {/* 源數量（低調次級文字） */}
                      <Text
                        font="subheadline"
                        foregroundStyle={hasError ? palette.red : "secondaryLabel"}
                      >
                        {hasError
                          ? t("settings.shared.readFailed")
                          : t("settings.shared.countSources", { n: repository.entries.length })}
                      </Text>

                      {/* 箭頭 */}
                      <Chevron />
                    </HStack>
                  </NavigationLink>
                </VStack>
              )
            })}
          </LazyVStack>
        )}
      </VStack>

      {status ? <NoticeBanner tone={statusTone(status.kind)} text={status.text} /> : null}
    </PageScroll>
  )
}
