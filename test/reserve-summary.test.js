const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// The tray card, the taskbar strip and the tray tooltip show a day on the reserve the way the Overview does:
// what was used today, not rated, never "100% left" from a ratio that is held at 0 there.

function load(nowMs, settings) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [nowMs])); }
    static now() { return nowMs; }
  }
  const sent = {};
  const stub = () => ({ parentElement: {}, addEventListener() {}, classList: { remove() {}, add() {}, toggle() {} }, dataset: {} });
  const sandbox = {
    Date: FakeDate,
    document: { getElementById: stub, addEventListener() {}, hidden: false, documentElement: { dataset: {} } },
    window: { quota: { publishSummary: (s) => { sent.summary = s; }, setTray: (x) => { sent.tray = x; } } },
    ResizeObserver: class { observe() {} },
    I18N: { t: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k), getLang: () => "en", locale: () => "en-US" },
  };
  vm.createContext(sandbox);
  for (const f of ["core.js", "hourly.js", "learn.js", "compute.js", "ui.js", "blocks/verdict.js", "tray.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "renderer", "js", f), "utf8"), sandbox);
  }
  vm.runInContext(`state.settings = ${JSON.stringify(settings)}; var syncBusy = false; var dataState = () => "fresh";
    var STATE_LEVEL = { fresh: 0, none: null }; drawTrayIcon = () => "";`, sandbox);
  return { sb: sandbox, sent };
}
const at = (y, m, d, h = 0) => new Date(y, m - 1, d, h).getTime();

test("a day on the reserve reads Reserve with what it used, on the card, the strip and the tooltip", () => {
  // Week Wed 2026-10-28 08:00 to Wed 11-04 08:00, Saturday noon at 95% with a 10% reserve: the plan is spent
  const now = at(2026, 10, 31, 12);
  const data = {
    updatedAt: now,
    weekly: { used: 95, resetsAt: at(2026, 11, 4, 8) },
    fiveHour: null,
    dayStart: { day: "2026-10-31", at: at(2026, 10, 31, 9), used: 88 },
    days: { "2026-10-31": { spent: 7, budget: 5, endUsed: 95 } },
  };
  const { sb, sent } = load(now, { manual: data, reserve: 10, reserveRelease: 0 });
  sb.__src = { kind: "manual", data };
  vm.runInContext("var __m = compute(__src); publishSummary(__m, __src); updateTray(__m);", sb);
  assert.equal(vm.runInContext("__m.reserveMode", sb), true);
  const today = sent.summary.rows.find((r) => r.kind === "today");
  assert.equal(today.reserve, true);
  assert.equal(today.off, true, "no bar and no level, as on an Off day");
  assert.equal(today.short, "7%");
  assert.match(today.text, /^pop\.reserveUsed/);
  assert.match(sent.tray.tooltip, /tray\.todayReserve \{"pct":"7%"\}/);
});
