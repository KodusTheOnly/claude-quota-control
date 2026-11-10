// Updates, only on a click in About (no timer, nothing downloaded before the click).
// "Check for updates" asks GitHub for the latest release. "Update now" downloads it, checks its sha512 against the
// release's latest.yml (electron-updater), installs it silently and starts the app again. A release with no latest.yml
// (2.1.0 and older), or a run from the source folder, can only be opened on GitHub to download by hand.
// The settings keep when the last check worked (lastUpdateCheck) and the version being installed (updateTo), so the
// next start can say whether it worked.
const { app, ipcMain, net } = require("electron");
const { autoUpdater } = require("electron-updater");
const i18n = require("./renderer/i18n.js");

const REPO = "KodusTheOnly/claude-quota-control";
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const releaseUrl = (v) => `https://github.com/${REPO}/releases/tag/v${v}`;

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.logger = null;
autoUpdater.on("error", () => {}); // errors come back through the promises below

function newerThan(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

let installable = null; // the version the last check found and can install
let busy = false;

// Without latest.yml: the release page, to download by hand
async function checkOnGitHub() {
  const res = await net.fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
  if (res.status === 404) return { status: "none" };
  if (!res.ok) return { status: "error" };
  const rel = await res.json();
  const version = String(rel.tag_name || "").replace(/^v/i, "");
  if (!version) return { status: "none" };
  return newerThan(version, app.getVersion()) ? { status: "newer", version, url: rel.html_url, canInstall: false } : { status: "latest", version };
}

async function check() {
  installable = null;
  if (autoUpdater.isUpdaterActive()) {
    try {
      const res = await autoUpdater.checkForUpdates();
      const version = res && res.updateInfo && res.updateInfo.version;
      if (version) {
        if (!newerThan(version, app.getVersion())) return { status: "latest", version };
        installable = version;
        return { status: "newer", version, url: releaseUrl(version), canInstall: true };
      }
    } catch {
      // No latest.yml in the release, or offline: the GitHub check below tells which
    }
  }
  try {
    return await checkOnGitHub();
  } catch {
    return { status: "error" };
  }
}

// Called once the app is ready. send(channel, value) reaches the window, notify(title, body) shows a notification.
function setupUpdates({ loadSettings, saveSettings, send, notify }) {
  ipcMain.handle("check-update", async () => {
    const res = await check();
    if (res.status !== "error") {
      res.checkedAt = Date.now();
      saveSettings({ ...loadSettings(), lastUpdateCheck: res.checkedAt });
    }
    return res;
  });

  ipcMain.handle("install-update", async () => {
    if (!installable || busy) return { status: "error" };
    busy = true;
    const onProgress = (p) => send("update-progress", Math.round((p && p.percent) || 0));
    autoUpdater.on("download-progress", onProgress);
    try {
      await autoUpdater.downloadUpdate();
    } catch {
      busy = false;
      return { status: "error", url: releaseUrl(installable) };
    } finally {
      autoUpdater.off("download-progress", onProgress);
    }
    saveSettings({ ...loadSettings(), updateTo: installable });
    // A moment for the window to show "Installing", then the app quits (before-quit lets the window close)
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 800);
    return { status: "installing", version: installable };
  });

  // The first start after an update says whether it worked
  const s = loadSettings();
  if (s.updateTo) {
    const ok = s.updateTo === app.getVersion();
    const [title, body] = ok ? ["upd.done.t", "upd.done.d"] : ["upd.notDone.t", "upd.notDone.d"];
    saveSettings({ ...s, updateTo: null });
    notify(i18n.t(title), i18n.t(body, { v: s.updateTo }));
  }
}

module.exports = { setupUpdates, newerThan };
