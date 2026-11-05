// Opens the Overview in a browser the way Electron would: file:// page, a fake `window.quota` bridge
// and a frozen clock. The real app code runs unchanged.

const path = require("path");
const { NOW, settingsFor } = require("./scenarios");

const INDEX = path.join(__dirname, "..", "..", "renderer", "index.html");

// Everything the preload script exposes, answered from the fake settings
function installBridge({ now, settings, offline, hangSync, shortcut }) {
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  }
  window.Date = FrozenDate;
  if (offline) Object.defineProperty(navigator, "onLine", { get: () => false });
  const store = JSON.parse(JSON.stringify(settings));
  const noop = () => {};
  window.quota = {
    getData: async () => null,
    onData: noop,
    getSettings: async () => store,
    setSettings: async (patch) => Object.assign(store, patch),
    collectorStatus: async () => ({ installed: false }),
    installCollector: async () => ({}),
    uninstallCollector: async () => ({}),
    setTray: noop,
    notify: noop,
    openUsage: noop,
    onFocusUpdate: noop,
    onAutoReadStopped: noop,
    activityHours: async () => ({ enabled: true, hours: [] }),
    claudeLogin: async () => ({}),
    claudeLogout: async () => ({}),
    claudeSync: () => (hangSync ? new Promise(noop) : Promise.resolve({ ok: false, error: "closed" })),
    onSyncRequest: noop,
    rendererReady: noop,
    shortcutStatus: async () => ({ state: shortcut, keys: null }),
    toast: noop,
    appInfo: async () => ({ version: "1.1.0", electron: "45.0.0" }),
    checkUpdate: async () => ({}),
    exportData: async () => ({}),
    importData: async () => ({}),
    publishSummary: (s) => { window.__summary = s; }, // the tray card and the strip tests read it back
    getSummary: async () => ({}),
    onSummary: noop,
    popupAction: noop,
    popupResize: noop,
    stripAction: noop,
    stripDrag: noop,
    stripResize: noop,
  };
}

// opts: { w, h, scenario, language, theme, interaction, view, shortcut }
// view: the screen to open (panel, settings, help, history or about). update: the result of "Check for updates" to show on About. shortcut: how the global shortcut reads (off, ok, taken or invalid).
async function openOverview(browser, opts) {
  const { w, h, scenario = "moderate", language = "en", theme = "light", interaction = null, view = "panel", shortcut = "off", update = null } = opts;
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    locale: language === "pt-BR" ? "pt-BR" : "en-US",
    timezoneId: "America/Sao_Paulo",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.addInitScript(installBridge, {
    now: NOW,
    settings: { ...settingsFor(scenario, language), ...(shortcut === "off" ? {} : { shortcutOn: true }) },
    offline: scenario === "offline",
    hangSync: scenario === "updating",
    shortcut,
  });
  await page.goto(`file://${INDEX}`);
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForSelector(scenario === "nodata" ? "#setup:not(.hidden)" : "#dash:not(.hidden)");
  if (scenario === "updating") await page.click("#syncBtn");
  // In the vertical format the two keys sit in the "..." menu
  const openMenu = async () => { if (await page.isVisible("#moreBtn")) await page.click("#moreBtn"); };
  if (interaction === "math") { await openMenu(); await page.click('[data-math="week"]'); }
  if (interaction === "type") { await openMenu(); await page.click("#typeBtn"); }
  if (interaction === "plan") await page.click(".day:nth-child(3)");
  if (interaction === "toast") await page.evaluate(() => toast(t("sync.err.format"), "error", { label: t("sync.openPage"), run: () => {} })); // the longest message, with its action
  if (view === "about") await page.evaluate(() => go("about")); // About has no key of its own: it opens from Help
  else if (view !== "panel") await page.click(`.nav-btn[data-view="${view}"]`);
  if (view === "about" && update) {
    // The result of "Check for updates": checking never finishes, the others answer at once
    const answers = { latest: { status: "latest" }, newer: { status: "newer", version: "1.2.0", url: "https://example.com/release" }, none: { status: "none" }, fail: { status: "error" } };
    await page.evaluate((answer) => { window.quota.checkUpdate = () => (answer ? Promise.resolve(answer) : new Promise(() => {})); }, answers[update] || null);
    await page.click("#updateBtn");
  }
  await page.waitForTimeout(250);
  return { page, errors, close: () => context.close() };
}

module.exports = { openOverview };
