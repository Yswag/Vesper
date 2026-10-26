// English. **LLM 產出、未經母語者校對**。

export default {
  unsupported: {
    search: "This source does not support search",
    searchPaging: "This source's search does not support paging",
    category: "This source does not support category lists",
    ranking: "This source has no ranking",
    detail: "This source cannot load comic details",
    chapter: "This source cannot load chapters",
    comments: "This source cannot load comments",
    sendComment: "This source cannot post comments",
    account: "This source does not support account sign-in",
    cookie: "This source does not support cookie sign-in",
    browser: "This source does not support browser sign-in",
    explore: "\"{title}\" cannot be loaded (this source provides no load function)",
    exploreIndex: "This source has no explore section #{n}",
  },

  notLoaded: "{name} failed to load",
  notLoadedShort: "Source not loaded",
  notFound: "Source {key} not found",
  codeMissing: "Source code not found",

  exploreFallback: "Explore {n}",
  categoryFallback: "Category {n}",
  untitled: "(Untitled)",
  emptyChapter: "This chapter has no usable images",
  commentEmpty: "A comment cannot be blank",

  notOffline: "This chapter is not in offline storage",
  pageUnreadable: "Page {n} cannot be read (the file is missing or damaged)",

  verificationTitle: "Complete the security check ({name})",

  aidoku: {
    failed: "Source error: {message}",
    missing: "This source's files are missing (reinstall it)",
    timeout: "The source timed out",
    initFailed: "The source failed to initialize",
    invalidPackage: "Not a valid Aidoku source file (.aix)",
    chapter: "Chapter {n}",
    volume: "Vol. {n}",
    unavailable: "This source is unavailable ({reason}). Turn it off and on again in source settings to retry.",

    requiresPro: "Aidoku sources need Scripting Pro",
    requiresProDetail:
      "Aidoku sources run their WebAssembly on a local HTTP server. Upgrade to Scripting Pro, then come back and install.",

    indexInvalid: "Not an Aidoku index (expected { sources: [...] } or a JSON array)",
    indexBadId: "Invalid source id: {id}",
    indexBadEntry: "Index entry is missing name, version or a download path",
  },

  login: {
    expired: "Sign-in expired, please sign in again",
    cancelled: "Sign-in cancelled",
    done: "Signed in",
    cookiesSaved: { one: "Saved {count} cookie", other: "Saved {count} cookies" },
    webAccount: "WebView sign-in",
    windowTitle: "Sign in to {name}",
    windowBusy: "A sign-in window is already open",
    pageLoading: "Page load",
    pageLoadFailed: "Page failed to load: {message}",
    callback: "the source's onLoginSuccess()",
    timeout: "{subject} timed out ({seconds}s)",
    validateFailed: "Validation failed, please check your input",
    incompleteTitle: "Sign-in incomplete",
    incompleteMessage: {
      one: "No sign-in was detected. Save the {count} cookie just captured?",
      other: "No sign-in was detected. Save the {count} cookies just captured?",
    },
    saveCookies: "Save",
  },

  catalog: {
    notArray: "The index is not a JSON array",
    notObject: "Not an object",
    badFields: "name / key / version must be strings",
    badKey: "Invalid key: {key}",
    badVersion: "Invalid version: {version}",
    noTarget: "At least one of url / fileName is required",
    empty: "No usable source in the index",
    emptyWithReason: "No usable source in the index ({reason})",
    entryLabel: "(index entry)",
    singleObject: "This is a single JSON object, not a source or an index",
    isRepository: "This is a repository index — add it under Source repositories",
    repositoryNotArray: "A repository index must be a JSON array (index.json)",
    duplicateSkipped: "Another variant in this batch has the same key; only the first is kept",
    relativeOnly: "Relative path only — import it through the index URL instead",
    keyMismatch: "Source key mismatch: expected {expected}, got {actual}",
    downloadFailed: "Download failed: HTTP {status}",
  },

  repository: {
    urlRequired: "Enter a repository URL",
    notFound: "Repository not found",
    entryNotFound: "No such source in this repository",
  },

  settingNoAction: "This setting has no action to run",
}
