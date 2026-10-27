// 留言頁（`screens/shared/CommentScreen.tsx`）。
//
// 留言內文、使用者名、頭像都是源的資料，不翻；時間只有「不到一分鐘」是這裡的字，
// 其餘的相對時間由 `Intl.RelativeTimeFormat` 產生（見 `screens/shared/commentTime.ts`）。

export default {
  title: "留言",
  /** 源沒給使用者名時的替代字。 */
  anonymous: "(無名)",
  /** `{n}` 是回覆數。 */
  replyCount: { one: "{n} 則回覆", other: "{n} 則回覆" },
  /** 送出後本機回音那一則的作者（源沒給帳號名時）。 */
  me: "我",
  /** 不到一分鐘：這一句沒有數字，所以不走 `Intl`。 */
  justNow: "剛剛",

  /** 未登入的橫幅。 */
  notLoggedIn: "尚未登入",
  loginHint: "登入後即可發表留言並查看完整互動",
  goLogin: "前往登入",

  /** 底部輸入列。 */
  composerPrompt: "寫點什麼…",
  sending: "送出中…",
  sent: "已送出",

  /** 列表本身。 */
  loadFailed: "讀取留言失敗",
  empty: "還沒有人留言",
  emptyHint: "搶下第一則吧。",
  loadMore: "載入更多",
}
