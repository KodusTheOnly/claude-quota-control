// Opens the tray card and the taskbar strip the way Electron would: file:// page and a fake `window.quota`.
// Both windows only draw the summary the main window publishes, so the tests take the real one from the Overview
// (the same code that runs in the app) and hand it to them.

const path = require("path");
const { openOverview } = require("./page");

const RENDERER = path.join(__dirname, "..", "..", "renderer");

// The summary the Overview publishes for a scenario
async function summaryOf(browser, { scenario, language, theme }) {
  const { page, close } = await openOverview(browser, { w: 1280, h: 720, scenario, language, theme });
  const summary = await page.evaluate(() => window.__summary);
  await close();
  return { ...summary, dark: theme === "dark", paper: theme !== "dark" && process.env.LAYOUT_SCREENS !== "crt" };
}

function installCard(summary) {
  window.__height = 0;
  window.__actions = [];
  window.quota = {
    getSummary: async () => summary,
    onSummary: () => {},
    popupResize: (h) => (window.__height = h),
    popupAction: (a) => window.__actions.push(a),
  };
}

function installStrip(summary) {
  window.__width = 0;
  window.__actions = [];
  window.quota = {
    getSummary: async () => summary,
    onSummary: () => {},
    stripResize: (w) => (window.__width = w),
    stripAction: (a) => window.__actions.push(a),
    stripDrag: () => {},
  };
}

// opts: { scenario, language, theme, patch } patch edits the summary (a failed refresh, a signed-out account...)
async function open(browser, file, install, viewport, opts) {
  const { scenario = "moderate", language = "en", theme = "light", patch } = opts;
  const summary = await summaryOf(browser, { scenario, language, theme });
  if (patch) patch(summary);
  const context = await browser.newContext({
    viewport,
    locale: language === "pt-BR" ? "pt-BR" : "en-US",
    reducedMotion: "reduce",
    deviceScaleFactor: opts.scale || 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.addInitScript(install, summary);
  await page.goto(`file://${path.join(RENDERER, file)}`);
  await page.waitForTimeout(250);
  return { page, errors, summary, close: () => context.close() };
}

// The card is 340px wide; the window takes the height the card asks for
async function openCard(browser, opts) {
  const card = await open(browser, "popup.html", installCard, { width: 340, height: 720 }, opts);
  card.height = await card.page.evaluate(() => window.__height);
  await card.page.setViewportSize({ width: 340, height: card.height || 400 });
  return card;
}

// The strip is 30px tall and as wide as it asks to be
async function openStrip(browser, opts) {
  const strip = await open(browser, "strip.html", installStrip, { width: 130, height: 30 }, opts);
  strip.width = await strip.page.evaluate(() => window.__width);
  await strip.page.setViewportSize({ width: strip.width || 130, height: 30 });
  await strip.page.waitForTimeout(100);
  return strip;
}

// Things that happen on top of a scenario: a refresh that failed, with a long message
const FAILED = {
  en: "Could not read the usage page. Check your connection, then sign in to Claude again.",
  "pt-BR": "Não foi possível ler a página de uso. Verifique a conexão e entre no Claude de novo.",
};
const PATCHES = {
  failed: (s, language) => {
    s.msg = { kind: "error", text: FAILED[language], at: Date.now() };
  },
};

module.exports = { openCard, openStrip, PATCHES };
