// Claude account: login in a window of its own and a reading of the usage page in a
// hidden window. A reading starts only from a click or from a trigger listed in
// refresh-policy.js (opening the app, coming back to it, opening the tray card).
// This module has no timers and nothing here runs by itself. Whatever starts a reading (a click, or the
// optional timer in Settings > Advanced) does so from main.js.

const { app, BrowserWindow, session, net } = require("electron");
const fs = require("fs");
const path = require("path");
const { parseUsageText } = require("./usage-parser");
const { parseUsageJson, describeShape } = require("./usage-json");
const { listenForUsage } = require("./usage-listener");
const i18n = require("./renderer/i18n.js");
const { MIN_GAP } = require("./refresh-policy"); // at most one reading per minute, whatever asks

const PARTITION = "persist:claude"; // separate session, used only by this app
const USAGE_URL = process.env.CLAUDE_QUOTA_USAGE_URL || "https://claude.ai/settings/usage";
const LOGIN_URL = process.env.CLAUDE_QUOTA_LOGIN_URL || "https://claude.ai/login";
const ORIGIN = new URL(USAGE_URL).origin;
const HIDDEN_TIMEOUT = 25 * 1000;
const VISIBLE_TIMEOUT = 3 * 60 * 1000;
const HARD_LIMIT_EXTRA = 10 * 1000; // a reading is cut off this long after its own deadline
const EXTRA_WAIT = 4 * 1000; // how long to wait for the page text, which is only used for Extra usage

const DENIED_PERMISSIONS = new Set([
  "media", "mediaKeySystem", "geolocation", "notifications", "midi", "midiSysex", "pointerLock",
  "clipboard-read", "display-capture", "idle-detection", "openExternal", "hid", "serial", "usb",
  "window-management", "speaker-selection", "keyboardLock",
]);

let uaReady = false;
let syncing = null;
let lastSyncAt = 0;
let loginWin = null;

function claudeSession() {
  const s = session.fromPartition(PARTITION);
  if (!uaReady) {
    // Plain Chrome user agent (no "Electron", no app name)
    const ua = s.getUserAgent().replace(/\s?Electron\/\S+/, "").replace(/\s?claude-quota-control\/\S+/i, "");
    s.setUserAgent(ua);
    // Claude's pages run here as remote content. Electron would grant them anything they ask for,
    // so the sensitive permissions are refused. Nothing the app reads needs them.
    s.setPermissionRequestHandler((_wc, permission, callback) => callback(!DENIED_PERMISSIONS.has(permission)));
    s.setPermissionCheckHandler((_wc, permission) => !DENIED_PERMISSIONS.has(permission));
    uaReady = true;
  }
  return s;
}

function isLoginUrl(url) {
  try {
    const u = new URL(url);
    if (u.origin !== ORIGIN) return true; // Google, sign-in providers and so on
    return /^\/(login|logout|signup|magic-link|oauth|sso)/.test(u.pathname);
  } catch {
    return true;
  }
}

function childWindowOptions() {
  return {
    action: "allow",
    overrideBrowserWindowOptions: {
      width: 520,
      height: 720,
      autoHideMenuBar: true,
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true },
    },
  };
}

// Opens Claude's real login page. Resolves when the login finishes
// or when the user closes the window.
function login(parent) {
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.focus();
    return Promise.resolve({ ok: false, error: "already-open" });
  }
  claudeSession();
  return new Promise((resolve) => {
    let done = false;
    loginWin = new BrowserWindow({
      width: 520,
      height: 760,
      parent: parent || undefined,
      title: i18n.t("login.title"),
      autoHideMenuBar: true,
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true },
    });
    const finish = (result) => {
      if (done) return;
      done = true;
      resolve(result);
      if (loginWin && !loginWin.isDestroyed()) loginWin.close();
      loginWin = null;
    };
    const check = (_e, url) => {
      if (!isLoginUrl(url)) setTimeout(() => finish({ ok: true }), 1200);
    };
    loginWin.webContents.setWindowOpenHandler(childWindowOptions);
    loginWin.webContents.on("did-navigate", check);
    loginWin.webContents.on("did-navigate-in-page", check);
    loginWin.on("closed", () => finish({ ok: false, error: "closed" }));
    loginWin.loadURL(LOGIN_URL);
  });
}

async function logout() {
  const s = claudeSession();
  await s.clearStorageData();
  await s.clearCache();
  return { ok: true };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// What a failed reading leaves for debugging: names and types only, never the numbers
function saveFailedRead(content) {
  try {
    fs.writeFileSync(path.join(app.getPath("userData"), "last-failed-read.txt"), `${new Date().toISOString()}\n\n${content}`);
  } catch {
    // not essential
  }
}

// Step by step record of the last reading (step names and statuses, never numbers), kept in
// last-read-trace.txt so a reading that stops can be diagnosed.
function makeTrace() {
  const t0 = Date.now();
  const lines = [];
  const trace = (text) => {
    if (lines.length < 80) lines.push(`+${String(Date.now() - t0).padStart(5)} ms  ${text}`);
  };
  trace.save = () => {
    try {
      fs.writeFileSync(path.join(app.getPath("userData"), "last-read-trace.txt"), `${new Date().toISOString()}\n\n${lines.join("\n")}\n`);
    } catch {
      // not essential
    }
  };
  return trace;
}

const pageText = (w) => w.webContents.executeJavaScript("document.body ? document.body.innerText : ''", true).catch(() => "");

// Reads the usage. "visible" shows the window (useful when a security check needs a click).
// Week and session come from the JSON the page receives. The page text is only used for the
// Extra usage block, which is not in that JSON yet.
// A reading can never hang for good: if it goes past its limit it ends as a plain failure.
async function readUsage(opts = {}) {
  const trace = makeTrace();
  const ref = { win: null };
  const limit = (opts.visible ? VISIBLE_TIMEOUT : HIDDEN_TIMEOUT) + HARD_LIMIT_EXTRA;
  let timer;
  const hung = new Promise((resolve) => {
    timer = setTimeout(() => {
      trace("hard limit reached, the reading was cut off");
      if (ref.win && !ref.win.isDestroyed()) ref.win.destroy();
      resolve({ ok: false, error: "fail" });
    }, limit);
  });
  try {
    const result = await Promise.race([readUsageSteps(opts, trace, ref), hung]);
    trace(result.ok ? "done: ok" : `done: error ${result.error}`);
    return result;
  } finally {
    clearTimeout(timer);
    trace.save();
  }
}

async function readUsageSteps({ visible = false, parent } = {}, trace, ref) {
  if (!net.isOnline()) return { ok: false, error: "offline" };
  claudeSession();
  const w = new BrowserWindow({
    show: visible,
    width: 960,
    height: 780,
    parent: visible ? parent || undefined : undefined,
    title: i18n.t("usage.windowTitle"),
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  ref.win = w;
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.setAudioMuted(true);

  let closedByUser = false;
  w.on("closed", () => {
    closedByUser = true;
  });

  const deadline = Date.now() + (visible ? VISIBLE_TIMEOUT : HIDDEN_TIMEOUT);
  try {
    // The debugger only works once the window has a page, so it gets a blank one first
    trace("preparing the window");
    await w.loadURL("about:blank").catch(() => {});
    trace("blank page ready");
    let got;
    try {
      got = await listenForUsage(w.webContents, ORIGIN, trace);
      trace("listening to the page's network");
    } catch (e) {
      trace(`could not listen: ${e && e.message}`);
      return { ok: false, error: "fail" };
    }
    let loadError = null;
    trace("opening the usage page");
    await w.loadURL(USAGE_URL).catch((e) => {
      loadError = e;
    });
    trace(loadError ? `page load ended with ${loadError.code || loadError.message}` : "page loaded");
    // No connection, DNS failure or timeout: say so right away instead of waiting out the deadline
    if (loadError && /ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|CONNECTION_|TIMED_OUT|PROXY|ADDRESS_UNREACHABLE)/.test(`${loadError.code || ""} ${loadError.message || ""}`)) {
      return { ok: false, error: "offline" };
    }
    while (Date.now() < deadline) {
      if (closedByUser) return { ok: false, error: "closed" };
      const url = w.webContents.getURL();
      if (url && isLoginUrl(url)) return { ok: false, error: "need-login" };
      if (got.status === 401) return { ok: false, error: "need-login" };
      if (got.status === 200 && got.body !== null) {
        let data = null;
        try {
          data = JSON.parse(got.body);
        } catch {
          // handled below as a format error
        }
        const parsed = parseUsageJson(data);
        trace(parsed.ok ? "usage data is valid" : `usage data rejected: ${parsed.problem}`);
        if (!parsed.ok) {
          saveFailedRead(`${parsed.problem}\n${JSON.stringify(describeShape(data), null, 1)}`);
          return { ok: false, error: "format" };
        }
        // Extra usage still comes from the page text. If the text does not show up in time,
        // `extra` stays undefined and the app keeps what it had.
        let extra;
        const textDeadline = Math.min(deadline, Date.now() + EXTRA_WAIT);
        while (Date.now() < textDeadline && !closedByUser) {
          const text = parseUsageText(await pageText(w));
          if (text.ok) {
            extra = text.extra;
            break;
          }
          await wait(400);
        }
        trace(extra === undefined ? "page text did not show up for Extra usage" : "page text read for Extra usage");
        return { ok: true, weekly: parsed.weekly, session: parsed.session, extra, at: Date.now() };
      }
      await wait(300);
    }
    trace(`deadline reached (usage answer: ${got.status === null ? "never seen" : `status ${got.status}`}, body ${got.body === null ? "missing" : "present"})`);
    const lastText = await pageText(w);
    const challenge = /verif|human|humano|just a moment|um momento|captcha|checking your browser/i.test(lastText);
    if (challenge) return { ok: false, error: "challenge" };
    if (!lastText.trim()) return { ok: false, error: "offline" };
    // The page opened but its usage data never arrived in a usable form
    if (got.status !== null && got.status !== 200) return { ok: false, error: "fail" };
    saveFailedRead(got.status === null ? "the page never asked for the usage data" : "the usage data came back empty");
    return { ok: false, error: "format" };
  } finally {
    try {
      if (!w.isDestroyed() && w.webContents.debugger.isAttached()) w.webContents.debugger.detach();
    } catch {
      // already detached
    }
    if (!closedByUser && !w.isDestroyed()) w.close();
  }
}

// Entry point for the "Refresh now" button
async function sync(opts = {}) {
  if (syncing) return syncing;
  const since = Date.now() - lastSyncAt;
  if (!opts.visible && since < MIN_GAP) {
    return { ok: false, error: "too-soon", retryIn: MIN_GAP - since };
  }
  syncing = readUsage(opts).finally(() => {
    syncing = null;
  });
  const result = await syncing;
  if (result.ok) lastSyncAt = Date.now();
  return result;
}

module.exports = { login, logout, sync, USAGE_URL };
