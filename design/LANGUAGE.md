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
- 封面的投影屬於圖片本身（封面不透明，壓在任何底色上都是黑影）：`CoverImage lifted`（`coverShadow`），只掛在圖片那層。

## 封面

- 一律 `components/CoverImage`，傳 `title`：沒圖時用標題雜湊挑主題色盤畫漸層＋首字（同標題同色）；載入中是 surface 底＋小轉圈。
- 圖上的短角標一律 `design/CoverBadge`（`tone="danger"` 給「來源已移除」）；頁面不自刻 `ultraThinMaterial` 膠囊。網格裡頁數在左上、時間／狀態在下緣。
- 網格書名靠左，最多兩行；副標與來源一行。

## 浮層

- 對話框卡片 `radius.xl`、內層 `radius.md`、按鈕膠囊；顏色在 `dialog` token 群組；不加陰影，分離靠遮罩。
- 預設按鈕＝`tint` 實心底＋`onTint` 字；取消微透底；破壞性紅字。

## 間距

`pageInsets`、`pageSpacing`、`sectionSpacing`、`cardGap`、`rowPadding` 等都在 `design/tokens.ts`，頁面直接用名字。

## 閱讀器

畫布純黑，不加任何品牌色；玻璃只出現在 HUD。

## 守門

- `scripting-ts run dev/design-lint.ts`：掃 `screens/`、`components/`、`app/`（不含 `app/theme.tsx`）的違規，跟 `dev/design-lint.baseline.json` 比。**每個檔每條規則只准減不准增**；減少後要更新基準。新增或刪除 `.tsx` 要同步頁面清單（`.scratch/visual-polish/pages.md`），否則 FAIL。規則裡的 `card` 抓的是頁面自刻的 `stroke={hairlineStroke}`（該用 `Card`）。
- 截圖基準：每批結束截 `dev/preview-design.tsx`（amber、ink × 深淺）與該批頁面，跟上一批比。
- 玻璃截圖拍不出來：動到玻璃就 `scripting-ts run dev/show-glass.tsx`（淺／深上下並排），請使用者實機截圖。

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
