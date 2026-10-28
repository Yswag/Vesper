// English. **LLM 產出、未經母語者校對**。

export default {
  working: "Working…",
  input: "Enter text",
  confirm: "OK",
  untitled: "(Untitled)",
  noCover: "No cover",
  undecodable: "Can't decode",
  exitLabel: "Quit Vesper, back to Scripting",
  exitBlockedTitle: "Can't minimize to background",
  exitBlockedMessage:
    "You may have more than one window open. Quitting will stop the download (pages already fetched are kept).",
  exitContinue: "Keep downloading",
  exitAnyway: "Quit anyway",
  allShown: "— End of list —",
  loadFailed: "Couldn't load: {message}",
  /** Plain-language versions of technical error strings (see `engine/errors.ts`). */
  problem: {
    server: "Server error ({status})",
    request: "Request refused ({status})",
    timeout: "The connection timed out",
    network: "No internet connection",
    unknown: "Something went wrong",
  },
  retry: "Retry",
  imageFailed: "(image failed to load)",
  offlineTag: "Offline",

  pageMissing: "Page {n} does not exist ({total} pages in all)",
  pages: { one: "{n} page", other: "{n} pages" },

  tabs: {
    home: "Home",
    bookshelf: "Bookshelf",
    browse: "Browse",
    settings: "Settings",
    search: "Search",
  },
  sectionMenu: "Switch section, currently {title}",

  cancel: "Cancel",
  save: "Save",
  add: "Add",
  delete: "Delete",
  copy: "Copy",
  copied: "Copied",
  remove: "Remove",
  clear: "Clear",
  close: "Close",
  inProgress: "{label}…",
  failed: "Failed: {message}",

  loading: "Loading…",
  loadingMore: "Loading more…",

}
