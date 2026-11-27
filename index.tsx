import { Device, Navigation, Script } from "scripting"

import { App } from "./app/App"
import { createComicLibrary } from "./app/comic"
import { listenForInstallLinks, readInstallTarget } from "./app/installLink"
import { onBeforeExit } from "./app/lifecycle"
import { installLocaleSetting } from "./app/localeSetting"
import { installOfflineSession } from "./app/offlineSession"
import { installComicLibrary } from "./app/services"
import { composeImage } from "./components/ModifyImageRenderer"
import { ensureFileAccess } from "./engine/fs"
import { purgeLegacyImageCacheOnce, scheduleImageCacheCleanup, setImageCompositor } from "./engine/imagecache"
import { onLocaleChange } from "./i18n"
import { flushLibrary, reloadLibraryFromDisk } from "./library/bookshelf"
import { reloadRegistry } from "./sources/registry"

const FIRST_FRAME_CLEANUP_DELAY = 600

let firstFrameCleanup: number | null = null

function scheduleFirstFrameCleanup(): void {
  if (firstFrameCleanup !== null) return
  firstFrameCleanup = setTimeout(() => {
    firstFrameCleanup = null
    scheduleImageCacheCleanup()
  }, FIRST_FRAME_CLEANUP_DELAY)
}

async function run() {
  onBeforeExit(() => flushLibrary())

  const pendingInstall = readInstallTarget(Script.queryParameters)
  listenForInstallLinks()

  await ensureFileAccess()

  installLocaleSetting(Device.systemLocales)

  reloadLibraryFromDisk()

  purgeLegacyImageCacheOnce()
  scheduleFirstFrameCleanup()

  setImageCompositor(composeImage)

  reloadRegistry()

  onLocaleChange(() => reloadRegistry())

  installComicLibrary(createComicLibrary())

  installOfflineSession()

  await Navigation.present({
    element: <App pendingInstall={pendingInstall} />,
    modalPresentationStyle: "fullScreen",
  })
  Script.exit()
}

void run()
