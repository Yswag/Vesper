// Scripting 首頁入口（Home Screen Tab UI）：Vesper 的 Mini Hub。
// 長駐於 Scripting 首頁分頁，不可調用 Navigation.present 與 Script.exit()。
//
// 全螢幕 App 不再塞進來：這裡只有三件事，資料全在本機（不抓 Bangumi）——
//   續讀 Hero → 最新追更 → 導覽列的「開啟完整 App」。
// 追更檢查是靜默的：首次掛載延遲 2.5 秒、每次切回首頁各觸發一次；TTL 由排程器把關
// （12 小時內零連線，見 app/updates.ts），所以這裡放心呼叫。

import {
  Button,
  Divider,
  Device,
  HStack,
  Image,
  NavigationLink,
  NavigationStack,
  ProgressView,
  Script,
  Text,
  VStack,
  ZStack,
  useEffect,
  useState,
} from "scripting"

import { areDependenciesInstalled } from "./app/dependencies"
import { createComicLibrary } from "./app/comic"
import { onBeforeExit } from "./app/lifecycle"
import { installLocaleSetting } from "./app/localeSetting"
import { comicLibrary, installComicLibrary } from "./app/services"
import { resumeEntry, unreadCountOf, type ResumeEntry } from "./app/shelf"
import { PageBackground, useTint } from "./app/theme"
import { updatesScheduler } from "./app/updates"
import { useSubscription } from "./app/useSubscription"
import { CoverImage } from "./components/CoverImage"
import { composeImage } from "./components/ModifyImageRenderer"
import { UnreadBadge } from "./design/CoverBadge"
import { Card, GroupHeader, PageScroll } from "./design/layout"
import { Chevron } from "./design/rows"
import { EmptyState } from "./design/status"
import { capsule, cardGap, rowPadding } from "./design/tokens"
import { ensureFileAccess, fileAccess } from "./engine/fs"
import { comicGroupKey } from "./engine/offline"
import { setImageCompositor } from "./engine/imagecache"
import { subscribe as subscribeLocale, t } from "./i18n"
import {
  allComicUpdates,
  flushLibrary,
  listFavorites,
  listProgress,
  reloadLibraryFromDisk,
  subscribeLibrary,
  type ComicUpdateRecord,
  type Favorite,
} from "./library/bookshelf"
import { ComicDetailScreen } from "./screens/shared/ComicDetailScreen"
import { launchResumeReader } from "./screens/shared/ResumeReaderScreen"
import { reloadRegistry } from "./sources/registry"

/** 首次進首頁先讓畫面呼吸一下，再背景查追更。 */
const STARTUP_UPDATE_DELAY = 2500
/** 追更看板最多幾部（再多就不叫看板了）。 */
const UPDATE_LIMIT = 5

const HERO_COVER = { width: 84, height: 120 }
const ROW_COVER = { width: 40, height: 56 }
/** 封面與文字之間。 */
const COVER_GAP = 12

let isInitialized = false

function initVesperForHomeScreen() {
  if (isInitialized) return
  isInitialized = true

  // 語言要在 render 期同步注入（讀 KV 是同步的，不需要授權也不用 await）：
  // 這個入口不能 await，第一輪 render 就該是對的語言。
  installLocaleSetting(Device.systemLocales)

  // 註冊退出/銷毀時落盤
  onBeforeExit(() => flushLibrary())

  // 圖片離屏合成器
  setImageCompositor(composeImage)

  // 畫面都透過 ComicLibrary 取資料，這個入口也是 composition root。
  installComicLibrary(createComicLibrary())
}

/**
 * 檔案授權確認後加載本機資料（若尚未授權則退守 KV 備援）。
 */
async function loadVesperData() {
  const granted = await ensureFileAccess()
  // 沒授權時 source 走 KV 備援，仍然是「現在該載的那份」，所以兩種情況都要 reload。
  reloadRegistry()
  if (granted) {
    reloadLibraryFromDisk()
  }
}

/**
 * 背景靜默查一輪。沒有依賴就不查：源的解析會全部失敗，換來的是每部一小時退避。
 * 排程器自己守 TTL、去重與讓路，這裡不需要再判斷。
 */
function checkUpdatesQuietly() {
  if (!areDependenciesInstalled()) return
  void updatesScheduler().checkUpdates({ background: true })
}

/** 完整 App 走 run URL scheme：首頁分頁不能 present，那會再疊一層殼在分頁裡。
 *  這版 API 沒有 `Script.openUrl`，用 `createRunURLScheme` 組出同一個網址交給系統。 */
function openFullApp() {
  void Safari.openURL(Script.createRunURLScheme("Vesper"))
}

export default function HomeScreenDefaultUI() {
  // 於 render 階段建立服務實例（子畫面在 render 期間即依賴 ComicLibrary）
  initVesperForHomeScreen()

  const [dataReady, setDataReady] = useState(() => fileAccess() !== null)
  const tint = useTint()

  // 收藏、已讀、追更快取、離線層與語言一變就重繪：背景檢查寫回 library.json 時看板自己跟上。
  const refresh = useSubscription(subscribeLibrary, comicLibrary().onChange, subscribeLocale)

  useEffect(() => {
    // 授權結算後才載得到源與書架。在載入完成前不渲染看板，
    // 避免續讀卡在源尚未進入記憶體時就判斷成「源失效」。
    void loadVesperData().finally(() => {
      setDataReady(true)
    })

    const timer = setTimeout(checkUpdatesQuietly, STARTUP_UPDATE_DELAY)

    // 監聽 Scripting 首頁分頁事件
    const unsubscribeTab = Script.onHomeTabEvent(event => {
      switch (event) {
        case "selected":
          // 從其他分頁切換回首頁。完整 App 可能同時在寫 library.json（閱讀進度、追更），
          // 先重讀盤上的那一份：不只看板要是新的，接下來的背景檢查也才不會蓋掉完整 App 的寫入。
          reloadRegistry()
          reloadLibraryFromDisk()
          refresh()
          checkUpdatesQuietly()
          break
        case "deselected":
          // 切換至其他分頁，將資料落盤
          void flushLibrary()
          break
      }
    })

    return () => {
      if (timer !== null) clearTimeout(timer)
      unsubscribeTab()
      void flushLibrary()
    }
  }, [])

  if (!dataReady) {
    return (
      <ZStack tint={tint.tint} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <PageBackground />
        <ProgressView />
      </ZStack>
    )
  }

  const resume = listProgress()[0]
  const favorites = listFavorites()

  return (
    <NavigationStack>
      <ZStack tint={tint.tint} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <PageScroll title="Vesper" trailing={OpenAppButton}>
          {resume ? <ResumeHero entry={resumeEntry(resume)} /> : null}
          <UpdatesSection items={pendingUpdates()} shelfEmpty={favorites.length === 0} />
        </PageScroll>
      </ZStack>
    </NavigationStack>
  )
}

/** 導覽列右上：交給完整的五個分頁 App。 */
function OpenAppButton() {
  const tint = useTint()
  return (
    <Button action={openFullApp} buttonStyle="borderless">
      <HStack spacing={4} alignment="center">
        <Image systemName="arrow.up.forward.app" font="subheadline" foregroundStyle={tint.tint} />
        <Text font="subheadline" fontWeight="medium" foregroundStyle={tint.tint}>
          {t("home.miniHub.openApp")}
        </Text>
      </HStack>
    </Button>
  )
}

/** 續讀 Hero：封面、作品名、上次那一話與進度；卡片推詳情，「繼續閱讀」直接開閱讀器。 */
function ResumeHero({ entry }: { entry: ResumeEntry }) {
  const tint = useTint()
  const [opening, setOpening] = useState(false)
  const fraction = entry.readFraction

  return (
    <VStack spacing={cardGap} alignment="leading" frame={{ maxWidth: "infinity" }}>
      <GroupHeader title={t("home.resumeTitle")} />
      <Card>
        <NavigationLink
          destination={<ComicDetailScreen sourceKey={entry.sourceKey} comicId={entry.comicId} title={entry.title} />}
          buttonStyle="plain"
        >
          <HStack spacing={COVER_GAP} alignment="top" padding={rowPadding}>
            <CoverImage
              sourceKey={entry.sourceKey}
              url={entry.cover}
              width={HERO_COVER.width}
              height={HERO_COVER.height}
              title={entry.title}
              lifted={true}
            />
            <VStack spacing={4} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
              <Text font="headline" lineLimit={2}>
                {entry.title}
              </Text>
              <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={1}>
                {entry.epTitle || t("home.lastRead")}
              </Text>
              {/* 沒有頁數的舊紀錄就讓它佔位（透明），卡片高度不跳。 */}
              <ProgressView
                value={fraction ?? 0}
                progressViewStyle="linear"
                frame={{ maxWidth: "infinity" }}
                opacity={fraction === undefined ? 0 : 1}
              />
              {entry.pageLabel ? (
                <Text font="caption2" foregroundStyle="tertiaryLabel">
                  {entry.pageLabel.total
                    ? t("bookshelf.pageOfTotal", { page: entry.pageLabel.page, total: entry.pageLabel.total })
                    : t("bookshelf.pageOf", { page: entry.pageLabel.page })}
                </Text>
              ) : null}
            </VStack>
            <Chevron />
          </HStack>
        </NavigationLink>

        <VStack padding={{ horizontal: rowPadding.horizontal, bottom: rowPadding.vertical }}>
          {entry.openable ? (
            <Button
              buttonStyle="plain"
              disabled={opening}
              action={() => {
                setOpening(true)
                void launchResumeReader({ sourceKey: entry.sourceKey, comicId: entry.comicId }).finally(() =>
                  setOpening(false)
                )
              }}
            >
              <HStack
                spacing={6}
                alignment="center"
                padding={{ horizontal: 16, vertical: 10 }}
                frame={{ maxWidth: "infinity" }}
                background={tint.tint}
                clipShape={capsule()}
                opacity={opening ? 0.6 : 1}
              >
                <Image systemName="play.fill" font="caption" foregroundStyle={tint.onTint} />
                <Text font="subheadline" fontWeight="semibold" foregroundStyle={tint.onTint}>
                  {t("home.resumeTitle")}
                </Text>
              </HStack>
            </Button>
          ) : (
            <Text font="caption" foregroundStyle="secondaryLabel">
              {t("home.sourceInvalid")}
            </Text>
          )}
        </VStack>
      </Card>
    </VStack>
  )
}

/** 看板的一列：收藏接上追更紀錄與未讀數。 */
interface UpdateItem {
  favorite: Favorite
  record: ComicUpdateRecord
  unreadCount: number
}

/** 有未讀的作品，最新檢查的在前。沒有追更紀錄＝還沒查過，不算更新。 */
function pendingUpdates(): UpdateItem[] {
  const favorites = new Map(listFavorites().map(favorite => [comicGroupKey(favorite), favorite]))
  const items: UpdateItem[] = []
  for (const record of Object.values(allComicUpdates())) {
    const favorite = favorites.get(comicGroupKey(record))
    if (!favorite) continue
    const unreadCount = unreadCountOf(favorite)
    if (unreadCount > 0) items.push({ favorite, record, unreadCount })
  }
  return items.sort((a, b) => b.record.checkedAt - a.record.checkedAt).slice(0, UPDATE_LIMIT)
}

function UpdatesSection({ items, shelfEmpty }: { items: UpdateItem[]; shelfEmpty: boolean }) {
  return (
    <VStack spacing={cardGap} alignment="leading" frame={{ maxWidth: "infinity" }}>
      <GroupHeader title={t("home.miniHub.updatesTitle")} />
      {items.length === 0 ? (
        shelfEmpty ? (
          <EmptyState
            icon="books.vertical"
            title={t("bookshelf.emptyFavoritesTitle")}
            detail={t("bookshelf.emptyFavoritesDetail")}
          />
        ) : (
          <EmptyState icon="checkmark.circle" title={t("home.miniHub.allUpToDate")} />
        )
      ) : (
        <Card>
          {items.map((item, index) => (
            <VStack key={comicGroupKey(item.favorite)} spacing={0}>
              {index > 0 ? <Divider padding={{ leading: rowPadding.horizontal + ROW_COVER.width + COVER_GAP }} /> : null}
              <NavigationLink
                destination={
                  <ComicDetailScreen
                    sourceKey={item.favorite.sourceKey}
                    comicId={item.favorite.comicId}
                    title={item.favorite.title}
                  />
                }
                buttonStyle="plain"
              >
                <UpdateRow item={item} />
              </NavigationLink>
            </VStack>
          ))}
        </Card>
      )}
    </VStack>
  )
}

function UpdateRow({ item }: { item: UpdateItem }) {
  const { favorite, record, unreadCount } = item
  return (
    <HStack spacing={COVER_GAP} alignment="center" padding={rowPadding} frame={{ maxWidth: "infinity" }}>
      <CoverImage
        sourceKey={favorite.sourceKey}
        url={favorite.cover}
        width={ROW_COVER.width}
        height={ROW_COVER.height}
        title={favorite.title}
      />
      <VStack spacing={2} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="subheadline" fontWeight="medium" lineLimit={1}>
          {favorite.title}
        </Text>
        {record.latestEpTitle ? (
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
            {record.latestEpTitle}
          </Text>
        ) : null}
      </VStack>
      <UnreadBadge count={unreadCount} accessibilityLabel={t("bookshelf.unreadBadge", { n: unreadCount })} />
      <Chevron />
    </HStack>
  )
}
