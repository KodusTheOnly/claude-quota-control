// Layout tests for the Overview, Settings, Help, History, About, the tray card and the taskbar strip: opens them at many window sizes
// (the card and the strip have one size each), in both languages and themes, in every data state, and fails on text
// that does not fit, boxes that overlap, scrolling where there should be none, missing essentials, text under 12px
// and hit targets that are too small. The card and the strip also get their keys clicked.
//
//   npm run test:layout                 the full matrix
//   npm run test:layout -- --quick      English, light theme, a few states (fast, for working)
//   npm run test:layout -- --shots      also save a screenshot of every case in test/layout/out/
//   npm run test:layout -- --only=1280x720,420x540   limit to some sizes
//   npm run test:layout -- --lang=pt-BR --theme=dark --scenario=stale   limit to a language, theme or state
//   npm run test:layout -- --view=settings   only one screen (panel, settings, help, history, about or tray)
//
// Needs the Playwright browser once:  npx playwright install chromium

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { SIZES, SCROLLS } = require("./sizes");
const { SCENARIOS } = require("./scenarios");
const { openOverview } = require("./page");
const { checkPage } = require("./checks");
const { checkCard, checkStrip } = require("./tray-checks");
const { openCard, openStrip, PATCHES } = require("./tray");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1];
const quick = flag("quick");
const shots = flag("shots");
const only = option("only") ? option("only").split(",") : null;
const OUT = path.join(__dirname, "out");

function buildCases() {
  const pick = (wanted, fallback) => (wanted ? [wanted] : fallback);
  const languages = pick(option("lang"), quick ? ["en"] : ["en", "pt-BR"]);
  const themes = pick(option("theme"), quick ? ["light"] : ["light", "dark"]);
  const scenarios = pick(option("scenario"), quick ? ["moderate", "pause", "stale"] : SCENARIOS);
  const views = pick(option("view"), ["panel", "settings", "help", "history", "about", "tray"]);
  // Settings and Help: the usual state, and one with no account and a shortcut that another app already uses (the longest texts)
  const docStates = quick ? [["moderate", "off"]] : [["moderate", "off"], ["noaccount", "taken"]];
  const cases = [];
  for (const size of SIZES) {
    if (only && !only.includes(`${size.w}x${size.h}`)) continue;
    for (const language of languages) {
      for (const theme of themes) {
        if (views.includes("panel")) {
          for (const scenario of scenarios) cases.push({ ...size, language, theme, scenario, interaction: null, view: "panel" });
          for (const interaction of ["math", "type", "plan", "toast"]) cases.push({ ...size, language, theme, scenario: "moderate", interaction, view: "panel" });
        }
        for (const view of views.filter((v) => v !== "panel" && v !== "tray" && v !== "history" && v !== "about")) {
          for (const [scenario, shortcut] of docStates) cases.push({ ...size, language, theme, scenario, interaction: null, view, shortcut });
        }
        // About: the screen, then with each result of "Check for updates" on the nameplate
        if (views.includes("about")) {
          for (const update of quick ? [null, "newer"] : [null, "checking", "latest", "newer", "none", "fail"]) cases.push({ ...size, language, theme, scenario: "moderate", interaction: null, view: "about", update });
        }
        // History: a full one, one with only three days, one with big days (blocks of 2%) and the empty states
        if (views.includes("history")) {
          for (const scenario of quick ? ["history", "histempty"] : ["history", "moderate", "pause", "histempty"]) cases.push({ ...size, language, theme, scenario, interaction: null, view: "history" });
        }
      }
    }
  }
  // The tray card and the strip: no window sizes, every state, plus a failed refresh
  if (views.includes("tray") && !only) {
    for (const language of languages) {
      for (const theme of themes) {
        for (const scenario of scenarios) cases.push({ view: "tray", language, theme, scenario });
        cases.push({ view: "tray", language, theme, scenario: "moderate", patch: "failed" });
        cases.push({ view: "tray", language, theme, scenario: "stale", patch: "failed" });
      }
    }
  }
  return cases;
}

const label = (c) => c.view === "tray" ? `tray ${c.language} ${c.theme} ${c.scenario}${c.patch ? ` +${c.patch}` : ""}` : `${c.view === "panel" ? "" : `${c.view} `}${c.w}x${c.h} ${c.language} ${c.theme} ${c.scenario}${c.interaction ? ` +${c.interaction}` : ""}${c.update ? ` update-${c.update}` : ""}${c.shortcut && c.shortcut !== "off" ? ` shortcut-${c.shortcut}` : ""}`;

// The card and the strip, one after the other. Then a click on each key must reach the main process.
async function runTrayCase(browser, c) {
  const problems = [];
  const opts = { scenario: c.scenario, language: c.language, theme: c.theme, patch: c.patch ? (s) => PATCHES[c.patch](s, c.language) : undefined };

  const card = await openCard(browser, opts);
  try {
    const { rows, hasData, connected, syncing } = card.summary;
    const found = await checkCard(card.page, { height: card.height, rows: hasData ? rows.length : 0, hasData });
    problems.push(...card.errors, ...found.map((p) => `card: ${p}`));
    const pressed = async (selector) => {
      await card.page.evaluate(() => (window.__actions = []));
      await card.page.click(selector);
      return card.page.evaluate(() => window.__actions);
    };
    if ((await pressed("#openBtn")).join() !== "open") problems.push("card: Open app did not ask to open the app");
    const typeKey = connected ? "#typeLink" : "#typeKey";
    if ((await pressed(typeKey)).join() !== "type") problems.push("card: Type it in did not ask for the type-in screen");
    if (connected && !syncing && (await pressed("#popSync")).join() !== "sync") problems.push("card: Refresh now did not ask for a refresh");
    await card.page.evaluate(() => (window.__actions = []));
    await card.page.keyboard.press("Escape");
    if ((await card.page.evaluate(() => window.__actions)).join() !== "close") problems.push("card: Escape did not close the card");
    if (shots) {
      fs.mkdirSync(OUT, { recursive: true });
      await card.page.screenshot({ path: path.join(OUT, `${label(c).replace(/[ +]/g, "_")}_card.png`), omitBackground: true });
    }
  } finally {
    await card.close();
  }

  // The strip is always on a CRT, so the theme changes nothing there: it is checked once per state and language
  if (c.theme === "light") {
    const strip = await openStrip(browser, opts);
    try {
      problems.push(...strip.errors, ...(await checkStrip(strip.page, { width: strip.width })).map((p) => `strip: ${p}`));
      const clicked = async (action) => {
        await strip.page.evaluate(() => (window.__actions = []));
        await action();
        return strip.page.evaluate(() => window.__actions);
      };
      if (!(await clicked(() => strip.page.click("#refresh"))).includes("refresh")) problems.push("strip: the refresh key did not ask for a refresh");
      if (!(await clicked(() => strip.page.click("#more"))).includes("toggle")) problems.push("strip: the arrow did not open the card");
      if (!(await clicked(() => strip.page.dblclick("#today"))).includes("open")) problems.push("strip: a double click did not open the app");
      if (shots) await strip.page.screenshot({ path: path.join(OUT, `${label(c).replace(/[ +]/g, "_")}_strip.png`) });
    } finally {
      await strip.close();
    }
  }
  return problems;
}

// History: the tooltip of the first, the last and the busiest column opens and stays inside the chart screen
async function checkTooltip(page) {
  const hits = await page.$$("#chart .hit");
  if (!hits.length) return [];
  const heights = await page.$$eval("#chart svg .h-use, #chart svg .h-today, #chart svg .h-none, #chart svg .h-zero", (cols) => cols.map((c) => c.getBoundingClientRect().height));
  const tallest = heights.indexOf(Math.max(...heights));
  const problems = [];
  for (const i of new Set([0, tallest, hits.length - 1])) {
    const box = await hits[i].boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const r = await page.evaluate(() => {
      const tip = document.getElementById("tooltip").getBoundingClientRect();
      const frame = document.getElementById("chartBox").getBoundingClientRect();
      return { shown: !document.getElementById("tooltip").classList.contains("hidden"), left: tip.left - frame.left, right: frame.right - tip.right, top: tip.top - frame.top };
    });
    if (!r.shown) problems.push(`the tooltip of column ${i + 1} did not open`);
    else if (r.left < -0.5 || r.right < -0.5 || r.top < -0.5) problems.push(`the tooltip of column ${i + 1} sticks out of the chart screen`);
  }
  await page.mouse.move(0, 0);
  return problems;
}

async function runCase(browser, c) {
  if (c.view === "tray") return runTrayCase(browser, c);
  const { page, errors, close } = await openOverview(browser, c);
  try {
    const problems = await page.evaluate(checkPage, { format: c.format, scrolls: SCROLLS.includes(c.format), view: c.view });
    if (c.view === "history") problems.push(...(await checkTooltip(page)));
    if (shots) {
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, `${label(c).replace(/[ +]/g, "_")}.png`) });
    }
    return [...errors, ...problems];
  } finally {
    await close();
  }
}

(async () => {
  const cases = buildCases();
  const browser = await chromium.launch();
  const failures = [];
  const queue = [...cases];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      let problems;
      try {
        problems = await runCase(browser, c);
      } catch (e) {
        problems = [`crashed: ${e.message.split("\n")[0]}`];
      }
      if (problems.length) failures.push({ c, problems });
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  await browser.close();

  failures.sort((a, b) => label(a.c).localeCompare(label(b.c)));
  for (const f of failures) {
    console.log(`FAIL ${label(f.c)}`);
    for (const p of [...new Set(f.problems)].slice(0, 8)) console.log(`     ${p}`);
  }
  console.log(`${cases.length - failures.length} of ${cases.length} cases passed`);
  process.exit(failures.length ? 1 : 0);
})();
