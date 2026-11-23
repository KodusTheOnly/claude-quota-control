// Claude account: login in a window of its own and a reading of the usage page in a
// hidden window. A reading starts only from a click or from a trigger listed in
// refresh-policy.js (opening the app, coming back to it, opening the tray card).
// This module has no timers and nothing here runs by itself. Whatever starts a reading (a click, or the
// optional timer in Settings > Advanced) does so from main.js.

const { app, BrowserWindow, session, net } = require("electron");
const fs = require("fs");
const path = require("path");
const { parseUsageText } = require("./usage-parser");
const { parseUsageJson, parseProducts, parseResets, describeShape } = require("./usage-json");
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
const TEXT_LIMIT = 2 * 1000; // one look at the page text: a page that is stuck must not hold a reading that already has its numbers

// What Claude's pages (and the sign-in pages they lead to) may be granted. Everything else is refused, including
// whatever a later Chromium adds: nothing the app reads needs the camera, the microphone, the location, notifications,
// the clipboard's contents, devices or the screen.
const ALLOWED_PERMISSIONS = new Set(["clipboard-sanitized-write", "fullscreen", "storage-access", "top-level-storage-access"]);

let uaReady = false;
let syncing = null;
let syncingVisible = false; // the reading that is running shows its window
let lastSyncAt = 0;
let loginWin = null;

function claudeSession() {
  const s = session.fromPartition(PARTITION);
  if (!uaReady) {
    // Plain Chrome user agent (no "Electron", no app name)
    const ua = s.getUserAgent().replace(/\s?Electron\/\S+/, "").replace(/\s?claude-quota-control\/\S+/i, "");
    s.setUserAgent(ua);
    // Claude's pages run here as remote content. Electron would grant them anything they ask for,
    // so only the short list above is granted.
    s.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
    s.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
    // Nor do they save files: a download started by a page (in the hidden window nobody would even see it) is cancelled
    s.on("will-download", (event) => event.preventDefault());
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
      // destroy, not close: a page can refuse a close, and this window must not stay behind
      if (loginWin && !loginWin.isDestroyed()) loginWin.destroy();
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

// What a reading leaves for debugging: names and types only, never the numbers
function saveNote(file, content) {
  try {
    fs.writeFileSync(path.join(app.getPath("userData"), file), `${new Date().toISOString()}\n\n${content}`);
  } catch {
    // not essential
  }
}
const saveFailedRead = (content) => saveNote("last-failed-read.txt", content);
// The field names of the last good answer, so a field Claude adds later (and the app ignores) can be seen
const saveReadShape = (data) => saveNote("last-read-shape.txt", `${JSON.stringify(describeShape(data), null, 1)}\n`);

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

// The text on the page, or "" when the page does not answer within TEXT_LIMIT, is still loading (Electron would
// queue the question until it stops, one more listener per call) or the window is gone
function pageText(w) {
  if (w.isDestroyed() || w.webContents.isLoadingMainFrame()) return Promise.resolve("");
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(""), TEXT_LIMIT);
  });
  const text = w.webContents.executeJavaScript("document.body ? document.body.innerText : ''", true).catch(() => "");
  return Promise.race([text, late]).finally(() => clearTimeout(timer));
}

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
  // The page's process died: nothing more will come from it
  let gone = false;
  w.webContents.on("render-process-gone", (_e, details) => {
    if (details && details.reason === "clean-exit") return; // a process that ended on its own, as when the page changes site
    gone = true;
    trace(`the page's process is gone: ${details && details.reason}`);
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
    // The page is not waited for: it can take longer to finish loading than the reading may last, and its usage
    // data usually arrives before that. The loop below watches the load and the data together.
    let loadError = null;
    let loadedAt = null;
    trace("opening the usage page");
    w.loadURL(USAGE_URL).then(
      () => {
        loadedAt = Date.now();
        trace("page loaded");
      },
      (e) => {
        loadError = e;
        loadedAt = Date.now();
        trace(`page load ended with ${e.code || e.message}`);
      }
    );
    while (Date.now() < deadline) {
      if (closedByUser) return { ok: false, error: "closed" };
      if (gone || got.detached) return { ok: false, error: "fail" };
      // No connection, DNS failure or timeout: say so right away instead of waiting out the deadline
      if (loadError && /ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|CONNECTION_|TIMED_OUT|PROXY|ADDRESS_UNREACHABLE)/.test(`${loadError.code || ""} ${loadError.message || ""}`)) {
        return { ok: false, error: "offline" };
      }
      // The window still shows its blank page until the usage page (or wherever it sends us) takes over
      const url = w.webContents.getURL();
      if (url && url !== "about:blank" && isLoginUrl(url)) return { ok: false, error: "need-login" };
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
        saveReadShape(data);
        // Extra usage still comes from the page text. If the text does not show up in time,
        // `extra` stays undefined and the app keeps what it had.
        // The text gets EXTRA_WAIT from the moment the page finished loading (or from now, when it already has),
        // and three times that when the page never finishes.
        let extra;
        const at = Date.now();
        const textDeadline = () => Math.min(deadline, loadedAt === null ? at + 3 * EXTRA_WAIT : Math.max(loadedAt, at) + EXTRA_WAIT);
        while (Date.now() < textDeadline() && !closedByUser && !gone) {
          const text = parseUsageText(await pageText(w));
          if (text.ok) {
            extra = text.extra;
            break;
          }
          await wait(400);
        }
        trace(extra === undefined ? "page text did not show up for Extra usage" : "page text read for Extra usage");
        // Optional parts of the same answer: null when missing or not in the expected shape, never a failed reading
        const products = parseProducts(data);
        const resets = parseResets(data);
        trace(`products ${products ? "read" : "not shown"}, resets ${resets ? "read" : "not shown"}`);
        return { ok: true, weekly: parsed.weekly, session: parsed.session, extra, products, resets, at: Date.now() };
      }
      await wait(300);
    }
    trace(`deadline reached (usage request ${got.requested ? "sent" : "not seen"}, answer: ${got.status === null ? "never seen" : `status ${got.status}`}, body ${got.body === null ? "missing" : "present"})`);
    if (closedByUser) return { ok: false, error: "closed" };
    const lastText = await pageText(w);
    const challenge = /verif|human|humano|just a moment|um momento|captcha|checking your browser/i.test(lastText);
    if (challenge) return { ok: false, error: "challenge" };
    // Still loading after all this time: a connection too slow to read on, which is not the same as none
    if (!lastText.trim() && !w.isDestroyed() && w.webContents.isLoadingMainFrame()) return { ok: false, error: "fail" };
    if (!lastText.trim()) return { ok: false, error: "offline" };
    // The page opened but its usage data never arrived in a usable form
    if (got.status !== null && got.status !== 200) return { ok: false, error: "fail" };
    // The page asked and the answer was still on its way: a slow connection, not a change in Claude's data
    if (got.requested && got.status === null) return { ok: false, error: "fail" };
    // The answer came but could not be read from the browser: not a change in Claude's data either
    if (got.bodyFailed) return { ok: false, error: "fail" };
    saveFailedRead(got.status === null ? "the page never asked for the usage data" : "the usage data came back empty");
    return { ok: false, error: "format" };
  } finally {
    try {
      if (!w.isDestroyed() && w.webContents.debugger.isAttached()) w.webContents.debugger.detach();
    } catch {
      // already detached
    }
    // destroy, not close: a page can refuse a close, and a hidden window left behind would never be seen
    if (!w.isDestroyed()) w.destroy();
  }
}

// Entry point for the "Refresh now" button
// One reading at a time: a second request gets the answer of the one already running. The exception is a request to
// show the window (to pass a check) while a hidden reading runs: that one would fail the same way, so the visible one
// waits for it and then runs.
async function sync(opts = {}) {
  if (syncing) {
    if (!opts.visible || syncingVisible) return syncing;
    await syncing.catch(() => {});
    return sync(opts);
  }
  const since = Date.now() - lastSyncAt;
  if (!opts.visible && since < MIN_GAP) {
    return { ok: false, error: "too-soon", retryIn: MIN_GAP - since };
  }
  syncingVisible = Boolean(opts.visible);
  // A reading that throws (a window that cannot be created, say) is a plain failure, never a promise left broken
  const run = readUsage(opts)
    .catch(() => ({ ok: false, error: "fail" }))
    .finally(() => {
      if (syncing === run) syncing = null;
    });
  syncing = run;
  const result = await run;
  if (result.ok) lastSyncAt = Date.now();
  return result;
}

module.exports = { login, logout, sync, USAGE_URL };
