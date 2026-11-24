// Loads the real main.js against a fake "electron" module and drives it the way Electron would:
// focus, keys, the tray, IPC messages. It checks the wiring of the refresh triggers and the global
// shortcut, which the pure tests of refresh-policy.js cannot see.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const EventEmitter = require("node:events");
const i18n = require("../renderer/i18n.js");

const MAIN = require.resolve("../main.js");
// main.js reads and writes the Claude Code folder: give it a temporary one, never the real one
const CLAUDE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cqc-claude-"));
process.env.CQC_CLAUDE_DIR = CLAUDE_DIR;
test.after(() => fs.rmSync(CLAUDE_DIR, { recursive: true, force: true }));
const DATA_FILE = path.join(CLAUDE_DIR, "claude-quota-control.json");
const T0 = 1_800_000_000_000;
const MIN = 60 * 1000;

// Any method the app calls that this file does not care about does nothing
const quiet = (obj) => new Proxy(obj, { get: (t, p) => (p in t || typeof p === "symbol" || p === "then" ? t[p] : () => {}) });

class FakeWindow extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts;
    this.shown = false;
    this.bounds = { x: 0, y: 0, width: 130, height: 30 }; // set here: the quiet proxy turns missing fields into functions
    this.webContents = quiet(new EventEmitter());
    this.webContents.sent = [];
    this.webContents.send = (channel, payload) => this.webContents.sent.push([channel, payload]);
    this.webContents.setWindowOpenHandler = (fn) => { this.webContents.openHandler = fn; };
  }
  isVisible() { return this.shown; }
  show() { this.shown = true; }
  showInactive() { this.shown = true; }
  hide() { this.shown = false; }
  isDestroyed() { return false; }
  getBounds() { return { ...this.bounds }; }
  setBounds(b) { this.bounds = { ...b }; }
  setPosition(x, y) { this.bounds = { ...this.getBounds(), x, y }; }
}

// files: raw contents for the app data folder ({ "settings.json": "..." }), in place of `settings`
// dialog: stand-ins for the save, open and question dialogs (export and import)
// notifications: true to have notifications supported (they are recorded in `notes`)
async function loadMain(t, { settings = {}, files = null, shortcutAvailable = true, dialog = {}, notifications = false } = {}) {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cqc-main-"));
  if (files) for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(userData, name), body);
  else fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify(settings));

  const ipc = { handle: {}, on: {} };
  const appEvents = {};
  const windows = [];
  const trays = [];
  const shortcuts = new Map();
  const opened = []; // URLs handed to the browser
  const loginItems = []; // calls to app.setLoginItemSettings
  const notes = []; // notifications shown
  const spawned = []; // stand-ins for the strip's full screen check
  let lastMenu = [];
  const area = { x: 0, y: 0, width: 1920, height: 1040 };

  const electron = {
    app: {
      whenReady: () => Promise.resolve(),
      getPath: () => userData,
      requestSingleInstanceLock: () => true,
      on: (ev, cb) => { appEvents[ev] = cb; },
      setAppUserModelId() {},
      isPackaged: false,
      getVersion: () => "0.0.0",
      quit() {},
      getLoginItemSettings: () => ({ openAtLogin: false }),
      setLoginItemSettings: (opts) => loginItems.push(opts),
    },
    BrowserWindow: function (opts) {
      const w = quiet(new FakeWindow(opts));
      windows.push(w);
      return w;
    },
    Tray: function () {
      const tray = quiet(Object.assign(new EventEmitter(), { getBounds: () => ({ x: 0, y: 0, width: 0, height: 0 }) }));
      trays.push(tray);
      return tray;
    },
    Menu: { buildFromTemplate: (tpl) => { lastMenu = tpl; return { popup() {} }; } },
    nativeImage: { createFromPath: () => ({}), createEmpty: () => ({ addRepresentation() {}, isEmpty: () => true }), createFromDataURL: () => ({ isEmpty: () => true }) },
    nativeTheme: Object.assign(new EventEmitter(), { themeSource: "system", shouldUseDarkColors: false }),
    // The tests call the handlers directly: a call that names no sender comes from the main window, as in the app
    ipcMain: {
      handle: (ch, fn) => { ipc.handle[ch] = (e, ...args) => fn(fromMainWindow(e), ...args); },
      on: (ch, fn) => { ipc.on[ch] = (e, ...args) => fn(fromMainWindow(e), ...args); },
    },
    Notification: notifications
      ? class extends EventEmitter {
          static isSupported() { return true; }
          constructor(opts) { super(); this.opts = opts; }
          show() { notes.push(this); }
        }
      : class { static isSupported() { return false; } },
    shell: { openExternal: (url) => opened.push(url) },
    screen: Object.assign(new EventEmitter(), {
      getCursorScreenPoint: () => ({ x: 100, y: 100 }),
      getDisplayNearestPoint: () => ({ workArea: area, bounds: area }),
      getPrimaryDisplay: () => ({ workArea: area, bounds: area }),
    }),
    net: { isOnline: () => true, fetch: async () => ({ ok: false }) },
    dialog,
    session: { fromPartition: () => ({}) },
    globalShortcut: {
      register: (keys, cb) => { if (!shortcutAvailable) return false; shortcuts.set(keys, cb); return true; },
      unregister: (keys) => { shortcuts.delete(keys); },
      unregisterAll: () => { shortcuts.clear(); },
    },
  };
  const fromMainWindow = (e) => (e && e.sender ? e : { ...(e || {}), sender: windows[0] && windows[0].webContents });
  const fakeSync = { sync: async () => ({ ok: false, error: "closed" }), login: async () => ({ ok: false }), logout: async () => ({}), USAGE_URL: "" };

  const fakeChildProcess = {
    ...require("node:child_process"),
    spawn: () => {
      const p = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill() {} });
      spawned.push(p);
      return p;
    },
  };

  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "electron") return electron;
    if (request === "./claude-sync") return fakeSync;
    if (request === "child_process") return fakeChildProcess; // the strip's full screen check must not start a real PowerShell
    return original.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[MAIN];
    require(MAIN);
  } finally {
    Module._load = original;
  }
  await new Promise((resolve) => setImmediate(resolve)); // lets app.whenReady().then(...) run

  t.after(() => {
    if (appEvents["before-quit"]) appEvents["before-quit"]();
    fs.unwatchFile(DATA_FILE);
    fs.rmSync(userData, { recursive: true, force: true });
  });

  const win = windows[0];
  return {
    win, popup: windows[1], windows, opened, loginItems, notes, spawned, tray: trays[0], ipc, appEvents, shortcuts, userData,
    menu: () => lastMenu,
    requests: () => win.webContents.sent.filter(([ch]) => ch === "sync-request").map(([, payload]) => payload),
    key: (input) => {
      let prevented = false;
      win.webContents.emit("before-input-event", { preventDefault: () => { prevented = true; } }, { type: "keyDown", isAutoRepeat: false, ...input });
      return prevented;
    },
  };
}

const CONNECTED = { claudeConnected: true };

test("nothing is asked of the window before it says it is ready", async (t) => {
  const app = await loadMain(t, { settings: CONNECTED });
  app.win.emit("focus");
  assert.deepEqual(app.requests(), []);
  app.ipc.on["renderer-ready"]();
  assert.deepEqual(app.requests(), [{ auto: true }], "opening the app reads once, quietly");
  app.ipc.on["renderer-ready"]();
  assert.equal(app.requests().length, 1, "and only once");
});

test("coming back to the window refreshes only after 5 minutes", async (t) => {
  const app = await loadMain(t, { settings: CONNECTED });
  app.ipc.on["renderer-ready"]();
  t.mock.timers.tick(4 * MIN);
  app.win.emit("focus");
  assert.equal(app.requests().length, 1);
  t.mock.timers.tick(MIN);
  app.win.emit("focus");
  assert.deepEqual(app.requests(), [{ auto: true }, { auto: true }]);
});

test("without a connected account only what the user does is passed on", async (t) => {
  const app = await loadMain(t);
  app.ipc.on["renderer-ready"]();
  app.win.emit("focus");
  assert.deepEqual(app.requests(), [], "no automatic reading");
  assert.equal(app.key({ key: "F5" }), true);
  assert.deepEqual(app.requests(), [{ auto: false }], "F5 still goes through so the window can say to connect");
});

test("F5 and Ctrl+Shift+R refresh, and nothing else does", async (t) => {
  const app = await loadMain(t, { settings: CONNECTED });
  app.ipc.on["renderer-ready"]();
  const before = app.requests().length;
  assert.equal(app.key({ key: "F5" }), true);
  assert.equal(app.key({ key: "R", control: true, shift: true }), true);
  assert.equal(app.requests().length, before + 2);
  assert.deepEqual(app.requests().slice(-2), [{ auto: false }, { auto: false }]);
  assert.equal(app.key({ key: "F5", isAutoRepeat: true }), false, "a held key is ignored");
  assert.equal(app.key({ key: "F5", type: "keyUp" }), false);
  assert.equal(app.key({ key: "r" }), false);
  assert.equal(app.key({ key: "r", control: true }), false);
  assert.equal(app.requests().length, before + 2);
});

test("the tray menu Refresh item is a manual refresh", async (t) => {
  const app = await loadMain(t, { settings: CONNECTED });
  app.ipc.on["renderer-ready"]();
  const item = app.menu().find((m) => m.label === i18n.t("menu.refresh"));
  assert.ok(item, "the menu has a Refresh item");
  item.click(); // Electron calls it with a menu item; the app must not take that for a reason
  assert.deepEqual(app.requests().at(-1), { auto: false });
});

test("opening the tray card reads quietly, at most once a minute", async (t) => {
  const app = await loadMain(t, { settings: CONNECTED });
  app.ipc.on["renderer-ready"]();
  app.tray.emit("click"); // opens the card
  assert.equal(app.popup.shown, true);
  assert.equal(app.requests().length, 1, "just opened the app, so the card does not read again");
  app.popup.hide();
  t.mock.timers.tick(MIN + 300);
  app.tray.emit("click");
  assert.deepEqual(app.requests().at(-1), { auto: true });
  assert.equal(app.requests().length, 2);
});

test("a click on the strip and a click in the card are manual refreshes", async (t) => {
  const app = await loadMain(t, { settings: CONNECTED });
  app.ipc.on["renderer-ready"]();
  app.ipc.on["strip-action"]({}, "refresh");
  app.ipc.on["popup-action"]({}, "sync");
  assert.deepEqual(app.requests().slice(-2), [{ auto: false }, { auto: false }]);
});

test("a reading started from the window counts for the 5 minute rule", async (t) => {
  const app = await loadMain(t, { settings: CONNECTED });
  app.ipc.on["renderer-ready"]();
  t.mock.timers.tick(6 * MIN);
  await app.ipc.handle["claude-sync"]({}, {}); // the Refresh button in the window goes straight here
  t.mock.timers.tick(4 * MIN);
  app.win.emit("focus");
  assert.equal(app.requests().length, 1, "4 minutes after that reading, focus does not read");
  t.mock.timers.tick(MIN);
  app.win.emit("focus");
  assert.equal(app.requests().length, 2);
});

test("the global shortcut registers, changes, refuses bad keys and turns off", async (t) => {
  const app = await loadMain(t, { settings: CONNECTED });
  app.ipc.on["renderer-ready"]();
  assert.deepEqual([...app.shortcuts.keys()], [], "off by default");
  assert.deepEqual(await app.ipc.handle["shortcut-status"](), { state: "off", keys: null });

  let s = await app.ipc.handle["set-settings"]({}, { shortcutOn: true });
  assert.equal(s.shortcutKeys, "Ctrl+Alt+R");
  assert.deepEqual([...app.shortcuts.keys()], ["Ctrl+Alt+R"]);
  assert.deepEqual(await app.ipc.handle["shortcut-status"](), { state: "ok", keys: "Ctrl+Alt+R" });
  const before = app.requests().length;
  app.shortcuts.get("Ctrl+Alt+R")();
  assert.deepEqual(app.requests().slice(before), [{ auto: false }], "the shortcut is a manual refresh");

  s = await app.ipc.handle["set-settings"]({}, { shortcutKeys: "alt+f9" });
  assert.equal(s.shortcutKeys, "Alt+F9");
  assert.deepEqual([...app.shortcuts.keys()], ["Alt+F9"], "the old one is released");

  s = await app.ipc.handle["set-settings"]({}, { shortcutKeys: "R" });
  assert.equal(s.shortcutKeys, "Alt+F9", "a bad combination is not saved");
  assert.equal((await app.ipc.handle["shortcut-status"]()).state, "invalid");
  assert.deepEqual([...app.shortcuts.keys()], ["Alt+F9"], "and the working one stays");

  s = await app.ipc.handle["set-settings"]({}, { shortcutOn: false });
  assert.deepEqual([...app.shortcuts.keys()], []);
  assert.deepEqual(await app.ipc.handle["shortcut-status"](), { state: "off", keys: null });
});

test("automatic reading: the choice is checked, saved and timed, and an old switch still works", async (t) => {
  const app = await loadMain(t, { settings: CONNECTED });
  assert.deepEqual(await app.ipc.handle["auto-read-state"](), { every: 0, minutes: null, since: null, nextAt: null, paused: null, pauseUntil: null, log: [] }, "off by default");
  assert.equal((await app.ipc.handle["auto-read-action"]({}, "pause")).pauseUntil, null, "the menu cannot pause a timer that is off");

  let s = await app.ipc.handle["set-settings"]({}, { autoReadEvery: 10 });
  assert.equal(s.autoReadEvery, 10);
  let st = await app.ipc.handle["auto-read-state"]();
  assert.equal(st.every, 10);
  assert.equal(st.nextAt, Date.now() + 10 * MIN);
  const sent = app.win.webContents.sent.filter(([ch]) => ch === "auto-read-state");
  assert.equal(sent.at(-1)[1].nextAt, st.nextAt, "the window hears about the next reading");

  st = await app.ipc.handle["auto-read-action"]({}, "pause");
  assert.equal(st.paused, "user");
  assert.equal(st.pauseUntil, Date.now() + 60 * MIN);
  st = await app.ipc.handle["auto-read-action"]({}, "resume");
  assert.equal(st.paused, null);
  assert.equal(st.pauseUntil, null);

  await app.ipc.handle["claude-sync"]({}, {});
  assert.deepEqual((await app.ipc.handle["auto-read-state"]()).log, [], "a reading that could not start is not logged");

  s = await app.ipc.handle["set-settings"]({}, { autoReadEvery: 2 });
  assert.equal(s.autoReadEvery, 0, "a value that is not a choice turns it off");
  assert.equal((await app.ipc.handle["auto-read-state"]()).nextAt, null);

  s = await app.ipc.handle["set-settings"]({}, { autoReadEvery: "smart", autoReadActiveOnly: 0 });
  assert.equal(s.autoReadActiveOnly, false);
  st = await app.ipc.handle["auto-read-state"]();
  assert.equal(st.minutes, 15, "smart and calm");
  app.ipc.on["auto-read-hint"]({}, true);
  assert.equal((await app.ipc.handle["auto-read-state"]()).minutes, 5, "smart and busy");
});

test("automatic reading: a settings file from before the choice keeps its 5 minute timer", async (t) => {
  const app = await loadMain(t, { settings: { ...CONNECTED, autoRead: true } });
  const st = await app.ipc.handle["auto-read-state"]();
  assert.equal(st.every, 5);
  assert.equal(st.nextAt, Date.now() + 5 * MIN);
});

test("a combination another app already owns is reported, not hidden", async (t) => {
  const app = await loadMain(t, { shortcutAvailable: false });
  await app.ipc.handle["set-settings"]({}, { shortcutOn: true });
  assert.deepEqual(await app.ipc.handle["shortcut-status"](), { state: "taken", keys: null });
});

test("a saved shortcut is registered at start and released on quit", async (t) => {
  const app = await loadMain(t, { settings: { shortcutOn: true, shortcutKeys: "Ctrl+Alt+Y" } });
  assert.deepEqual([...app.shortcuts.keys()], ["Ctrl+Alt+Y"]);
  app.appEvents["will-quit"]();
  assert.deepEqual([...app.shortcuts.keys()], []);
});

test("an older settings file without the new keys still loads with them off", async (t) => {
  const app = await loadMain(t, { settings: { language: "pt-BR", claudeConnected: true } });
  const s = await app.ipc.handle["get-settings"]();
  assert.equal(s.shortcutOn, false);
  assert.equal(s.shortcutKeys, "Ctrl+Alt+R");
  assert.equal(s.language, "pt-BR");
  i18n.setLang("en"); // main.js switched the shared i18n module; put it back for the other tests
});

// Window safety

test("no app window can be navigated away from its own page", async (t) => {
  const app = await loadMain(t, { settings: { miniWindow: true } });
  assert.equal(app.windows.length, 3, "window, tray card and strip");
  for (const w of app.windows) {
    let prevented = false;
    w.webContents.emit("will-navigate", { preventDefault: () => { prevented = true; } }, "file:///C:/Users/me/backup.json");
    assert.equal(prevented, true, w.opts.width ? `window ${w.opts.width}px wide` : "a window");
  }
});

test("links that open a new window go to the browser only when they are https", async (t) => {
  const app = await loadMain(t, { settings: { miniWindow: true } });
  for (const w of app.windows) {
    for (const url of ["https://github.com/KodusTheOnly", "file:///C:/Windows/System32/calc.exe", "http://example.com", "javascript:alert(1)", "not a url"]) {
      assert.deepEqual(w.webContents.openHandler({ url }), { action: "deny" }, "never a new app window");
    }
  }
  assert.deepEqual(app.opened, ["https://github.com/KodusTheOnly", "https://github.com/KodusTheOnly", "https://github.com/KodusTheOnly"]);
});

// Settings file safety

const GOOD = { language: "en", readings: [{ at: T0 - MIN, w: 12, s: 30, sr: null }], weights: [1, 1, 1, 1, 1, 1, 1] };
const read = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const damagedCopies = (dir) => fs.readdirSync(dir).filter((f) => f.startsWith("settings.json.damaged-"));

test("a normal save keeps the version it replaces as settings.json.bak", async (t) => {
  const app = await loadMain(t, { settings: GOOD });
  await app.ipc.handle["set-settings"]({}, { notifyAll: false });
  assert.equal(read(app.userData, "settings.json").notifyAll, false);
  assert.deepEqual(read(app.userData, "settings.json.bak"), GOOD, "the previous version");
  assert.equal(fs.existsSync(path.join(app.userData, "settings.json.tmp")), false, "no leftover temporary file");
  assert.equal(await app.ipc.handle["settings-recovery"](), null, "nothing to report");
});

test("a damaged settings file is kept as a copy and the previous version takes its place", async (t) => {
  const full = JSON.stringify(GOOD);
  const app = await loadMain(t, { files: { "settings.json": full.slice(0, -20), "settings.json.bak": full } });
  const s = await app.ipc.handle["get-settings"]();
  assert.deepEqual(s.readings, GOOD.readings, "the history is back");
  assert.deepEqual(read(app.userData, "settings.json").readings, GOOD.readings, "and on disk");
  const copies = damagedCopies(app.userData);
  assert.equal(copies.length, 1, "one copy of the damaged file");
  assert.equal(fs.readFileSync(path.join(app.userData, copies[0]), "utf8"), full.slice(0, -20), "byte for byte");
  const rec = await app.ipc.handle["settings-recovery"]();
  assert.equal(rec.kind, "restored");
  assert.equal(path.basename(rec.copy), copies[0]);
});

test("a damaged settings file with no copy to go back to starts fresh, but is still kept", async (t) => {
  const app = await loadMain(t, { files: { "settings.json": "{ not json" } });
  const s = await app.ipc.handle["get-settings"]();
  assert.equal(s.readings, undefined);
  assert.equal(s.shortcutKeys, "Ctrl+Alt+R", "defaults");
  assert.equal(damagedCopies(app.userData).length, 1);
  assert.equal((await app.ipc.handle["settings-recovery"]()).kind, "reset");
  await app.ipc.handle["set-settings"]({}, { notifyAll: false });
  assert.equal(damagedCopies(app.userData).length, 1, "later reads do not make more copies");
});

test("a settings file that is valid JSON but not an object counts as damaged", async (t) => {
  const app = await loadMain(t, { files: { "settings.json": "[]", "settings.json.bak": JSON.stringify(GOOD) } });
  assert.deepEqual((await app.ipc.handle["get-settings"]()).readings, GOOD.readings);
  assert.equal((await app.ipc.handle["settings-recovery"]()).kind, "restored");
});

test("a first run with no settings file is not a recovery", async (t) => {
  const app = await loadMain(t, { files: {} });
  await app.ipc.handle["get-settings"]();
  assert.equal(await app.ipc.handle["settings-recovery"](), null);
  assert.equal(damagedCopies(app.userData).length, 0);
});

// Export, import and backups

const NOW_DAY = (() => {
  const d = new Date(T0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();
const MANUAL = {
  anchor: T0 + 3 * 86400000, updatedAt: T0, via: "sync",
  weekly: { used: 40, resetsAt: T0 + 3 * 86400000 },
  fiveHour: { used: 20, resetsAt: T0 + 3600000, at: T0 },
  dayStart: { day: NOW_DAY, at: T0, used: 35 },
  days: { [NOW_DAY]: { spent: 5, budget: 12.5, endUsed: 40 } },
};
const FULL = {
  ...GOOD,
  manual: MANUAL,
  sessions: [{ sr: T0, peak: 30 }],
  weights: [1, 1, 2, 0.5, 1, 0, 1],
  activeHours: { start: 9, end: 1 },
  extra: { currency: "USD", symbol: "$", balance: 15.8, spent: 4.2, limit: 20, autoReload: false, at: T0 },
  language: "pt-BR", theme: "light", screens: "amber", motion: "subtle", showExtra: false, miniWindow: false, codeLogs: false,
  shortcutOn: true, shortcutKeys: "Ctrl+Alt+Y", fiveHourThreshold: 80, remindEvery: 4,
  notifyAll: true, notifyLevel: false, notifyResets: true, notifySpikes: false, notifyExtra: true,
  reserve: 10, reserveRelease: 24, autoWeights: true,
};
const EXPORTED_KEYS = ["manual", "readings", "sessions", "weights", "activeHours", "extra", "language", "theme", "screens", "motion", "showExtra", "miniWindow", "codeLogs", "shortcutOn", "shortcutKeys", "fiveHourThreshold", "remindEvery", "notifyAll", "notifyLevel", "notifyResets", "notifySpikes", "notifyExtra", "reserve", "reserveRelease", "autoWeights"];
const backups = (dir) => (fs.existsSync(path.join(dir, "backups")) ? fs.readdirSync(path.join(dir, "backups")).sort() : []);
const readBackup = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, "backups", name), "utf8"));
const tmpFile = (t, name) => {
  const file = path.join(os.tmpdir(), `cqc-${name}-${process.pid}.json`);
  t.after(() => fs.rmSync(file, { force: true }));
  return file;
};
const backupFile = (t, name, settings) => {
  const file = tmpFile(t, name);
  fs.writeFileSync(file, JSON.stringify({ app: "claude-quota-control", format: 1, settings }));
  return file;
};
const importer = (file) => ({
  showOpenDialog: async () => ({ canceled: false, filePaths: [file] }),
  showMessageBox: async () => ({ response: 0 }),
});
const saver = (file) => ({ showSaveDialog: async () => ({ canceled: false, filePath: file }) });

test("the JSON export carries the readings, the plan and every preference that can be restored", async (t) => {
  const out = tmpFile(t, "export");
  const app = await loadMain(t, { settings: FULL, dialog: saver(out) });
  assert.deepEqual(await app.ipc.handle["export-data"]({}, "json"), { ok: true });
  const body = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(body.app, "claude-quota-control");
  for (const k of EXPORTED_KEYS) assert.deepEqual(body.settings[k], FULL[k], `exports ${k}`);
  assert.equal(body.settings.claudeConnected, undefined, "not the account state");
  assert.equal(body.settings.stripPos, undefined, "not the strip's place on this screen");
  i18n.setLang("en");
});

test("an exported file imports back into a fresh app as it was", async (t) => {
  const out = tmpFile(t, "roundtrip");
  // Two apps, one after the other: each needs its own test context for the fake clock
  await t.test("export", async (st) => {
    const from = await loadMain(st, { settings: FULL, dialog: saver(out) });
    await from.ipc.handle["export-data"]({}, "json");
  });
  await t.test("import into a fresh app", async (st) => {
    const to = await loadMain(st, { settings: {}, dialog: importer(out) });
    assert.deepEqual(await to.ipc.handle["import-data"]({}), { ok: true, readings: 1 });
    const s = await to.ipc.handle["get-settings"]();
    for (const k of EXPORTED_KEYS) assert.deepEqual(s[k], FULL[k], `imports ${k}`);
    assert.deepEqual([...to.shortcuts.keys()], ["Ctrl+Alt+Y"], "the shortcut is registered right away");
  });
  i18n.setLang("en");
});

test("an import keeps what has the right shape and drops the rest", async (t) => {
  const file = backupFile(t, "broken", {
    manual: { ...MANUAL, fiveHour: "broken", days: { [NOW_DAY]: { spent: 5, budget: 12.5 }, "2026-01-02": null, "not-a-day": { spent: 1 }, "2026-01-03": { spent: "x" } } },
    extra: { balance: "lots", spent: 3, limit: 10, currency: "a very long string", autoReload: "yes" },
    theme: "neon", screens: "glass", fiveHourThreshold: 3, remindEvery: -1, weights: [1, 1, 1, 1, 1, 1, 9], activeHours: { start: 9, end: 9 }, shortcutKeys: "R", miniWindow: "yes",
    goal: 120, reserve: 7, reserveRelease: 12,
  });
  const app = await loadMain(t, { settings: GOOD, dialog: importer(file) });
  assert.equal((await app.ipc.handle["import-data"]({})).ok, true);
  const s = await app.ipc.handle["get-settings"]();
  assert.deepEqual(Object.keys(s.manual.days), [NOW_DAY], "only the good day");
  assert.equal(s.manual.fiveHour, null);
  assert.deepEqual(s.extra, { currency: null, symbol: null, balance: null, spent: 3, limit: 10, autoReload: null, at: 0 });
  assert.equal(s.theme, "dark");
  assert.equal(s.screens, "paper");
  assert.equal(s.fiveHourThreshold, 75);
  assert.equal(s.remindEvery, "smart");
  assert.deepEqual(s.weights, GOOD.weights, "bad weights leave the plan as it was");
  assert.equal(s.activeHours, undefined, "a window with no length is dropped");
  assert.equal(s.shortcutKeys, "Ctrl+Alt+R");
  assert.equal(s.miniWindow, undefined);
  assert.equal(s.goal, undefined, "a goal from an older version is not imported");
  assert.equal(s.reserve, 0, "a reserve that is not one of the choices is dropped");
  assert.equal(s.reserveRelease, 48);
  assert.deepEqual(s.readings, GOOD.readings, "readings not in the file stay as they were");
});

test("a backup whose week is broken keeps only its reset time", async (t) => {
  const file = backupFile(t, "anchor", { manual: { anchor: T0, weekly: { used: 200 } } });
  const app = await loadMain(t, { dialog: importer(file) });
  await app.ipc.handle["import-data"]({});
  assert.deepEqual((await app.ipc.handle["get-settings"]()).manual, { anchor: T0 });
});

test("an import keeps a copy of the settings it replaces", async (t) => {
  const file = backupFile(t, "import", { readings: [] });
  const app = await loadMain(t, { settings: GOOD, dialog: importer(file) });
  await app.ipc.handle["import-data"]({});
  const copy = backups(app.userData).find((f) => f.startsWith("before-import-"));
  assert.ok(copy, "a before-import copy");
  assert.deepEqual(readBackup(app.userData, copy).readings, GOOD.readings);
});

test("deleting the data keeps a copy first", async (t) => {
  const app = await loadMain(t, { settings: { ...GOOD, manual: MANUAL } });
  const s = await app.ipc.handle["clear-data"]({});
  assert.deepEqual(s.readings, []);
  assert.equal(s.manual, null);
  const copy = backups(app.userData).find((f) => f.startsWith("before-clear-"));
  assert.ok(copy, "a before-clear copy");
  assert.deepEqual(readBackup(app.userData, copy).manual, MANUAL);
});

test("one daily copy is made on the first save of the day, and only a week of them is kept", async (t) => {
  const app = await loadMain(t, { settings: GOOD });
  fs.mkdirSync(path.join(app.userData, "backups"));
  for (let d = 1; d <= 8; d++) fs.writeFileSync(path.join(app.userData, "backups", `daily-2000-01-0${d}.json`), "{}");
  await app.ipc.handle["set-settings"]({}, { notifyAll: false });
  await app.ipc.handle["set-settings"]({}, { notifyAll: true });
  const daily = backups(app.userData).filter((f) => f.startsWith("daily-"));
  assert.equal(daily.length, 7);
  assert.ok(daily.includes(`daily-${NOW_DAY}.json`), "today's copy");
  assert.deepEqual(readBackup(app.userData, `daily-${NOW_DAY}.json`), GOOD, "taken before the first change of the day");
});

// Strip, notifications, start with Windows and the collector check

test("a plain click on the strip does not pin it in place", async (t) => {
  const app = await loadMain(t, { settings: { miniWindow: true } });
  app.ipc.on["strip-drag"]({}, "start", 50, 1020);
  app.ipc.on["strip-drag"]({}, "end");
  assert.equal((await app.ipc.handle["get-settings"]()).stripPos, undefined, "still follows the taskbar");
});

test("dragging the strip saves where it was left", async (t) => {
  const app = await loadMain(t, { settings: { miniWindow: true } });
  app.ipc.on["strip-drag"]({}, "start", 50, 1020);
  app.ipc.on["strip-drag"]({}, "move", 450, 920);
  app.ipc.on["strip-drag"]({}, "end");
  const pos = (await app.ipc.handle["get-settings"]()).stripPos;
  assert.ok(pos && Number.isFinite(pos.x) && Number.isFinite(pos.y));
});

test("if the full screen check stops while a game is full screen, the strip comes back", async (t) => {
  const app = await loadMain(t, { settings: { miniWindow: true } });
  const strip = app.windows[2];
  strip.webContents.emit("did-finish-load");
  assert.equal(strip.isVisible(), true);
  const probe = app.spawned[0];
  probe.stdout.emit("data", Buffer.from("3")); // full screen app
  assert.equal(strip.isVisible(), false);
  probe.emit("exit", 1);
  assert.equal(strip.isVisible(), true);
});

test("a notification click opens the window, and the notification is kept alive until then", async (t) => {
  const app = await loadMain(t, { notifications: true });
  app.ipc.on["notify"]({}, { key: "k1", title: "T", body: "B" });
  app.ipc.on["notify"]({}, { key: "k1", title: "T", body: "B" });
  assert.equal(app.notes.length, 1, "the same key never repeats");
  app.win.hide();
  app.notes[0].emit("click");
  assert.equal(app.win.isVisible(), true);
  const s = await app.ipc.handle["get-settings"]();
  assert.ok(s.notified.k1, "remembered");
});

test("start with Windows is only registered by the installed app", async (t) => {
  const app = await loadMain(t);
  await app.ipc.handle["set-settings"]({}, { openAtLogin: true });
  assert.deepEqual(app.loginItems, [], "from the source folder it would start a bare Electron");
});

test("the collector status answers without blocking, with the node version", async (t) => {
  const app = await loadMain(t);
  const pending = app.ipc.handle["collector-status"]();
  assert.equal(typeof pending.then, "function", "a promise, not a value computed on the spot");
  const st = await pending;
  assert.match(st.node, /^v[0-9]+[.]/);
});

// Who may talk to the main process, and what an import or an export lets through

test("only the app's own windows are answered", async (t) => {
  const app = await loadMain(t);
  const stranger = { sender: { send() {} } }; // some other page, not one of the app's three windows
  assert.throws(() => app.ipc.handle["get-settings"](stranger), /refused/);
  assert.throws(() => app.ipc.handle["set-settings"](stranger, { notifyAll: false }), /refused/);
  assert.throws(() => app.ipc.handle["clear-data"](stranger), /refused/);
  app.ipc.on["open-usage"](stranger);
  assert.deepEqual(app.opened, [], "a message from elsewhere does nothing");
  // The tray card is one of the app's windows; a frame inside a window is not its top page
  assert.equal(typeof (await app.ipc.handle["get-settings"]({ sender: app.popup.webContents })).language, "string");
  const top = {};
  assert.throws(() => app.ipc.handle["get-settings"]({ sender: Object.assign(app.win.webContents, { mainFrame: top }), senderFrame: {} }), /refused/);
  assert.equal(typeof (await app.ipc.handle["get-settings"]({ sender: app.win.webContents, senderFrame: top })).language, "string");
});

test("settings sent in a shape that is not an object change nothing", async (t) => {
  const app = await loadMain(t, { settings: GOOD });
  for (const bad of [null, "x", 5, [1, 2]]) await app.ipc.handle["set-settings"]({}, bad);
  assert.deepEqual((await app.ipc.handle["get-settings"]()).readings, GOOD.readings);
});

test("an import drops times that cannot be real, so the week's math never walks toward them", async (t) => {
  const file = backupFile(t, "times", {
    manual: { ...MANUAL, weekly: { used: 40, resetsAt: 1e300 }, anchor: T0 + 5 * MIN },
    readings: [{ at: T0, w: 10, s: null, sr: null }, { at: 1e300, w: 10 }, { at: -5, w: 10 }, { at: T0 + MIN, w: 400 }, { at: T0 + 2 * MIN, w: 11, s: 20, sr: 8.64e15 }],
    sessions: [{ sr: T0, peak: 50 }, { sr: 1e300, peak: 50 }, { sr: T0, peak: 5000 }],
  });
  const app = await loadMain(t, { dialog: importer(file) });
  assert.equal((await app.ipc.handle["import-data"]({})).ok, true);
  const s = await app.ipc.handle["get-settings"]();
  assert.deepEqual(s.manual, { anchor: T0 + 5 * MIN }, "a week with an impossible reset keeps only a real reset time");
  assert.deepEqual(s.readings, [{ at: T0, w: 10, s: null, sr: null }, { at: T0 + 2 * MIN, w: 11, s: 20, sr: null }]);
  assert.deepEqual(s.sessions, [{ sr: T0, peak: 50 }]);
});

test("a file far too large to be a backup is refused without being read", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cqc-big-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "big.json");
  const fd = fs.openSync(file, "w");
  fs.ftruncateSync(fd, 21 * 1024 * 1024); // 21 MB of nothing
  fs.closeSync(fd);
  const app = await loadMain(t, { settings: GOOD, dialog: importer(file) });
  assert.deepEqual(await app.ipc.handle["import-data"]({}), { ok: false });
  assert.deepEqual((await app.ipc.handle["get-settings"]()).readings, GOOD.readings);
});

test("the CSV export writes only dates and numbers", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cqc-csv-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, "out.csv");
  const days = { "2026-01-05": { spent: 5, budget: 12.5 }, "=cmd|' /C calc'!A0": { spent: 1, budget: 1 }, "2026-01-06": { spent: "=1+1", budget: null }, "2026-01-07": null };
  const app = await loadMain(t, { settings: { manual: { ...MANUAL, days } }, dialog: saver(out) });
  assert.deepEqual(await app.ipc.handle["export-data"]({}, "csv"), { ok: true });
  const lines = fs.readFileSync(out, "utf8").trim().split("\n");
  assert.equal(lines[0], "date,spent_pct_of_week,budget_pct_of_week");
  assert.ok(lines.includes("2026-01-05,5,12.5"));
  assert.ok(lines.includes("2026-01-06,,"), "a value that is not a number is left empty");
  assert.ok(!lines.some((l) => l.includes("=")), "nothing a spreadsheet would run");
});

test("only a plain x.y.z counts as a version to offer", () => {
  const { isVersion, newerThan } = require("../updater.js");
  for (const v of ["2.2.1", "10.0.0", "0.0.1"]) assert.equal(isVersion(v), true, v);
  for (const v of ["", "2.2", "2.2.1-beta", "v2.2.1", "2.2.1 <b>", "99999.1.1", "2.2.1\n", null, 221]) assert.equal(isVersion(v), false, String(v));
  assert.equal(newerThan("2.3.0", "2.2.9"), true);
  assert.equal(newerThan("2.2.0", "2.2.0"), false);
});
