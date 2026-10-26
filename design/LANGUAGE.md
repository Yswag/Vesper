# Vesper 設計語言

改任何畫面之前先讀這份。新決定先寫進「決定紀錄」再改碼；這裡沒寫的樣子不要自己發明，先加 token／元件。

## 原則

1. **內容在前，操作浮在上面。** 封面、漫畫頁、書名是內容層，不包玻璃；玻璃只給導覽、工具列、篩選、HUD、短狀態。
2. **光放在內容不在的地方。** 頁面底色的光與色只在邊緣，內容區保持安靜。
3. **一個顏色一個意思。** 強調色＝可互動／選中；語意色＝狀態；其他都是中性。
4. **層次靠表面亮度，不靠光暈。**
5. **視覺決定只住 `design/`。** 頁面不寫色碼、圓角數字、字級數字、陰影字面值。

## 色彩

- **頁面底色**：構圖 × 色盤（`app/theme.tsx`），只有那裡能寫底色 hex；頁面一律 `PageBackground`。
- **強調色**：`useTint()`。`tint` 用於互動與選中；**tint 底（實心或帶色玻璃）上的字與圖示一律 `onTint`**，不准寫 `white`。選中底、選中列、高亮、榜單都從 `Tint` 取。
- 不用 `"accentColor"`／`"tintColor"` 字面值與 `palette.blue`：它們不跟主題。
- 根層 tint 實測會跟的：Toggle、borderless Button、`ProgressView`、tab bar 選中項；不跟的：segmented Picker。預覽沒有 App 的根層，要自己掛 `tint`，不然會拍成系統藍。
- **文字**：`label` → `secondaryLabel` → `tertiaryLabel`。
- **語意色**（`palette` 的 green／orange／red…）只表示狀態，不當裝飾。
- 狀態色當**文字或無底圖示**用 `toneText`（`danger`／`warning`／`success`／`love`，淺色深一階）；`palette.*` 只給色塊底（例如 `IconBadge`）。
- 紅色只給破壞性動作（刪除、清除、移除）與失敗；「取消進行中的事」用中性色。
- 透明色寫 `rgba(...)`，不用 8 位 hex（會變黑）。

## 圓角

四級，同心：內層圓角＝外層圓角－內距。

| token | 值 | 用在 |
|---|---|---|
| `radius.sm` | 6 | 短標籤、圖示徽章、圖片上的角標 |
| `radius.md` | 10 | chip、縮圖、封面 |
| `radius.lg` | 18 | 卡片、懸浮小卡 |
| `radius.xl` | 26 | sheet、HUD 面板、對話框 |

膠囊用 `capsule()`。系統按鈕與系統 sheet 用系統形狀，不套這四級。

## 字級

只用系統文字樣式（吃動態字級），不寫 pt 數。三層：

| 層 | 樣式 | 用在 |
|---|---|---|
| 標題 | `title2`（頁內最大）、`title3`、`headline` | 區塊標題、詳情書名、卡片標題 |
| 內文 | `body`、`subheadline` | 列標題、說明文字、網格書名 |
| 說明 | `footnote`、`caption`、`caption2` | 次要資訊、徽章、角標；`caption2` 只給徽章與圖上角標 |

頁面標題交給系統 navigation title。不用 `largeTitle`／`title`、全大寫、負字距。

## 深度

- 卡片與玻璃面**不用陰影**。層次＝表面亮度：`cardBackgroundSubtle`（空狀態）< `cardBackground`（卡片）< `cardBackgroundStrong`（卡片內再一層）；再加 1px `hairlineStroke` 高光邊（`Card` 內建，頁面不要自己刻）。
- 理由：卡片底半透明，陰影照不透明度投 → 每個字後面各一團影（`compositingGroup` 也救不了）；玻璃的深度由系統材質負責。
- 封面的投影屬於圖片本身（封面不透明，壓在任何底色上都是黑影）：`CoverImage lifted`，key／penumbra／ambient 三層（`design/CoverShadow`），只掛在圖片那層。

## 封面

- 一律 `components/CoverImage`，傳 `title`：沒圖時用標題雜湊挑主題色盤畫漸層＋首字（同標題同色）；載入中是 surface 底＋小轉圈。
- 圖上的短角標一律 `design/CoverBadge`（`tone="danger"` 給「來源已移除」）；頁面不自刻 `ultraThinMaterial` 膠囊。網格裡頁數在左上、時間／狀態在下緣。
- 網格與橫向卡片排的書名靠左、一行（兩行會讓同一排的格子高低不齊）；副標與來源一行。

## 標籤與膠囊

- 頁面上（不在圖上）的資訊標籤一律 `design/Tag`（`neutral`／`danger`／`warning`／`love`）；有色 tone 的底只放在 `tagTone` token。
- 可點的膠囊一律 `design/chip` 的 `Chip`（選中＝`tint.selected` 階梯）；同一行擠多顆用 `compact`，文字 chip 不再加 icon。
- 會開選單的膠囊用 `Chip chevron`。頁內動作不用 `glassProminent`。
- 最低支援 iOS 18：`UIGlass`、`glassEffect`、`GlassEffectContainer`、`safeAreaBar` 等 iOS 26 API 只能經 `design/glass.tsx`（`glass()`、`scrollTopBar()`、`liquidGlass`）使用，頁面不直接寫。
- 頁面頂端的切換 chip 列（分類、排行週期）掛在捲動區的 `safeAreaBar`（edge top），貼在導覽列下；配 `scrollEdgeEffectStyle` soft。不要 `scrollEdgeEffectHidden`（導覽列標題會失去底）。
- 頁面的主捲動區一律展開 `scrollTopBar(...)`；沒有切換列就傳 `null`，內容從導覽列下柔和淡出。`PageScroll` 已內建。
- 圖上角標夾寬用 `CoverBadge maxWidth`，它會抱內容寬；不在角標外自己加 `frame maxWidth`。
- 帶左滑的卡片列，外層也要 `clipShape={cardShape}`：滑動容器會在列的矩形範圍畫一層底，圓角外會露出方角。
- tab 根頁不做左右滑換頁：導覽列下直接一個直向捲動區，柔和淡出與 tab bar 的 `onScrollDown` 縮小才都成立（page `TabView` 裡掛 bar 無效、橫向 paging 讓 tab bar 不縮）。分區改成入口列推新頁，或放導覽列的排序／篩選 `Menu`。

## 浮層

- 對話框卡片 `radius.xl`、內層 `radius.md`、按鈕膠囊；顏色在 `dialog` token 群組；不加陰影，分離靠遮罩。
- 預設按鈕＝`tint` 實心底＋`onTint` 字；取消微透底；破壞性紅字。

## 間距

`pageInsets`、`pageSpacing`、`sectionSpacing`、`cardGap`、`rowPadding` 等都在 `design/tokens.ts`，頁面直接用名字。左右邊距全 App 都是 `pageInsets.horizontal`（16），網格也一樣；網格卡片間距 9、橫向卡片排 12。

載入中的區塊用「骨架」：跟載入後同尺寸的 `fill.surface` 封面塊＋`redacted="placeholder"` 的字，資料來了版面不跳。不要用一行「載入中…」的字佔位。錯誤＝`NoticeBanner tone="error"`＋`Chip` 重試；空＝`EmptyState variant="page"`。

sheet 本身是白底：裡面有 `Card` 就在捲動區鋪 `PageBackground`，否則淺色下卡片看不到邊。

## 閱讀器

畫布純黑，不加任何品牌色；玻璃只出現在 HUD。

## 守門

- `scripting-ts run dev/design-lint.ts`：掃 `screens/`、`components/`、`app/`（不含 `app/theme.tsx`）的違規，跟 `dev/design-lint.baseline.json` 比。**每個檔每條規則只准減不准增**；減少後要更新基準。新增或刪除 `.tsx` 要同步頁面清單（`.scratch/visual-polish/pages.md`），否則 FAIL。規則裡的 `card` 抓的是頁面自刻的 `stroke={hairlineStroke}`（該用 `Card`）。
- 截圖基準：每批結束截 `dev/preview-design.tsx`（amber、ink × 深淺）與該批頁面，跟上一批比。
- 玻璃截圖拍不出來：動到玻璃就 `scripting-ts run dev/show-glass.tsx`（淺／深上下並排），請使用者實機截圖。頁面裡有帶色玻璃時，`--screenshot` 整頁失真，要暫時拿掉 tint 才拍得到其他部分。
- 動到背景層（模糊、漸層、Canvas）一定要實機看：預覽正常不代表實機正常。

## 決定紀錄

- 2026-10-24 強調色跟隨主題（`useTint`），對比 ≥ 4.6；中性主題的 Toggle 用系統綠。
- 2026-10-24 構圖 5 種（純色／上緣光／長漸層／餘暉／角光），預設上緣光；8 色盤 accent 同一 OKLCH 亮度帶。
- 2026-10-24 圓角 10 級收成 4 級（6／10／18／26）。
- 2026-10-24 字級三層，只用系統樣式。
- 2026-10-24 卡片與玻璃拿掉陰影（深色的白光暈、淺色試過的淡黑影都不要）。
- 2026-10-24 頁面裡既有的字面值記入 lint 基準，逐 tab 改頁面時再清。
- 2026-10-24 封面佔位（標題雜湊色盤＋首字）、`CoverBadge`、`lifted` 投影；lint 加 `material`；刪 `GlassBadge`。
- 2026-10-24 對話框預設按鈕用強調色；對話框拿掉陰影。
- 2026-10-24 `Card` 一律帶高光邊（`hairlineStroke`），頁面手刻的卡片全部改用 `Card`；來源已移除改成封面下緣 danger 角標，下面不再重複來源名。
- 2026-10-24 詳情頁：資訊標籤改 `Tag`、章節工具列改 `Chip compact`；頂部氛圍光暈維持原版（Canvas 淡出版實機壞掉，撤回）；網格書名改一行。
- 2026-10-24 首頁：hero 白字改語意色；有色標籤字色淺色用深一階（`tagText`）；橫向卡片書名靠左；網格邊距 12→16；載入改骨架。
- 2026-10-24 瀏覽／搜尋：錯誤／空／載入三種狀態統一；分類與排行 chip 列貼導覽列（safeAreaBar＋soft）；篩選 sheet 鋪頁面底色。
- 2026-10-24 設定：`tagText` 擴成 `toneText`（加 `success`）；下載頁未完成＝中性暫停＋x/y、失敗才紅；刪掉頁面裡可有可無的說明 footnote。
- 2026-10-24 閱讀器：HUD／目錄字級與文字色歸零（面板釘 dark，用 `label` 系）；目錄分組膠囊在玻璃抽屜裡，不用 `Chip`（玻璃疊玻璃），只套 `tint.selected` 階梯；狀態畫面黑底版 `PageLoading`／`EmptyState`／`NoticeBanner`＋`Chip` 重試。
- 2026-10-25 掃尾：紅色只給破壞性動作與失敗（取消下載改中性）；色點用 `dotStroke` 描邊；列標題一行、數量下放到第二行，讓左滑按鈕等高（倉庫列：倉庫名＋「擁有者 · N 個源」）；圖示角標只給「要處理的事」，不放統計數字。
- 2026-10-25 聚合搜尋改成每個源一排（標題列「源名 · 筆數」推入單源結果）；0 筆與失敗收底部可展開區塊。**聚合頁不放篩選入口**，篩選留在單源結果頁（Venera 與 Aidoku 各一顆同款 chip，有自訂值時 `tint.selected`）。
- 2026-10-25 首頁：續讀卡封面下加系統 `ProgressView` 進度線（沒頁數也佔位，同排等高）；Bangumi hero 維持在最上面。固定高度的輪播用 `dynamicTypeSize` 夾到 `xxxLarge`，不寫死字級。
- 2026-10-25 首頁、瀏覽、`PageScroll`（設定等）加 `scrollTopBar(null)`：實機看得出柔和淡出，保留。
- 2026-10-26 書架重做：拿掉三分頁，改「閱讀歷史／離線內容」入口列（推新頁）＋收藏網格；格子帶閱讀狀態與封面下進度條（跟首頁繼續閱讀同位置），不標離線角標（下載一章也會被標，誤導）。歷史頁恢復左滑刪除。
- 2026-10-27 移除收藏是兩段式：那一格先縮小上移淡出（220ms）＋輕觸覺，演完才真的刪，其餘格子彈性靠攏（`components/gridRemoval.ts`）。直接消失太突兀。
  - `LazyVGrid` 的補位不吃 `withAnimation`（實機是直接跳位），所以位置是 `ComicGridLayout` 自己算的：先畫在舊位置、下一幀收成 0。改動那塊前先看全域記憶的 grid-reflow 條目。
- 2026-10-27 封面投影改成三層（`coverShadowKey`／`coverShadowPenumbra`／`coverShadowAmbient`，包在 `design/CoverShadow`）：單層大模糊＝四邊同暗糊成一圈，看起來像髒污不是懸浮。數值照 Material elevation level 1 的 key／penumbra／ambient 分工縮到封面尺寸；沒有 spread，所以三層都壓在小半徑、小偏移，側面才不會散開。
