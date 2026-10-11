// 三份字典的組裝點，與 `t()` 的 key 型別。
//
// 一份語言一個目錄、一個領域一個檔案，**key 路徑＝檔名**：
// `t("common.pages")` → `strings/<locale>/common.ts` 的 `pages`。

import type { LocaleId } from "../locale"
import bookshelfEn from "./en/bookshelf"
import browseEn from "./en/browse"
import commentsEn from "./en/comments"
import commonEn from "./en/common"
import detailEn from "./en/detail"
import homeEn from "./en/home"
import readerEn from "./en/reader"
import searchEn from "./en/search"
import settingsEn from "./en/settings"
import sourcesEn from "./en/sources"
import bookshelfZhHans from "./zh-Hans/bookshelf"
import browseZhHans from "./zh-Hans/browse"
import commentsZhHans from "./zh-Hans/comments"
import commonZhHans from "./zh-Hans/common"
import detailZhHans from "./zh-Hans/detail"
import homeZhHans from "./zh-Hans/home"
import readerZhHans from "./zh-Hans/reader"
import searchZhHans from "./zh-Hans/search"
import settingsZhHans from "./zh-Hans/settings"
import sourcesZhHans from "./zh-Hans/sources"
import bookshelfZhHant from "./zh-Hant/bookshelf"
import browseZhHant from "./zh-Hant/browse"
import commentsZhHant from "./zh-Hant/comments"
import commonZhHant from "./zh-Hant/common"
import detailZhHant from "./zh-Hant/detail"
import homeZhHant from "./zh-Hant/home"
import readerZhHant from "./zh-Hant/reader"
import searchZhHant from "./zh-Hant/search"
import settingsZhHant from "./zh-Hant/settings"
import sourcesZhHant from "./zh-Hant/sources"

/** 一則訊息：字串，或有複數形的 `{ one, other }`（挑哪一形由 `Intl.PluralRules` 決定）。 */
export type Message = string | { one: string; other: string }

/** 三份字典共同的形狀：**以 zh-Hant 為準**——另外兩份少一個 key 就編譯不過。 */
type Translations = {
  common: typeof commonZhHant
  home: typeof homeZhHant
  settings: typeof settingsZhHant
  sources: typeof sourcesZhHant
  detail: typeof detailZhHant
  comments: typeof commentsZhHant
  reader: typeof readerZhHant
  browse: typeof browseZhHant
  search: typeof searchZhHant
  bookshelf: typeof bookshelfZhHant
}

/** 走完一整棵字典，把巢狀的形狀攤成 `a.b.c` 這種路徑。 */
type KeyPaths<T> = {
  [K in keyof T & string]: T[K] extends Message ? K : `${K}.${KeyPaths<T[K]>}`
}[keyof T & string]

/** 打得出這種形狀的 key 才算對（打錯是編譯錯誤，不是執行期才發現）。 */
export type MessageKey = KeyPaths<Translations>

/** 三份字典。key 集合必須完全相同，由上面的 `Translations` 綁住。 */
export const dictionaries: Record<LocaleId, Translations> = {
  "zh-Hant": { common: commonZhHant, home: homeZhHant, settings: settingsZhHant, sources: sourcesZhHant, detail: detailZhHant, comments: commentsZhHant, reader: readerZhHant, browse: browseZhHant, search: searchZhHant, bookshelf: bookshelfZhHant },
  "zh-Hans": { common: commonZhHans, home: homeZhHans, settings: settingsZhHans, sources: sourcesZhHans, detail: detailZhHans, comments: commentsZhHans, reader: readerZhHans, browse: browseZhHans, search: searchZhHans, bookshelf: bookshelfZhHans },
  en: { common: commonEn, home: homeEn, settings: settingsEn, sources: sourcesEn, detail: detailEn, comments: commentsEn, reader: readerEn, browse: browseEn, search: searchEn, bookshelf: bookshelfEn },
}
