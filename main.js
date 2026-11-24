// Main process of Claude Quota Control (Electron).
// Reads ~/.claude/claude-quota-control.json and owns the window, the tray, notifications,
// "start with Windows" and the collector install.

const { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, ipcMain, Notification, shell, screen, dialog, globalShortcut, powerMonitor } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync, exec, spawn } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const claude = require("./claude-sync");
const { readActivity } = require("./claude-activity");
const i18n = require("./renderer/i18n.js");
const { setupUpdates } = require("./updater");
const { createRefreshPolicy, normalizeAccelerator, timerVerdict, MIN_GAP, AUTO_READ_CHOICES, autoReadEvery, autoReadDelay, autoReadSkip, inActiveHours } = require("./refresh-policy");

const SLUG = "claude-quota-control";
const BACKUP_SUFFIX = ".quota-control-backup";

// CQC_CLAUDE_DIR lets the tests point it at a temporary folder, away from the real one
const CLAUDE_DIR = process.env.CQC_CLAUDE_DIR || path.join(os.homedir(), ".claude");
const DATA_FILE = path.join(CLAUDE_DIR, `${SLUG}.json`);
const CLAUDE_SETTINGS = path.join(CLAUDE_DIR, "settings.json");
const COLLECTOR_CONFIG = path.join(CLAUDE_DIR, `${SLUG}-config.json`);
const COLLECTOR_DIR = path.join(CLAUDE_DIR, SLUG);
const COLLECTOR_TARGET = path.join(COLLECTOR_DIR, "statusline.js");
const COLLECTOR_SOURCE = path.join(__dirname, "collector", "statusline.js");
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");

const DEFAULT_SETTINGS = {
  language: "en",
  theme: "dark", // a new install opens dark
  screens: "paper", // the data screens: light paper (default, light theme only; the dark theme shows CRT then), CRT, amber or green CRT
  motion: "full", // how much moves: everything, only what explains a change, or nothing (the system's reduced motion wins)
  openAtLogin: false,
  notifyAll: true,
  notifyLevel: true,
  fiveHourThreshold: 75,
  remindEvery: "smart",
  notifyResets: true,
  shortcutOn: false,
  shortcutKeys: "Ctrl+Alt+R",
  claudeConnected: false,
  manual: null,
  notified: {},
  codeLogs: true, // the hourly strip may use Claude Code's local logs (timestamps and token counts only)
  // The opt-in timer (see the warning in Settings): autoReadEvery is how often, in minutes or "smart". It has no
  // default here on purpose: without it, an older settings file's autoRead: true still means every 5 minutes.
  autoRead: false,
  autoReadActiveOnly: true, // the timer reads only inside the active hours (Settings > Plan), when there are some
  autoReadIdlePause: true, // the timer skips its readings while the PC is idle or locked
  reserve: 0, // emergency reserve, % of the week kept out of the daily plan (off by default)
  reserveRelease: 48, // hours before the reset over which what is left of the reserve joins the plan (0 = never)
  pastWeeks: false, // the "4 wk" key on the week chart: the last 4 weeks drawn with this one
  autoWeights: false, // Settings > Plan, "Follow my usual week": the plan takes the weights the past weeks suggest
  lastUpdateCheck: 0, // when "Check for updates" last worked (updater.js)
  updateTo: null, // the version "Update now" is installing, read at the next start (updater.js)
};

// Window frame colors (same as --win and --ink in renderer/css/tokens.css), one set per theme
const FRAME = {
  light: { color: "#C9C5BA", symbol: "#1A1A18" },
  dark: { color: "#17191B", symbol: "#E8E6DE" },
};
const THEMES = ["system", "light", "dark"];
const SCREENS = ["crt", "paper", "amber", "green"];
const MOTIONS = ["full", "subtle", "off"]; // Settings > Display > Motion
const frameColors = () => FRAME[nativeTheme.shouldUseDarkColors ? "dark" : "light"];

// The title bar buttons are drawn by the system, so they have to be recolored with the theme
function updateFrame() {
  if (!win || win.isDestroyed()) return;
  const { color, symbol } = frameColors();
  win.setBackgroundColor(color);
  win.setTitleBarOverlay({ color, symbolColor: symbol, height: 40 });
}
nativeTheme.on("updated", updateFrame);

let win = null;
let tray = null;
let trayMenu = null;
let popup = null;
let popupHiddenAt = 0;
let lastSummary = null;
let quitting = false;
const startHidden = process.argv.includes("--hidden");

// Only the app's own three windows (the main one, the tray card and the strip) may talk to the main process, and only
// from their top page. Claude's pages run in windows of their own with no bridge at all; this is the second lock,
// should a page ever end up somewhere it should not be.
function fromApp(event) {
  const sender = event && event.sender;
  if (!sender) return false;
  const mine = [win, popup, strip].some((w) => w && !w.isDestroyed() && w.webContents === sender);
  if (!mine) return false;
  return !(event.senderFrame && sender.mainFrame && event.senderFrame !== sender.mainFrame);
}
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromApp(event)) throw new Error("refused");
    return fn(event, ...args);
  });
}
function on(channel, fn) {
  ipcMain.on(channel, (event, ...args) => {
    if (fromApp(event)) fn(event, ...args);
  });
}

// Windows programs the app starts are named by their full path: a bare name would be looked up in the current
// folder first.
const SYSTEM32 = path.join(process.env.SystemRoot || process.env.windir || "C:\\Windows", "System32");
const REG_EXE = path.join(SYSTEM32, "reg.exe");
const POWERSHELL_EXE = path.join(SYSTEM32, "WindowsPowerShell", "v1.0", "powershell.exe");

// Helpers

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// An antivirus or the search indexer can hold a file for a moment, and Windows then refuses the rename
function renameWithRetry(from, to) {
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if (i >= 4 || !["EPERM", "EBUSY", "EACCES"].includes(err.code)) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

// Writes a temporary file, makes sure it is on disk, then renames it over the real one.
// keepPrevious: the version being replaced stays next to it as <file>.bak
function writeJson(file, value, { keepPrevious = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (keepPrevious && fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, file + ".bak");
    } catch {
      // the new version still gets written
    }
  }
  renameWithRetry(tmp, file);
}

const SETTINGS_BAK = SETTINGS_FILE + ".bak";
// Set when the settings file could not be read at start: { kind: "restored" | "reset", copy }
let settingsRecovery = null;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// A missing file is a first run. A file that cannot be read is kept as a copy (it may still be
// recovered by hand) and the previous version (.bak) takes its place. The defaults are only used
// when neither can be read, so a damaged file never silently wipes the history.
function readSettingsFile() {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  const current = readJson(SETTINGS_FILE);
  if (isPlainObject(current)) return current;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const copy = `${SETTINGS_FILE}.damaged-${stamp}`;
  try {
    fs.copyFileSync(SETTINGS_FILE, copy);
  } catch {
    // nothing more can be kept
  }
  const previous = readJson(SETTINGS_BAK);
  const recovered = isPlainObject(previous) ? previous : {};
  writeJson(SETTINGS_FILE, recovered); // from here on the file reads again, so this runs once
  settingsRecovery = { kind: isPlainObject(previous) ? "restored" : "reset", copy };
  return recovered;
}

function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...readSettingsFile() };
}

function saveSettings(next) {
  snapshotSettings("daily");
  writeJson(SETTINGS_FILE, next, { keepPrevious: true });
  return next;
}

// The app moved folders (a new installer, say): point the start-with-Windows entry at the current exe
function refreshLoginItem() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
  const opts = { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 };
  let out;
  try {
    out = execSync(`"${REG_EXE}" query "${key}" /v "com.kodus.claudequotacontrol"`, opts);
  } catch {
    return; // does not start with Windows
  }
  if (!out.toLowerCase().includes(process.execPath.toLowerCase())) {
    app.setLoginItemSettings({ openAtLogin: true, args: ["--hidden"] });
  }
}

// Window

// The app's windows only ever show the app's own pages. A file dropped on a window or a stray link
// would replace the page (and hand it the preload), so navigation is refused. Links that open a new
// window go to the browser, and only when they are plain https.
function lockToApp(contents) {
  contents.on("will-navigate", (e) => e.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (isWebLink(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

function isWebLink(url) {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

// The main window opens where it was left, kept on a screen that still exists
let pendingMaximize = false;

function savedWinPlace() {
  const s = loadSettings().winBounds;
  if (!s || ![s.x, s.y, s.width, s.height].every(Number.isFinite)) return null;
  const wa = screen.getDisplayNearestPoint({ x: Math.round(s.x + s.width / 2), y: Math.round(s.y + 20) }).workArea;
  const width = Math.min(Math.max(Math.round(s.width), 420), wa.width);
  const height = Math.min(Math.max(Math.round(s.height), 480), wa.height);
  const x = Math.min(Math.max(Math.round(s.x), wa.x), wa.x + wa.width - width);
  const y = Math.min(Math.max(Math.round(s.y), wa.y), wa.y + wa.height - height);
  return { bounds: { x, y, width, height }, maximized: s.maximized === true };
}

function saveWinPlace() {
  if (!win || win.isDestroyed() || win.isMinimized() || pendingMaximize) return;
  const maximized = win.isMaximized() === true;
  const b = maximized ? win.getNormalBounds() : win.getBounds();
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return;
  saveSettings({ ...loadSettings(), winBounds: { x: b.x, y: b.y, width: b.width, height: b.height, maximized } });
}

// A window started hidden is maximized on its first show, not before (maximizing shows it)
function showSaved() {
  if (pendingMaximize) {
    pendingMaximize = false;
    win.maximize();
  }
  win.show();
}

function createWindow() {
  const savedTheme = loadSettings().theme;
  nativeTheme.themeSource = THEMES.includes(savedTheme) ? savedTheme : "dark";
  const frame = frameColors();
  win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 420,
    minHeight: 480,
    useContentSize: true,
    show: false,
    title: i18n.t("app.name"),
    icon: path.join(__dirname, "assets", "icon.png"),
    backgroundColor: frame.color,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: frame.color, symbolColor: frame.symbol, height: 40 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const place = savedWinPlace();
  if (place) win.setBounds(place.bounds);
  pendingMaximize = !!(place && place.maximized);
  let placeTimer = null;
  const keepPlace = () => {
    clearTimeout(placeTimer);
    placeTimer = setTimeout(saveWinPlace, 500);
  };
  for (const ev of ["moved", "resize", "maximize", "unmaximize"]) win.on(ev, keepPlace);
  win.on("hide", () => {
    clearTimeout(placeTimer);
    saveWinPlace();
  });

  win.removeMenu();
  // F5 and Ctrl+Shift+R refresh the numbers (the window has no menu, so nothing else uses them)
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.isAutoRepeat) return;
    const key = String(input.key).toLowerCase();
    if (key === "f5" || (input.control && input.shift && key === "r")) {
      event.preventDefault();
      requestSync("keyboard");
    }
  });
  // Coming back to the window refreshes too, if the last attempt is older than 5 minutes
  win.on("focus", () => requestSync("focus"));
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => {
    if (!startHidden) showSaved();
  });

  // Closing hides to the tray; quitting for real is only in the tray menu
  win.on("close", (e) => {
    clearTimeout(placeTimer);
    saveWinPlace();
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });

  lockToApp(win.webContents);
}

function showWindow() {
  if (!win) return;
  hidePopup();
  if (win.isMinimized()) win.restore();
  showSaved();
  win.focus();
}

// Opens the window with the cursor in the weekly % field
function showUpdate() {
  showWindow();
  if (win && !win.isDestroyed()) win.webContents.send("focus-update");
}

// Asks the renderer for a reading of the usage page. refresh-policy.js decides whether a reason may
// run: what the user does always runs; opening the app, coming back to it and opening the tray card
// are automatic, quiet and need a connected account. The only timer is the optional one in
// Settings > Data > Danger zone (autoReadEvery, off by default): see applyAutoRead().
const refreshPolicy = createRefreshPolicy();
let rendererIsReady = false; // before this the window cannot take a request, so it would be lost

function requestSync(reason) {
  if (!rendererIsReady || !win || win.isDestroyed()) return;
  const { run, auto } = refreshPolicy.request(reason, Boolean(loadSettings().claudeConnected));
  if (run) win.webContents.send("sync-request", { auto });
}

// Optional timer: reads every few minutes while the app runs (1 to 60, or "smart"). Off by default and in the
// Danger zone of Settings, because Anthropic's Consumer Terms speak against automated access. It stops by itself
// when Claude asks for a login or a check, or after a few failed readings in a row. It can skip its readings outside
// the active hours and while the PC is idle or locked. One timeout at a time, set again after each turn.
const IDLE_AFTER_S = 5 * 60; // the PC counts as idle after this long without input
const autoRead = { timer: null, fails: 0, since: 0, nextAt: null, paused: null, hot: false, pauseUntil: 0, log: [] };
const AUTO_LOG_KEEP = 12; // the last readings, any kind, for the Refresh menu: when, and whether it worked. Memory only.
const AUTO_PAUSE_MS = 60 * 60 * 1000; // "Pause for 1 hour" in the Refresh menu

function autoReadState() {
  const s = loadSettings();
  const every = autoReadEvery(s);
  const inActive = inActiveHours(new Date(), cleanActiveHours(s.activeHours));
  const delay = autoReadDelay({ every, hot: autoRead.hot, inActive });
  const pauseUntil = autoRead.pauseUntil > Date.now() ? autoRead.pauseUntil : null;
  return { every, minutes: delay ? delay / 60000 : null, since: every ? autoRead.since : null, nextAt: autoRead.nextAt, paused: pauseUntil ? "user" : autoRead.paused, pauseUntil, log: autoRead.log.slice() };
}
function sendAutoReadState() {
  if (win && !win.isDestroyed()) win.webContents.send("auto-read-state", autoReadState());
}

// Sets the next turn from now, or stops the timer when it is off
function applyAutoRead({ restart = true } = {}) {
  clearTimeout(autoRead.timer);
  autoRead.timer = null;
  const s = loadSettings();
  const every = autoReadEvery(s);
  if (!every) {
    autoRead.nextAt = null;
    autoRead.paused = null;
    autoRead.pauseUntil = 0;
    autoRead.fails = 0;
    sendAutoReadState();
    return;
  }
  // Never closer than the one-minute gap after the last reading plus a second, or a 1 minute choice would land just
  // inside the gap and read every other turn
  const delay = Math.max(MIN_GAP + 1000, autoReadDelay({ every, hot: autoRead.hot, inActive: inActiveHours(new Date(), cleanActiveHours(s.activeHours)) }));
  if (restart) autoRead.since = Date.now();
  autoRead.nextAt = Math.max(Date.now(), autoRead.since + delay);
  autoRead.timer = setTimeout(autoReadTurn, autoRead.nextAt - Date.now());
  sendAutoReadState();
}

function autoReadTurn() {
  const s = loadSettings();
  if (autoRead.pauseUntil > Date.now()) return applyAutoRead(); // paused from the Refresh menu: wait it out
  autoRead.pauseUntil = 0;
  const idleState = powerMonitor && powerMonitor.getSystemIdleState ? powerMonitor.getSystemIdleState(IDLE_AFTER_S) : "unknown";
  autoRead.paused = autoReadSkip({
    inActive: inActiveHours(new Date(), cleanActiveHours(s.activeHours)),
    activeOnly: s.autoReadActiveOnly !== false,
    idleState,
    idlePause: s.autoReadIdlePause !== false,
  });
  if (!autoRead.paused) requestSync("timer");
  applyAutoRead();
}

// The window says whether the week or the session is busy (a session running, or the week Tight or Pause), which
// Smart reads more often for. A hotter state can bring the next turn closer; a calmer one waits for the next turn.
on("auto-read-hint", (_e, hot) => {
  const next = Boolean(hot);
  if (next === autoRead.hot) return;
  autoRead.hot = next;
  if (autoReadEvery(loadSettings()) === "smart") applyAutoRead({ restart: false });
});
handle("auto-read-state", () => autoReadState());
// The Refresh menu: pause the timer for an hour, take the pause back, or skip the next reading (the next one comes a
// whole interval from now). Only while the timer is on; nothing here turns it on.
handle("auto-read-action", (_e, action) => {
  if (!autoReadEvery(loadSettings())) return autoReadState();
  if (action === "pause") autoRead.pauseUntil = Date.now() + AUTO_PAUSE_MS;
  else if (action === "resume") autoRead.pauseUntil = 0;
  else if (action !== "skip") return autoReadState();
  applyAutoRead({ restart: action !== "pause" });
  return autoReadState();
});

function noteAutoReadResult(res) {
  if (res && !["too-soon", "already-open", "closed"].includes(res.error)) {
    autoRead.log = [...autoRead.log, { at: Date.now(), ok: Boolean(res.ok) }].slice(-AUTO_LOG_KEEP);
    sendAutoReadState();
  }
  if (!autoReadEvery(loadSettings())) return;
  const verdict = timerVerdict(res && res.ok ? null : (res && res.error) || "fail", autoRead.fails);
  autoRead.fails = verdict.fails;
  if (!verdict.stop) {
    // A reading that ran, by the timer or by hand, starts the wait again: the next one comes a whole interval after it ends
    if (res && !["too-soon", "already-open", "closed"].includes(res.error)) applyAutoRead();
    return;
  }
  const next = { ...loadSettings(), autoReadEvery: 0, autoRead: false };
  saveSettings(next);
  applyAutoRead();
  if (win && !win.isDestroyed()) win.webContents.send("auto-read-stopped", { reason: (res && res.error) || "fail" });
}

// Tray card

const POPUP_W = 340;
let POPUP_H = 330; // set by the card itself to fit its content

function createPopup() {
  popup = new BrowserWindow({
    width: POPUP_W,
    height: POPUP_H,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  lockToApp(popup.webContents);
  popup.loadFile(path.join(__dirname, "renderer", "popup.html"));
  // Closes when you click elsewhere, like Windows menus
  popup.on("blur", hidePopup);
}

function hidePopup() {
  if (popup && !popup.isDestroyed() && popup.isVisible()) {
    popup.hide();
    popupHiddenAt = Date.now();
  }
}

// Places the card just above (or below) the anchor, inside the usable screen area
function placePopup(anchor) {
  const b = tray.getBounds();
  const point = anchor || (b.width ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : screen.getCursorScreenPoint());
  const area = screen.getDisplayNearestPoint(point).workArea;
  const gap = 10;
  let x = Math.round(point.x - POPUP_W / 2);
  x = Math.min(Math.max(x, area.x + gap), area.x + area.width - POPUP_W - gap);
  const onTop = point.y < area.y + area.height / 2;
  let y = onTop ? area.y + gap : area.y + area.height - POPUP_H - gap;
  if (anchor && anchor.rect) {
    // Next to the strip, wherever the user dragged it
    y = onTop ? anchor.rect.y + anchor.rect.height + gap : anchor.rect.y - POPUP_H - gap;
    y = Math.min(Math.max(y, area.y + gap), area.y + area.height - POPUP_H - gap);
  }
  popup.setPosition(x, Math.round(y), false);
}

let popupAnchor; // where the card was opened from, so a resize keeps it in place

function togglePopup(anchor) {
  if (!popup || popup.isDestroyed()) createPopup();
  if (popup.isVisible()) {
    hidePopup();
    return;
  }
  // Clicking the icon blurs the card before we get here: do not reopen it right away
  if (Date.now() - popupHiddenAt < 250) return;
  popupAnchor = anchor && anchor.x !== undefined ? anchor : undefined;
  placePopup(popupAnchor);
  if (lastSummary) popup.webContents.send("summary", lastSummary);
  popup.show();
  popup.focus();
  requestSync("popup");
}

// Taskbar strip

// A small frameless always-on-top window over the empty left side of the taskbar.
// Windows 11 does not let apps dock into the taskbar, so it simply sits on top of it.
let strip = null;
let stripW = 130;
let probe = null;
let fullscreenBusy = false;
const STRIP_H = 30;

// Area the taskbar takes on the primary display (top or bottom taskbars only)
function taskbarRect() {
  const d = screen.getPrimaryDisplay();
  const b = d.bounds;
  const w = d.workArea;
  if (w.x !== b.x || w.width !== b.width || w.height >= b.height) return null; // on a side, or auto-hidden
  if (w.y > b.y) return { x: b.x, y: b.y, width: b.width, height: w.y - b.y };
  return { x: b.x, y: w.y + w.height, width: b.width, height: b.height - w.height };
}

function placeStrip() {
  if (!strip || strip.isDestroyed()) return;
  if (fullscreenBusy) {
    if (strip.isVisible()) strip.hide();
    return;
  }
  const h = STRIP_H;
  let x;
  let y;
  const saved = loadSettings().stripPos;
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    // Keep it on a screen that still exists
    const area = screen.getDisplayNearestPoint({ x: saved.x, y: saved.y }).bounds;
    x = Math.min(Math.max(saved.x, area.x), area.x + area.width - stripW);
    y = Math.min(Math.max(saved.y, area.y), area.y + area.height - h);
  } else {
    const tb = taskbarRect();
    if (tb) {
      x = tb.x + 12;
      y = Math.round(tb.y + (tb.height - Math.min(h, tb.height)) / 2);
    } else {
      const wa = screen.getPrimaryDisplay().workArea;
      x = wa.x + 12;
      y = wa.y + wa.height - h - 12;
    }
  }
  // Lift the size limits first, or growing past the old maximum is refused
  strip.setMinimumSize(1, 1);
  strip.setMaximumSize(10000, 10000);
  strip.setBounds({ x: Math.round(x), y: Math.round(y), width: stripW, height: h });
  strip.setMinimumSize(stripW, h);
  strip.setMaximumSize(stripW, h);
  if (!strip.isVisible()) strip.showInactive();
  strip.setAlwaysOnTop(true, "screen-saver");
  strip.moveTop();
}

// Asks Windows every few seconds whether an app is full screen (game, video, presentation)
function startProbe() {
  if (probe || process.platform !== "win32") return;
  const script =
    "Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class Q { [DllImport(\"shell32.dll\")] public static extern int SHQueryUserNotificationState(out int s); }'; " +
    "while ($true) { $s = 0; [void][Q]::SHQueryUserNotificationState([ref]$s); Write-Output $s; Start-Sleep -Milliseconds 2500 }";
  try {
    probe = spawn(POWERSHELL_EXE, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true });
  } catch {
    probe = null;
    return;
  }
  probe.stdout.on("data", (buf) => {
    const last = String(buf).trim().split(/\s+/).pop();
    fullscreenBusy = last === "2" || last === "3" || last === "4";
    placeStrip();
  });
  probe.on("error", () => {
    probe = null;
  });
  probe.on("exit", () => {
    probe = null;
    // Without the check nobody would ever say the full screen app is gone: show the strip again
    if (fullscreenBusy) {
      fullscreenBusy = false;
      placeStrip();
    }
  });
}

function stopProbe() {
  if (probe) probe.kill();
  probe = null;
  fullscreenBusy = false;
}

function startStrip() {
  if (strip && !strip.isDestroyed()) return;
  strip = new BrowserWindow({
    width: stripW,
    height: STRIP_H,
    show: false,
    frame: false,
    // Resizable (with equal min and max size) is what makes Windows 11 round the corners of a frameless window
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#0A0F0C",
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  lockToApp(strip.webContents);
  strip.loadFile(path.join(__dirname, "renderer", "strip.html"));
  strip.webContents.once("did-finish-load", placeStrip);
  strip.on("closed", () => {
    strip = null;
  });
  startProbe();
  repaintMain();
}

function stopStrip() {
  stopProbe();
  if (strip && !strip.isDestroyed()) strip.destroy();
  strip = null;
  repaintMain();
}

// On some Windows setups the main window stops painting when another window is created or
// destroyed, so ask it to redraw
function repaintMain() {
  if (!win || win.isDestroyed()) return;
  setTimeout(() => {
    if (win && !win.isDestroyed()) win.webContents.invalidate();
  }, 150);
}

on("strip-resize", (_e, width) => {
  const w = Math.min(Math.max(Math.round(Number(width) || 0), 60), 320);
  if (w === stripW) return;
  stripW = w;
  placeStrip();
});

// Dragging: the strip sends the cursor position, we move the window by the same distance
let drag = null;
on("strip-drag", (_e, phase, x, y) => {
  if (!strip || strip.isDestroyed()) return;
  if (phase === "start") {
    const b = strip.getBounds();
    drag = { dx: x - b.x, dy: y - b.y, moved: false };
  } else if (phase === "move" && drag) {
    drag.moved = true;
    strip.setPosition(Math.round(x - drag.dx), Math.round(y - drag.dy), false);
  } else if (phase === "end" && drag) {
    const { moved } = drag;
    drag = null;
    if (!moved) return; // a plain click: the strip keeps following the taskbar
    const b = strip.getBounds();
    saveSettings({ ...loadSettings(), stripPos: { x: b.x, y: b.y } });
    placeStrip();
  }
});

on("strip-action", (_e, action) => {
  if (action === "toggle") {
    const b = strip && !strip.isDestroyed() ? strip.getBounds() : null;
    togglePopup(b ? { x: b.x + b.width / 2, y: b.y + b.height / 2, rect: b } : undefined);
  } else if (action === "refresh") {
    requestSync("strip"); // the refresh button, or a click on the pill
  } else if (action === "open") {
    showWindow();
  } else if (action === "menu" && trayMenu) {
    trayMenu.popup();
  }
});

// Tray

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png"));
  tray = new Tray(icon);
  tray.setToolTip(i18n.t("app.name"));
  tray.on("click", () => togglePopup());
  tray.on("double-click", showWindow);
  buildTrayMenu();
}

function buildTrayMenu() {
  if (!tray) return;
  const t = i18n.t;
  trayMenu = Menu.buildFromTemplate([
      { label: t("menu.refresh"), click: () => requestSync("menu") },
      { label: t("menu.type"), click: showUpdate },
      { label: t("menu.open", { name: t("app.name") }), click: showWindow },
      { label: t("menu.viewUsage"), click: openUsage },
      { type: "separator" },
      {
        label: t("menu.quit"),
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]);
  tray.setContextMenu(trayMenu);
}

// Switches the language of the text the main process controls
function applyLanguage(code) {
  i18n.setLang(code);
  buildTrayMenu();
  if (win && !win.isDestroyed()) win.setTitle(i18n.t("app.name"));
  writeCollectorLanguage();
}

function openUsage() {
  shell.openExternal("https://claude.ai/settings/usage");
}

// Refresh shortcut

let shortcutState = "off"; // "off", "ok", "taken" (another app has it) or "invalid"
let registeredKeys = null;

// Registers or releases the optional global shortcut that refreshes from any app
function applyShortcut(s = loadSettings()) {
  if (registeredKeys) globalShortcut.unregister(registeredKeys);
  registeredKeys = null;
  if (!s.shortcutOn) {
    shortcutState = "off";
    return;
  }
  const keys = normalizeAccelerator(s.shortcutKeys);
  if (!keys) {
    shortcutState = "invalid";
    return;
  }
  let ok = false;
  try {
    ok = globalShortcut.register(keys, () => requestSync("shortcut"));
  } catch {
    ok = false; // Electron throws on a combination it cannot parse
  }
  registeredKeys = ok ? keys : null;
  shortcutState = ok ? "ok" : "taken";
}

handle("shortcut-status", () => ({ state: shortcutState, keys: registeredKeys }));

// The window says when it can take requests. The first one is "open", unless the app started
// hidden in the tray: then the first time the window is shown, gaining focus does the same job.
on("renderer-ready", () => {
  if (rendererIsReady) return;
  rendererIsReady = true;
  if (!startHidden) requestSync("open");
});

// Data

function pushData() {
  if (win && !win.isDestroyed()) win.webContents.send("data", readJson(DATA_FILE));
}

function watchData() {
  // watchFile works even before the file exists
  fs.watchFile(DATA_FILE, { interval: 3000 }, pushData);
}

// Collector

// Asking for the node version starts a process that can take a while (5 s at worst): it runs
// without blocking the main process, so the tray, the card and the window keep answering meanwhile
async function collectorStatus() {
  const settings = readJson(CLAUDE_SETTINGS) || {};
  const command = settings.statusLine && settings.statusLine.command;
  const installed = Boolean(command && command.includes(SLUG));
  let node = null;
  try {
    node = (await execAsync("node --version", { encoding: "utf8", timeout: 5000, windowsHide: true })).stdout.trim() || null;
  } catch {
    node = null;
  }
  const config = readJson(COLLECTOR_CONFIG);
  return {
    installed,
    node,
    otherCommand: !installed && command ? command : null,
    chained: Boolean(config && config.chainCommand),
    dataFile: DATA_FILE,
  };
}

async function installCollector() {
  const status = await collectorStatus();
  if (!status.node) {
    return { ok: false, error: i18n.t("coll.errNoNode") };
  }

  let settings = {};
  if (fs.existsSync(CLAUDE_SETTINGS)) {
    settings = readJson(CLAUDE_SETTINGS);
    if (!settings) {
      return { ok: false, error: i18n.t("coll.errRead") };
    }
    fs.copyFileSync(CLAUDE_SETTINGS, CLAUDE_SETTINGS + BACKUP_SUFFIX);
  }

  // Copies the collector out of the app package (node cannot run files inside asar)
  fs.mkdirSync(COLLECTOR_DIR, { recursive: true });
  fs.writeFileSync(COLLECTOR_TARGET, fs.readFileSync(COLLECTOR_SOURCE, "utf8"));

  const previous = settings.statusLine && settings.statusLine.command;
  const config = readJson(COLLECTOR_CONFIG) || {};
  if (previous && !previous.includes(SLUG)) config.chainCommand = previous;
  config.lang = i18n.getLang();
  config.weights = loadSettings().weights || null;
  config.activeHours = cleanActiveHours(loadSettings().activeHours);
  config.reserve = loadSettings().reserve || 0;
  config.reserveRelease = loadSettings().reserveRelease ?? null;
  writeJson(COLLECTOR_CONFIG, config);

  settings.statusLine = { type: "command", command: `node "${COLLECTOR_TARGET}"` };
  writeJson(CLAUDE_SETTINGS, settings);
  return { ok: true, status: await collectorStatus() };
}

async function uninstallCollector() {
  const settings = readJson(CLAUDE_SETTINGS);
  if (!settings) return { ok: false, error: i18n.t("coll.errMissing") };

  const config = readJson(COLLECTOR_CONFIG);
  if (config && config.chainCommand) {
    settings.statusLine = { type: "command", command: config.chainCommand };
  } else {
    delete settings.statusLine;
  }
  writeJson(CLAUDE_SETTINGS, settings);
  try {
    fs.unlinkSync(COLLECTOR_CONFIG);
  } catch {
    // it did not exist
  }
  return { ok: true, status: await collectorStatus() };
}

// The collector runs outside the app: it needs the language (status line text), the day weights, the active hours
// and the reserve
function writeCollectorLanguage() {
  try {
    const config = readJson(COLLECTOR_CONFIG);
    if (!config) return;
    const s = loadSettings();
    const weights = s.weights || null;
    const activeHours = cleanActiveHours(s.activeHours);
    const same = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
    const reserve = s.reserve || 0;
    const reserveRelease = s.reserveRelease ?? null;
    if (config.lang !== i18n.getLang() || !same(config.weights, weights) || !same(config.activeHours, activeHours) || !same(config.reserve, reserve) || !same(config.reserveRelease, reserveRelease)) {
      writeJson(COLLECTOR_CONFIG, { ...config, lang: i18n.getLang(), weights, activeHours, reserve, reserveRelease });
    }
  } catch {
    // not essential
  }
}

// IPC

handle("get-data", () => readJson(DATA_FILE));

// Asked once by the window at start, so it can say the settings file was damaged
handle("settings-recovery", () => settingsRecovery);

// Hours with Claude Code activity since a given time, from the local logs. Off with the setting.
const activityCache = new Map();
handle("activity-hours", async (_e, sinceMs) => {
  if (loadSettings().codeLogs === false || !isNum(sinceMs)) return { enabled: false, hours: [] };
  try {
    const hours = await readActivity({ dir: path.join(CLAUDE_DIR, "projects"), sinceMs, cache: activityCache });
    return { enabled: true, hours: [...hours.entries()] };
  } catch {
    return { enabled: true, hours: [] };
  }
});
handle("app-info", () => ({ version: app.getVersion(), electron: process.versions.electron }));

// Export and import

const BACKUP_KEYS = [
  "manual", "readings", "sessions", "weights", "activeHours", "extra",
  "language", "theme", "screens", "motion", "notifyAll", "notifyLevel", "notifyResets", "notifySpikes", "notifyExtra", "fiveHourThreshold", "remindEvery",
  "showExtra", "miniWindow", "codeLogs", "shortcutOn", "shortcutKeys", "reserve", "reserveRelease", "pastWeeks", "autoWeights",
];
// Active hours (Settings > Plan): whole hours 0-23, start and end different, or null for the whole day.
// Same rule as activeHours() in renderer/js/core.js.
function cleanActiveHours(a) {
  const isHour = (h) => Number.isInteger(h) && h >= 0 && h <= 23;
  return a && isHour(a.start) && isHour(a.end) && a.start !== a.end ? { start: a.start, end: a.end } : null;
}
const BOOLEAN_KEYS = ["notifyAll", "notifyLevel", "notifyResets", "notifySpikes", "notifyExtra", "showExtra", "miniWindow", "codeLogs", "shortcutOn", "pastWeeks", "autoWeights"];
const THRESHOLDS = [60, 70, 75, 80, 85]; // the choices in Settings
const REMIND_HOURS = [0, 2, 4, 8];
const RESERVE_CHOICES = [0, 5, 10, 15, 20]; // the choices in Settings, Reserve
const RELEASE_HOURS = [0, 24, 48, 72];
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isPct = (v) => isNum(v) && v >= 0 && v <= 100;
// A moment in time that can be real: after 2020 and before 2100. A reset time far from any real date (from a file
// edited by hand, or a damaged one) would have the week's math walk day by day toward it.
const isTime = (v) => isNum(v) && v > 1577836800000 && v < 4102444800000;
const IMPORT_MAX_BYTES = 20 * 1024 * 1024; // a backup is well under 1 MB
const numOrNull = (v) => (isNum(v) ? v : null);

// The data typed in or read from Claude, rebuilt field by field from a backup. A broken day is
// dropped; a broken week leaves only the reset time, if there is one (as after setting it in Settings).
function cleanManual(m) {
  if (!isPlainObject(m)) return null;
  // Where the reset time came from (Settings hides its own form when the account gave it)
  const via = ["sync", "manual"].includes(m.anchorVia) ? { anchorVia: m.anchorVia } : {};
  if (!isPlainObject(m.weekly) || !isPct(m.weekly.used) || !isTime(m.weekly.resetsAt)) return isTime(m.anchor) ? { anchor: m.anchor, ...via } : null;
  const out = {
    anchor: isTime(m.anchor) ? m.anchor : m.weekly.resetsAt,
    ...via,
    updatedAt: isTime(m.updatedAt) ? m.updatedAt : 0,
    via: m.via === "sync" ? "sync" : "manual",
    weekly: { used: m.weekly.used, resetsAt: m.weekly.resetsAt },
    fiveHour: null,
    dayStart: null,
    days: {},
  };
  const f = m.fiveHour;
  if (isPlainObject(f) && isPct(f.used)) out.fiveHour = { used: f.used, resetsAt: isTime(f.resetsAt) ? f.resetsAt : null, at: isTime(f.at) ? f.at : out.updatedAt };
  const ds = m.dayStart;
  if (isPlainObject(ds) && /^\d{4}-\d{2}-\d{2}$/.test(ds.day) && isTime(ds.at) && isPct(ds.used)) out.dayStart = { day: ds.day, at: ds.at, used: ds.used };
  if (isPlainObject(m.days)) {
    for (const [k, v] of Object.entries(m.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !isPlainObject(v) || !isNum(v.spent)) continue;
      out.days[k] = { spent: v.spent, budget: numOrNull(v.budget), ...(isNum(v.endUsed) ? { endUsed: v.endUsed } : {}) };
    }
  }
  return out;
}

// Extra usage as last read from the page: money amounts, never anything else
function cleanExtra(e) {
  if (!isPlainObject(e)) return null;
  const str = (v) => (typeof v === "string" && v.length <= 8 ? v : null);
  return {
    currency: str(e.currency),
    symbol: str(e.symbol),
    balance: numOrNull(e.balance),
    spent: numOrNull(e.spent),
    limit: numOrNull(e.limit),
    autoReload: typeof e.autoReload === "boolean" ? e.autoReload : null,
    at: isNum(e.at) ? e.at : 0,
  };
}

// Only what has the expected shape gets in. Pure, so it is tested on its own.
function cleanBackupSettings(st) {
  const next = {};
  if (!isPlainObject(st)) return next;
  if (Array.isArray(st.readings)) {
    next.readings = st.readings
      .filter((r) => r && isTime(r.at) && isPct(r.w))
      .map((r) => ({ at: r.at, w: r.w, s: isPct(r.s) ? r.s : null, sr: isTime(r.sr) ? r.sr : null, ...(isTime(r.to) && r.to > r.at ? { to: r.to } : {}) }))
      .slice(-1500);
  }
  if (Array.isArray(st.sessions)) {
    next.sessions = st.sessions.filter((x) => x && isTime(x.sr) && isPct(x.peak)).map((x) => ({ sr: x.sr, peak: x.peak })).slice(-400);
  }
  if (st.manual === null) next.manual = null;
  else if (st.manual !== undefined) {
    const manual = cleanManual(st.manual);
    if (manual) next.manual = manual;
  }
  if (st.extra === null) next.extra = null;
  else if (st.extra !== undefined) {
    const extra = cleanExtra(st.extra);
    if (extra) next.extra = extra;
  }
  if (Array.isArray(st.weights) && st.weights.length === 7 && st.weights.every((w) => [0, 0.5, 1, 2].includes(w))) next.weights = st.weights;
  if (st.activeHours === null || cleanActiveHours(st.activeHours)) next.activeHours = cleanActiveHours(st.activeHours);
  if (typeof st.language === "string") next.language = i18n.normalize(st.language);
  if (THEMES.includes(st.theme)) next.theme = st.theme;
  if (SCREENS.includes(st.screens)) next.screens = st.screens;
  if (MOTIONS.includes(st.motion)) next.motion = st.motion;
  for (const k of BOOLEAN_KEYS) if (typeof st[k] === "boolean") next[k] = st[k];
  if (THRESHOLDS.includes(st.fiveHourThreshold)) next.fiveHourThreshold = st.fiveHourThreshold;
  if (st.remindEvery === "smart" || REMIND_HOURS.includes(st.remindEvery)) next.remindEvery = st.remindEvery;
  if (RESERVE_CHOICES.includes(st.reserve)) next.reserve = st.reserve;
  if (RELEASE_HOURS.includes(st.reserveRelease)) next.reserveRelease = st.reserveRelease;
  if (typeof st.shortcutKeys === "string" && normalizeAccelerator(st.shortcutKeys)) next.shortcutKeys = normalizeAccelerator(st.shortcutKeys);
  return next;
}

// Copies of the settings file in the app data folder (backups/): one per day, kept for a week,
// and one before every import or "delete my data", the last ten of each kept.
const BACKUP_DIR = path.join(path.dirname(SETTINGS_FILE), "backups");
const DAILY_KEEP = 7;
const BEFORE_KEEP = 10;

function pruneBackups(prefix, keep) {
  const names = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort();
  for (const f of names.slice(0, Math.max(names.length - keep, 0))) fs.unlinkSync(path.join(BACKUP_DIR, f));
}

// reason: "daily" (once a day, on the first save) or what is about to happen ("import", "clear")
function snapshotSettings(reason) {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (reason === "daily") {
      const target = path.join(BACKUP_DIR, `daily-${day}.json`);
      if (fs.existsSync(target)) return;
      fs.copyFileSync(SETTINGS_FILE, target);
      pruneBackups("daily-", DAILY_KEEP);
    } else {
      const stamp = d.toISOString().replace(/[:.]/g, "-");
      fs.copyFileSync(SETTINGS_FILE, path.join(BACKUP_DIR, `before-${reason}-${stamp}.json`));
      pruneBackups(`before-${reason}-`, BEFORE_KEEP);
    }
  } catch {
    // a missing backup must never stop the app from saving
  }
}

// Days from the app (typed or read from Claude) merged with Claude Code's; the larger spend of each day wins
function allDays(s) {
  const out = {};
  const claudeCode = readJson(DATA_FILE);
  for (const src of [(s.manual && s.manual.days) || {}, (claudeCode && claudeCode.days) || {}]) {
    for (const [k, v] of Object.entries(src)) if (isPlainObject(v) && (!out[k] || v.spent > out[k].spent)) out[k] = v;
  }
  return out;
}

handle("export-data", async (_e, format) => {
  const s = loadSettings();
  const stamp = new Date().toISOString().slice(0, 10);
  const asCsv = format === "csv";
  const pick = await dialog.showSaveDialog(win, {
    title: i18n.t("data.dialogSave"),
    defaultPath: `claude-quota-control-${stamp}.${asCsv ? "csv" : "json"}`,
    filters: asCsv ? [{ name: "CSV", extensions: ["csv"] }] : [{ name: "JSON", extensions: ["json"] }],
  });
  if (pick.canceled || !pick.filePath) return { canceled: true };
  try {
    if (asCsv) {
      const days = allDays(s);
      // Only dates and numbers are written: a spreadsheet would run anything else that looks like a formula
      const cell = (v) => (isNum(v) ? v : "");
      const rows = Object.keys(days).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().map((k) => `${k},${cell(days[k] && days[k].spent)},${cell(days[k] && days[k].budget)}`);
      fs.writeFileSync(pick.filePath, ["date,spent_pct_of_week,budget_pct_of_week", ...rows].join("\n") + "\n");
    } else {
      const settings = {};
      for (const k of BACKUP_KEYS) if (s[k] !== undefined) settings[k] = s[k];
      const body = { app: "claude-quota-control", format: 1, appVersion: app.getVersion(), exportedAt: new Date().toISOString(), settings };
      fs.writeFileSync(pick.filePath, JSON.stringify(body, null, 2));
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

handle("import-data", async () => {
  const pick = await dialog.showOpenDialog(win, {
    title: i18n.t("data.dialogOpen"),
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (pick.canceled || !pick.filePaths[0]) return { canceled: true };
  // A file far too large to be a backup is not read at all (reading it would freeze the app)
  let size = Infinity;
  try {
    size = fs.statSync(pick.filePaths[0]).size;
  } catch {
    // unreadable: refused below
  }
  if (size > IMPORT_MAX_BYTES) return { ok: false };
  const body = readJson(pick.filePaths[0]);
  const st = body && body.app === "claude-quota-control" && body.format === 1 ? body.settings : null;
  const next = cleanBackupSettings(st);
  if (!Object.keys(next).length) return { ok: false };

  const sure = await dialog.showMessageBox(win, {
    type: "question",
    message: i18n.t("data.importConfirm"),
    buttons: [i18n.t("data.importYes"), i18n.t("data.importNo")],
    defaultId: 1,
    cancelId: 1,
  });
  if (sure.response !== 0) return { canceled: true };

  snapshotSettings("import");
  applySettings({ ...next, sessionsV1: true }); // language, theme, strip and shortcut take effect at once
  return { ok: true, readings: (next.readings || []).length };
});

// "Delete my data" in Settings: a copy is kept first
handle("clear-data", () => {
  snapshotSettings("clear");
  return applySettings({ manual: null, readings: [], sessions: [], lastLevel: null });
});

handle("get-settings", () => {
  const s = loadSettings();
  return { ...s, openAtLogin: app.getLoginItemSettings().openAtLogin };
});

handle("set-settings", (_e, patch) => applySettings(isPlainObject(patch) ? patch : {}));

// Saves a change to the settings and applies what the main process controls (login item, strip,
// language, theme, shortcut, timer, collector config). Used by the window and by an import.
function applySettings(patch) {
  const before = loadSettings();
  const next = { ...before, ...patch };
  // Only the installed app registers itself: from the source folder Windows would start a bare Electron
  if ("openAtLogin" in patch && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: Boolean(patch.openAtLogin), args: ["--hidden"] });
  }
  if ("miniWindow" in patch) {
    if (patch.miniWindow) startStrip();
    else stopStrip();
  }
  if ("language" in patch) {
    next.language = i18n.normalize(patch.language);
    applyLanguage(next.language);
  }
  if ("theme" in patch) {
    next.theme = THEMES.includes(patch.theme) ? patch.theme : "dark";
    nativeTheme.themeSource = next.theme;
  }
  if ("screens" in patch) next.screens = SCREENS.includes(patch.screens) ? patch.screens : "paper";
  if ("motion" in patch) next.motion = MOTIONS.includes(patch.motion) ? patch.motion : "full";
  if ("activeHours" in patch) next.activeHours = cleanActiveHours(patch.activeHours);
  if ("shortcutOn" in patch || "shortcutKeys" in patch) {
    // Only a combination that passes the check is kept, so the settings file never holds a bad one
    const keys = normalizeAccelerator(next.shortcutKeys);
    next.shortcutKeys = keys || before.shortcutKeys;
    next.shortcutOn = Boolean(next.shortcutOn);
    applyShortcut(next);
    if (!keys) shortcutState = "invalid";
  }
  if ("autoReadEvery" in patch) {
    next.autoReadEvery = AUTO_READ_CHOICES.includes(patch.autoReadEvery) ? patch.autoReadEvery : 0;
    next.autoRead = false; // the old switch: from here on the choice above says it all
  }
  for (const key of ["autoReadActiveOnly", "autoReadIdlePause"]) if (key in patch) next[key] = Boolean(patch[key]);
  saveSettings(next);
  if ("autoReadEvery" in patch) autoRead.fails = 0;
  if (["autoRead", "autoReadEvery", "autoReadActiveOnly", "autoReadIdlePause", "activeHours"].some((k) => k in patch)) applyAutoRead({ restart: "autoReadEvery" in patch });
  if ("weights" in patch || "activeHours" in patch || "reserve" in patch || "reserveRelease" in patch) writeCollectorLanguage();
  return next;
}

handle("collector-status", () => collectorStatus());
handle("install-collector", async () => {
  try {
    return await installCollector();
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});
handle("uninstall-collector", async () => {
  try {
    return await uninstallCollector();
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// The renderer sends the icon in several sizes; Windows picks the right one for the display scale
on("set-tray", (_e, { images, dataUrl, tooltip } = {}) => {
  if (!tray) return;
  let img = null;
  if (Array.isArray(images) && images.length) {
    img = nativeImage.createEmpty();
    for (const rep of images) if (rep && isNum(rep.scale) && typeof rep.dataUrl === "string" && rep.dataUrl.startsWith("data:image/")) img.addRepresentation({ scaleFactor: rep.scale, dataURL: rep.dataUrl });
  } else if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
    img = nativeImage.createFromDataURL(dataUrl);
  }
  if (img && !img.isEmpty()) tray.setImage(img);
  if (typeof tooltip === "string" && tooltip) tray.setToolTip(tooltip.slice(0, 127)); // Windows shows at most 127 characters
});

// Summary computed by the main window, passed on to the tray card and the strip
on("summary", (_e, summary) => {
  lastSummary = summary;
  if (popup && !popup.isDestroyed()) popup.webContents.send("summary", summary);
  if (strip && !strip.isDestroyed()) strip.webContents.send("summary", summary);
});
handle("get-summary", () => lastSummary);

on("popup-resize", (_e, height) => {
  const h = Math.min(Math.max(Math.round(Number(height) || 0), 160), 680); // the tallest card (a stale reading and a failed refresh at once, in Portuguese) is about 640
  if (!popup || popup.isDestroyed() || h === POPUP_H) return;
  POPUP_H = h;
  popup.setSize(POPUP_W, POPUP_H, false);
  if (popup.isVisible()) placePopup(popupAnchor);
});

on("popup-action", (_e, action) => {
  if (action === "sync") requestSync("popup-button");
  else if (action === "type") showUpdate();
  else if (action === "open") showWindow();
  else if (action === "close") hidePopup();
});

// Every notice has a key; the same notice never repeats
on("open-usage", openUsage);

// Claude account

handle("claude-login", async () => {
  const res = await claude.login(win);
  if (res.ok) saveSettings({ ...loadSettings(), claudeConnected: true });
  noteAutoReadResult(res);
  return res;
});

handle("claude-logout", async () => {
  await claude.logout();
  saveSettings({ ...loadSettings(), claudeConnected: false });
  return { ok: true };
});

handle("claude-sync", async (_e, opts = {}) => {
  refreshPolicy.markAttempt(); // the button in the window comes here directly, so it counts too
  let res;
  try {
    res = await claude.sync({ visible: Boolean(opts && opts.visible), parent: win });
  } catch {
    res = { ok: false, error: "fail" }; // the window always gets an answer
  }
  if (res.error === "need-login") saveSettings({ ...loadSettings(), claudeConnected: false });
  if (res.ok) saveSettings({ ...loadSettings(), claudeConnected: true });
  noteAutoReadResult(res);
  return res;
});

// A notification that nothing refers to can be garbage collected while it is still on screen, and then
// a click on it does nothing. The last few are kept here so their click handlers stay alive.
const NOTES_KEPT = 20;
const liveNotes = [];

function showNotification(title, body, onClick) {
  const n = new Notification({ title, body, icon: path.join(__dirname, "assets", "icon.png") });
  n.on("click", onClick);
  liveNotes.push(n);
  if (liveNotes.length > NOTES_KEPT) liveNotes.shift();
  n.show();
}

// Plain notice with no repeat control (the result of a user action)
on("toast", (_e, { title, body } = {}) => {
  if (!Notification.isSupported() || loadSettings().notifyAll === false) return;
  if (win && win.isVisible() && win.isFocused()) return; // the window itself already shows the result
  showNotification(String(title || ""), String(body || ""), showWindow);
});

on("notify", (_e, { key, title, body, focusUpdate, syncOnClick } = {}) => {
  if (typeof key !== "string" || !key || key.length > 120) return;
  const s = loadSettings();
  const notified = { ...(s.notified || {}) }; // a copy: the defaults object must never be changed
  if (notified[key]) return;
  notified[key] = Date.now();
  // Drop keys older than 10 days
  const limit = Date.now() - 10 * 24 * 3600 * 1000;
  for (const k of Object.keys(notified)) if (notified[k] < limit) delete notified[k];
  saveSettings({ ...s, notified });
  // The master switch is off: remember the alert as seen so it does not pop up later
  if (!Notification.isSupported() || s.notifyAll === false) return;
  showNotification(String(title || ""), String(body || ""), () => {
    if (syncOnClick) {
      showWindow();
      requestSync("notification");
    } else if (focusUpdate) showUpdate();
    else showWindow();
  });
});

// Lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.setAppUserModelId("com.kodus.claudequotacontrol");

  // No page the app shows may embed another one in a <webview>, whatever window it is in
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (e) => e.preventDefault());
  });

  app.whenReady().then(() => {
    i18n.setLang(loadSettings().language);
    refreshLoginItem();
    createWindow();
    createTray();
    createPopup();
    watchData();
    applyShortcut();
    applyAutoRead();
    if (loadSettings().miniWindow) startStrip();
    setupUpdates({
      handle,
      loadSettings,
      saveSettings,
      send: (channel, value) => win && !win.isDestroyed() && win.webContents.send(channel, value),
      notify: (title, body) => Notification.isSupported() && showNotification(title, body, showWindow),
    });
    for (const ev of ["display-metrics-changed", "display-added", "display-removed"]) screen.on(ev, placeStrip);
  });

  app.on("before-quit", () => {
    quitting = true;
    stopProbe();
    clearTimeout(autoRead.timer);
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());

  // With the window hidden the app stays in the tray
  app.on("window-all-closed", (e) => e.preventDefault());
}
